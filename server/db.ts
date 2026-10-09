import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const normalize = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
export const productIdentity = (
  name: string,
  brand: string,
  amount: number,
  unit: string,
) =>
  JSON.stringify([
    normalize(name),
    normalize(brand),
    Number(
      (unit === "ml" || unit === "g" ? amount / 1000 : amount).toPrecision(12),
    ),
    unit === "ml" ? "l" : unit === "g" ? "kg" : unit,
  ]);

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path: string, seed = true) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const dir = resolve("server/migrations");
  if (!existsSync(dir)) {
    db.close();
    throw new Error(
      "No se encuentra server/migrations. Inicia la aplicación desde la raíz del proyecto.",
    );
  }
  try {
    for (const file of readdirSync(dir)
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort()) {
      transaction(db, () => {
        if (
          !db
            .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
            .get(file)
        ) {
          db.exec(readFileSync(resolve(dir, file), "utf8"));
          db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(
            file,
            new Date().toISOString(),
          );
        }
      });
    }
    if (seed)
      transaction(db, () => {
        // Only the first installation gets household defaults. No products or fictitious prices.
        if (
          db
            .prepare("SELECT 1 FROM app_metadata WHERE key='household_seeded'")
            .get()
        )
          return;
        if (!db.prepare("SELECT 1 FROM categories LIMIT 1").get()) {
          for (const name of [
            "Fruta y verdura",
            "Despensa",
            "Lácteos y huevos",
            "Carne y pescado",
            "Bebidas",
            "Congelados",
            "Limpieza",
            "Higiene",
            "Otros",
          ])
            db.prepare(
              "INSERT INTO categories (name, normalized_name) VALUES (?, ?)",
            ).run(name, normalize(name));
        }
        if (!db.prepare("SELECT 1 FROM stores LIMIT 1").get()) {
          for (const name of ["Carrefour", "Costco", "DIA", "Mercadona"]) {
            const store = db
              .prepare(
                "INSERT INTO stores (name, normalized_name) VALUES (?, ?)",
              )
              .run(name, normalize(name));
            db.prepare(
              "INSERT INTO shopping_lists (store_id, created_at) VALUES (?, ?)",
            ).run(store.lastInsertRowid, new Date().toISOString());
          }
        }
        db.prepare(
          "INSERT INTO app_metadata (key, value) VALUES ('household_seeded', 'true')",
        ).run();
      });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
