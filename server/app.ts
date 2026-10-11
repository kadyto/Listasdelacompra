import Fastify from "fastify";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z, ZodError } from "zod";
import { normalize, openDatabase, productIdentity, transaction } from "./db.js";
import { parseCents, priceDifference, unitPrice } from "./prices.js";
import {
  createBackup,
  restoreDatabaseData,
  verifyBackup,
} from "./maintenance.js";

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
type Row = Record<string, string | number | null>;
const idSchema = z.coerce.number().int().positive();
const notes = z.string().trim().max(2000).default("");
const storeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    notes,
    active: z.boolean().default(true),
  })
  .strict();
const productSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    brand: z.string().trim().max(100).default(""),
    category_id: idSchema,
    package_amount: z.number().positive().max(100000),
    unit: z.enum(["ud", "kg", "g", "l", "ml"]),
    ean: z
      .string()
      .trim()
      .regex(
        /^(?:\d{8}|\d{12,14})?$/,
        "El EAN debe tener 8, 12, 13 o 14 dígitos.",
      )
      .default(""),
    notes,
    list_ids: z.array(idSchema).max(100).default([]),
  })
  .strict();
const priceSchema = z
  .object({
    product_id: idSchema,
    store_id: idSchema,
    price: z
      .string()
      .trim()
      .regex(
        /^\d{1,6}([.,]\d{1,2})?$/,
        "Introduce un precio válido con un máximo de dos decimales.",
      ),
    recorded_at: z.iso.datetime({ offset: true }).optional(),
    notes,
    on_sale: z.boolean().default(false),
  })
  .strict();
const productSelect =
  "SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id";

export async function createApp(
  options: {
    dbPath?: string;
    seed?: boolean;
    logger?: boolean;
    serveClient?: boolean;
    backupDir?: string;
  } = {},
) {
  const databasePath =
    options.dbPath ?? process.env.DATABASE_PATH ?? "./data/compra.sqlite";
  const backupDirectory = resolve(
    options.backupDir ?? process.env.BACKUP_DIRECTORY ?? "./backups",
  );
  const db = openDatabase(databasePath, options.seed ?? true);
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 65536,
    requestTimeout: 15000,
  });
  let backupBusy = false;
  let restoring = false;
  const backupName = z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.sqlite$/);
  const newBackupName = (prefix = "compra") =>
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.sqlite`;
  const isLiveDatabase = (path: string) => {
    if (!existsSync(databasePath)) return false;
    const source = lstatSync(path);
    const current = lstatSync(databasePath);
    return source.dev === current.dev && source.ino === current.ino;
  };
  const backupPath = (name: string) => {
    const path = join(backupDirectory, backupName.parse(name));
    if (!existsSync(path) || !lstatSync(path).isFile())
      throw new HttpError(
        404,
        "No se encuentra esa copia en la carpeta de backups.",
      );
    if (isLiveDatabase(path))
      throw new HttpError(
        400,
        "Elige una copia de seguridad, no la base de datos en uso.",
      );
    return path;
  };
  const backupInfo = (filename: string) => {
    const info = lstatSync(join(backupDirectory, filename));
    return {
      filename,
      size: info.size,
      created_at: info.mtime.toISOString(),
      automatic: filename.startsWith("antes-de-restaurar-"),
    };
  };
  const get = (sql: string, ...args: (string | number)[]) =>
    db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: (string | number)[]) =>
    db.prepare(sql).all(...args) as Row[];
  const requireRow = (table: string, id: number) => {
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row) throw new HttpError(404, "No se ha encontrado este registro.");
    return row;
  };
  const paramId = (params: unknown) =>
    idSchema.parse((params as { id?: unknown }).id);
  const checkActiveList = (id: number) => {
    if (
      !get(
        "SELECT l.id FROM shopping_lists l JOIN stores s ON s.id=l.store_id WHERE l.id=? AND l.active=1 AND s.active=1",
        id,
      )
    )
      throw new HttpError(
        400,
        "La lista no existe o su comercio está desactivado.",
      );
  };
  const addToList = (listId: number, productId: number, quantity: number) => {
    checkActiveList(listId);
    requireRow("products", productId);
    const position = Number(
      get(
        "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM list_items WHERE list_id=?",
        listId,
      )?.n,
    );
    return db
      .prepare(
        "INSERT INTO list_items (list_id,product_id,quantity,added_at,position) VALUES (?,?,?,?,?) ON CONFLICT(list_id,product_id) DO NOTHING",
      )
      .run(listId, productId, quantity, new Date().toISOString(), position);
  };
  const stores = () =>
    all(`SELECT s.*, l.id AS list_id,
    COUNT(CASE WHEN i.purchased=0 THEN 1 END) AS pending_count,
    COUNT(CASE WHEN i.purchased=0 AND pr.cents IS NOT NULL THEN 1 END) AS priced_count,
    COALESCE(SUM(CASE WHEN i.purchased=0 THEN pr.cents*i.quantity END),0) AS estimated_cents
    FROM stores s LEFT JOIN shopping_lists l ON l.store_id=s.id AND l.active=1
    LEFT JOIN list_items i ON i.list_id=l.id
    LEFT JOIN latest_prices pr ON pr.store_id=s.id AND pr.product_id=i.product_id
    GROUP BY s.id ORDER BY s.active DESC, s.id`);

  app.addHook("onClose", async () => {
    db.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: "Revisa los datos introducidos.",
        details: error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message });
    if (!(error instanceof Error)) {
      app.log.error(error);
      return reply
        .code(500)
        .send({ message: "No se pudo completar la operación." });
    }
    if (error.message.includes("UNIQUE constraint failed"))
      return reply.code(409).send({
        message:
          "Ya existe un registro con esos datos. Reutiliza el producto existente o revisa el nombre, la marca, el formato y el EAN.",
      });
    if (error.message.includes("FOREIGN KEY constraint failed"))
      return reply
        .code(400)
        .send({ message: "Uno de los registros asociados ya no existe." });
    if (error.message.includes("database is locked"))
      return reply.code(503).send({
        message:
          "La base de datos está ocupada. Vuelve a intentarlo en unos segundos.",
      });
    const status =
      "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status < 500)
      return reply.code(status).send({ message: "La petición no es válida." });
    app.log.error(error);
    return reply.code(500).send({
      message: "No se pudo completar la operación. Inténtalo de nuevo.",
    });
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api"))
      reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (request.headers["sec-fetch-site"] === "cross-site")
        throw new HttpError(403, "Origen no autorizado.");
      if (origin) {
        const allowed = (process.env.ALLOWED_ORIGINS ?? "")
          .split(",")
          .filter(Boolean);
        let sameHost = false;
        try {
          sameHost = new URL(origin).host === request.headers.host;
        } catch {
          /* Invalid origins are rejected. */
        }
        if (!sameHost && !allowed.includes(origin))
          throw new HttpError(403, "Origen no autorizado.");
      }
    }
  });

  // Existing database handlers run synchronously. This synchronous hook keeps
  // them out while the automatic backup and restore transaction are running.
  app.addHook("preHandler", (request, _reply, done) => {
    if (restoring && request.url.startsWith("/api"))
      return done(
        new HttpError(
          503,
          "Se están restaurando los datos. Espera unos segundos.",
        ),
      );
    done();
  });

  app.get("/api/backups", async () => {
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    return readdirSync(backupDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          backupName.safeParse(entry.name).success &&
          !isLiveDatabase(join(backupDirectory, entry.name)),
      )
      .map((entry) => backupInfo(entry.name))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  });
  app.get("/api/backups/:filename/download", async (request, reply) => {
    const filename = backupName.parse(
      (request.params as { filename: string }).filename,
    );
    const path = backupPath(filename);
    return reply
      .type("application/vnd.sqlite3")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(createReadStream(path));
  });
  app.post("/api/backups", async (_request, reply) => {
    if (backupBusy)
      throw new HttpError(409, "Ya hay una operación de copia en curso.");
    backupBusy = true;
    try {
      const filename = newBackupName();
      await createBackup(databasePath, join(backupDirectory, filename));
      return reply.code(201).send(backupInfo(filename));
    } catch (error) {
      app.log.error(error);
      throw new HttpError(
        500,
        "No se pudo guardar la copia. Comprueba que la carpeta de backups permite escribir.",
      );
    } finally {
      backupBusy = false;
    }
  });
  app.post("/api/backups/restore", async (request) => {
    const { filename } = z
      .object({ filename: backupName, confirm: z.literal(true) })
      .strict()
      .parse(request.body);
    if (backupBusy)
      throw new HttpError(409, "Ya hay una operación de copia en curso.");
    const source = backupPath(filename);
    try {
      verifyBackup(source);
    } catch {
      throw new HttpError(
        400,
        "La copia no es válida. Los datos actuales se han conservado.",
      );
    }
    backupBusy = true;
    restoring = true;
    const previous = newBackupName("antes-de-restaurar");
    try {
      await createBackup(databasePath, join(backupDirectory, previous));
      restoreDatabaseData(db, source, databasePath);
      return { restored: filename, previous };
    } catch (error) {
      app.log.error(error);
      throw new HttpError(
        400,
        "No se pudo restaurar la copia. Los datos actuales se han conservado; comprueba la copia, su versión y los permisos de las carpetas.",
      );
    } finally {
      restoring = false;
      backupBusy = false;
    }
  });

  app.get("/api/health", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });
  app.get("/api/dashboard", async () => ({
    stores: stores(),
    product_count: Number(get("SELECT COUNT(*) AS n FROM products")?.n),
    recent_prices:
      all(`SELECT pr.*, p.name AS product_name, p.brand, p.package_amount, p.unit, s.name AS store_name
      FROM price_records pr JOIN products p ON p.id=pr.product_id JOIN stores s ON s.id=pr.store_id ORDER BY pr.created_at DESC, pr.id DESC LIMIT 5`),
  }));
  app.get("/api/stores", async () => stores());
  app.post("/api/stores", async (request, reply) => {
    const data = storeSchema.parse(request.body);
    const id = transaction(db, () => {
      const result = db
        .prepare(
          "INSERT INTO stores (name,normalized_name,notes,active) VALUES (?,?,?,?)",
        )
        .run(data.name, normalize(data.name), data.notes, Number(data.active));
      db.prepare(
        "INSERT INTO shopping_lists (store_id,created_at) VALUES (?,?)",
      ).run(result.lastInsertRowid, new Date().toISOString());
      return Number(result.lastInsertRowid);
    });
    return reply.code(201).send(requireRow("stores", id));
  });
  app.put("/api/stores/:id", async (request) => {
    const id = paramId(request.params),
      data = storeSchema.parse(request.body);
    requireRow("stores", id);
    db.prepare(
      "UPDATE stores SET name=?,normalized_name=?,notes=?,active=? WHERE id=?",
    ).run(data.name, normalize(data.name), data.notes, Number(data.active), id);
    return requireRow("stores", id);
  });
  app.get("/api/categories", async () =>
    all(
      "SELECT c.*, COUNT(p.id) AS product_count FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE",
    ),
  );
  app.post("/api/categories", async (request, reply) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(request.body);
    const result = db
      .prepare("INSERT INTO categories (name,normalized_name) VALUES (?,?)")
      .run(name, normalize(name));
    return reply
      .code(201)
      .send(requireRow("categories", Number(result.lastInsertRowid)));
  });
  app.put("/api/categories/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("categories", id);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(request.body);
    db.prepare("UPDATE categories SET name=?,normalized_name=? WHERE id=?").run(
      name,
      normalize(name),
      id,
    );
    return requireRow("categories", id);
  });
  app.delete("/api/categories/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("categories", id);
    if (get("SELECT 1 FROM products WHERE category_id=? LIMIT 1", id))
      throw new HttpError(
        409,
        "Esta categoría tiene productos. Cambia su categoría antes de eliminarla.",
      );
    db.prepare("DELETE FROM categories WHERE id=?").run(id);
    return { ok: true };
  });

  app.get("/api/products", async (request) => {
    const { search } = z
      .object({ search: z.string().max(160).default("") })
      .parse(request.query);
    return all(
      `${productSelect} WHERE instr(p.search_text, ?) > 0 ORDER BY p.name COLLATE NOCASE`,
      normalize(search),
    ).map((p) => ({
      ...p,
      lists: all(
        "SELECT l.id AS list_id,s.id AS store_id,s.name AS store_name,i.purchased FROM list_items i JOIN shopping_lists l ON l.id=i.list_id JOIN stores s ON s.id=l.store_id WHERE i.product_id=? AND l.active=1",
        Number(p.id),
      ),
    }));
  });
  app.post("/api/products", async (request, reply) => {
    const data = productSchema.parse(request.body);
    requireRow("categories", data.category_id);
    const id = transaction(db, () => {
      const identity = productIdentity(
        data.name,
        data.brand,
        data.package_amount,
        data.unit,
      );
      const result = db
        .prepare(
          "INSERT INTO products (name,brand,category_id,package_amount,unit,ean,notes,identity_key,search_text,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          data.name,
          data.brand,
          data.category_id,
          data.package_amount,
          data.unit,
          data.ean || null,
          data.notes,
          identity,
          normalize(`${data.name} ${data.brand} ${data.ean}`),
          new Date().toISOString(),
        );
      const id = Number(result.lastInsertRowid);
      for (const list of new Set(data.list_ids)) addToList(list, id, 1);
      return id;
    });
    return reply.code(201).send(get(`${productSelect} WHERE p.id=?`, id));
  });
  app.put("/api/products/:id", async (request) => {
    const id = paramId(request.params),
      data = productSchema.parse(request.body);
    const old = requireRow("products", id);
    requireRow("categories", data.category_id);
    if (
      (old.package_amount !== data.package_amount || old.unit !== data.unit) &&
      get("SELECT 1 FROM price_records WHERE product_id=? LIMIT 1", id)
    )
      throw new HttpError(
        409,
        "Este formato tiene precios registrados. Crea otro producto para un envase distinto; así conservarás comparaciones correctas.",
      );
    transaction(db, () => {
      db.prepare(
        "UPDATE products SET name=?,brand=?,category_id=?,package_amount=?,unit=?,ean=?,notes=?,identity_key=?,search_text=? WHERE id=?",
      ).run(
        data.name,
        data.brand,
        data.category_id,
        data.package_amount,
        data.unit,
        data.ean || null,
        data.notes,
        productIdentity(data.name, data.brand, data.package_amount, data.unit),
        normalize(`${data.name} ${data.brand} ${data.ean}`),
        id,
      );
      for (const list of new Set(data.list_ids)) addToList(list, id, 1);
    });
    return get(`${productSelect} WHERE p.id=?`, id);
  });
  app.get("/api/products/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("products", id);
    const product = get(`${productSelect} WHERE p.id=?`, id)!;
    const latest = all(
      "SELECT pr.*,s.name AS store_name,s.active AS store_active FROM latest_prices pr JOIN stores s ON s.id=pr.store_id WHERE pr.product_id=? ORDER BY pr.cents,s.name",
      id,
    );
    const lowest = latest.filter((p) => p.store_active === 1)[0];
    return {
      product,
      latest: latest.map((p) => ({
        ...p,
        unit_price: unitPrice(
          Number(p.cents),
          Number(product.package_amount),
          String(product.unit),
        ),
        difference: lowest
          ? priceDifference(Number(p.cents), Number(lowest.cents))
          : null,
      })),
      lists: all(
        "SELECT l.id AS list_id,s.id AS store_id,s.name AS store_name,s.active AS store_active,i.quantity,i.purchased,i.id AS item_id FROM list_items i JOIN shopping_lists l ON l.id=i.list_id JOIN stores s ON s.id=l.store_id WHERE i.product_id=? AND l.active=1",
        id,
      ),
      history: all(
        "SELECT pr.*,s.name AS store_name FROM price_records pr JOIN stores s ON s.id=pr.store_id WHERE pr.product_id=? ORDER BY pr.recorded_at DESC,pr.id DESC",
        id,
      ),
    };
  });

  app.get("/api/stores/:id/list", async (request) => {
    const id = paramId(request.params);
    const store = requireRow("stores", id);
    const list = get(
      "SELECT * FROM shopping_lists WHERE store_id=? AND active=1",
      id,
    );
    if (!list)
      throw new HttpError(404, "Este comercio no tiene una lista activa.");
    const items = all(
      `SELECT i.*,p.name,p.brand,p.category_id,p.package_amount,p.unit,c.name AS category_name
      FROM list_items i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id WHERE i.list_id=? ORDER BY i.position,i.id`,
      Number(list.id),
    );
    const prices = all(
      "SELECT pr.*,s.name AS store_name,s.active AS store_active FROM latest_prices pr JOIN stores s ON s.id=pr.store_id WHERE pr.product_id IN (SELECT product_id FROM list_items WHERE list_id=?) ORDER BY pr.cents,pr.store_id",
      Number(list.id),
    );
    return {
      store,
      list,
      items: items.map((i) => ({
        ...i,
        prices: prices.filter((p) => p.product_id === i.product_id),
      })),
    };
  });
  app.post("/api/lists/:id/items", async (request, reply) => {
    const listId = paramId(request.params);
    const { product_id, quantity } = z
      .object({
        product_id: idSchema,
        quantity: z.number().int().min(1).max(999).default(1),
      })
      .strict()
      .parse(request.body);
    const result = transaction(db, () =>
      addToList(listId, product_id, quantity),
    );
    return reply
      .code(result.changes ? 201 : 200)
      .send(
        get(
          "SELECT * FROM list_items WHERE list_id=? AND product_id=?",
          listId,
          product_id,
        ),
      );
  });
  app.put("/api/items/:id", async (request) => {
    const id = paramId(request.params),
      old = requireRow("list_items", id);
    const data = z
      .object({
        quantity: z.number().int().min(1).max(999).optional(),
        purchased: z.boolean().optional(),
        notes: notes.optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0)
      .parse(request.body);
    checkActiveList(Number(old.list_id));
    db.prepare(
      "UPDATE list_items SET quantity=?,purchased=?,notes=? WHERE id=?",
    ).run(
      data.quantity ?? old.quantity,
      data.purchased === undefined ? old.purchased : Number(data.purchased),
      data.notes ?? old.notes,
      id,
    );
    return requireRow("list_items", id);
  });
  app.delete("/api/items/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("list_items", id);
    db.prepare("DELETE FROM list_items WHERE id=?").run(id);
    return { ok: true };
  });
  app.delete("/api/lists/:id/purchased", async (request) => {
    const id = paramId(request.params);
    checkActiveList(id);
    z.object({ confirm: z.literal(true) })
      .strict()
      .parse(request.body);
    const result = db
      .prepare("DELETE FROM list_items WHERE list_id=? AND purchased=1")
      .run(id);
    return { removed: Number(result.changes) };
  });
  app.put("/api/lists/:id/order", async (request) => {
    const id = paramId(request.params);
    const { item_ids } = z
      .object({ item_ids: z.array(idSchema).max(10000) })
      .strict()
      .parse(request.body);
    transaction(db, () => {
      checkActiveList(id);
      const current = all("SELECT id FROM list_items WHERE list_id=?", id).map(
        (r) => Number(r.id),
      );
      if (
        new Set(item_ids).size !== item_ids.length ||
        current.length !== item_ids.length ||
        current.some((i) => !item_ids.includes(i))
      )
        throw new HttpError(
          409,
          "La lista ha cambiado. Recárgala antes de ordenar.",
        );
      item_ids.forEach((item, position) =>
        db
          .prepare("UPDATE list_items SET position=? WHERE id=? AND list_id=?")
          .run(position, item, id),
      );
    });
    return { ok: true };
  });

  app.get("/api/prices", async (request) => {
    const { store_id } = z
      .object({ store_id: idSchema.optional() })
      .parse(request.query);
    if (store_id) requireRow("stores", store_id);
    return all(
      `SELECT pr.*,p.name AS product_name,p.brand,p.package_amount,p.unit,s.name AS store_name,s.active AS store_active
      FROM latest_prices pr JOIN products p ON p.id=pr.product_id JOIN stores s ON s.id=pr.store_id
      ${store_id ? "WHERE pr.store_id=?" : ""} ORDER BY p.name COLLATE NOCASE,s.name`,
      ...(store_id ? [store_id] : []),
    );
  });
  app.post("/api/prices", async (request, reply) => {
    const data = priceSchema.parse(request.body);
    requireRow("products", data.product_id);
    requireRow("stores", data.store_id);
    const result = db
      .prepare(
        "INSERT INTO price_records (product_id,store_id,cents,recorded_at,created_at,notes,on_sale) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        data.product_id,
        data.store_id,
        parseCents(data.price),
        new Date(data.recorded_at ?? Date.now()).toISOString(),
        new Date().toISOString(),
        data.notes,
        Number(data.on_sale),
      );
    return reply
      .code(201)
      .send(requireRow("price_records", Number(result.lastInsertRowid)));
  });
  app.put("/api/prices/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("price_records", id);
    const data = priceSchema.parse(request.body);
    requireRow("products", data.product_id);
    requireRow("stores", data.store_id);
    db.prepare(
      "UPDATE price_records SET product_id=?,store_id=?,cents=?,recorded_at=?,notes=?,on_sale=? WHERE id=?",
    ).run(
      data.product_id,
      data.store_id,
      parseCents(data.price),
      new Date(data.recorded_at ?? Date.now()).toISOString(),
      data.notes,
      Number(data.on_sale),
      id,
    );
    return requireRow("price_records", id);
  });
  app.delete("/api/prices/:id", async (request) => {
    const id = paramId(request.params);
    requireRow("price_records", id);
    db.prepare("DELETE FROM price_records WHERE id=?").run(id);
    return { ok: true };
  });
  if (
    options.serveClient !== false &&
    existsSync(resolve("dist/client/index.html"))
  ) {
    await app.register(fastifyStatic, {
      root: resolve("dist/client"),
      setHeaders: (res, path) => {
        res.header(
          "Cache-Control",
          path.includes("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/api/") ||
        !["GET", "HEAD"].includes(request.method)
      )
        return reply.code(404).send({ message: "Ruta no encontrada." });
      return reply.sendFile("index.html");
    });
  }
  return app;
}

export type AppDatabase = DatabaseSync;
