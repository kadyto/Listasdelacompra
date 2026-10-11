import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  chmodSync,
  linkSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app";
import * as maintenance from "../server/maintenance";

let app: Awaited<ReturnType<typeof createApp>>;
let directory: string;
let dbPath: string;
let backupDir: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "compra-backups-api-"));
  dbPath = join(directory, "data.sqlite");
  backupDir = join(directory, "backups");
  app = await createApp({ dbPath, backupDir, serveClient: false });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
const backup = async () => {
  const response = await app.inject({ method: "POST", url: "/api/backups" });
  expect(response.statusCode).toBe(201);
  return response.json().filename as string;
};
const restore = (filename: string) =>
  app.inject({
    method: "POST",
    url: "/api/backups/restore",
    payload: { filename, confirm: true },
  });
const category = async (name: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/categories",
    payload: { name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as number;
};

describe("Copias y restauración desde Ajustes", () => {
  it("crea, lista y descarga una copia SQLite en la carpeta configurada", async () => {
    const filename = await backup();
    const list = await app.inject("/api/backups");
    expect(list.json()).toEqual([
      expect.objectContaining({ filename, automatic: false }),
    ]);
    maintenance.verifyBackup(join(backupDir, filename));
    const download = await app.inject(`/api/backups/${filename}/download`);
    expect(download.statusCode).toBe(200);
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["content-disposition"]).toContain(filename);
    expect(download.rawPayload).toEqual(
      readFileSync(join(backupDir, filename)),
    );
    expect(download.rawPayload.subarray(0, 16).toString()).toBe(
      "SQLite format 3\0",
    );
  });

  it("restaura con el servidor abierto y conserva los cambios posteriores en otra copia", async () => {
    const originalId = await category("Guardada en la copia");
    const filename = await backup();
    await category("Creada después");
    const response = await restore(filename);
    expect(response.statusCode).toBe(200);
    const names = (await app.inject("/api/categories"))
      .json()
      .map((row: { name: string }) => row.name);
    expect(names).toContain("Guardada en la copia");
    expect(names).not.toContain("Creada después");
    const previous = response.json().previous;
    const saved = new DatabaseSync(join(backupDir, previous), {
      readOnly: true,
    });
    expect(
      saved
        .prepare("SELECT name FROM categories WHERE name='Creada después'")
        .get(),
    ).toBeTruthy();
    saved.close();
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect(await category("Después de restaurar")).toBeGreaterThan(originalId);
    await app.close();
    app = await createApp({ dbPath, backupDir, serveClient: false });
    expect((await app.inject("/api/categories")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Guardada en la copia" }),
        expect.objectContaining({ name: "Después de restaurar" }),
      ]),
    );
  });

  it("exige confirmación, impide rutas externas y rechaza enlaces simbólicos", async () => {
    const filename = await backup();
    const confirmation = await app.inject({
      method: "POST",
      url: "/api/backups/restore",
      payload: { filename },
    });
    expect(confirmation.statusCode).toBe(400);
    expect((await restore("../data.sqlite")).statusCode).toBe(400);
    const external = join(directory, "external.sqlite");
    writeFileSync(external, "externo");
    symlinkSync(external, join(backupDir, "linked.sqlite"));
    expect((await restore("linked.sqlite")).statusCode).toBe(404);
    expect(
      (await app.inject("/api/backups/linked.sqlite/download")).statusCode,
    ).toBe(404);
    linkSync(dbPath, join(backupDir, "live.sqlite"));
    expect((await restore("live.sqlite")).statusCode).toBe(400);
    expect(
      (await app.inject("/api/backups/live.sqlite/download")).statusCode,
    ).toBe(400);
    expect(
      (await app.inject("/api/backups"))
        .json()
        .some(
          (file: { filename: string }) => file.filename === "linked.sqlite",
        ),
    ).toBe(false);
    const crossOrigin = await app.inject({
      method: "POST",
      url: "/api/backups/restore",
      payload: { filename, confirm: true },
      headers: {
        origin: "https://otro.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it("conserva la base si no se puede escribir la copia previa", async () => {
    const filename = await backup();
    await category("Datos que deben conservarse");
    chmodSync(backupDir, 0o500);
    try {
      expect((await restore(filename)).statusCode).toBe(400);
      expect(
        (await app.inject({ method: "POST", url: "/api/backups" })).statusCode,
      ).toBe(500);
      expect((await app.inject("/api/categories")).json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Datos que deben conservarse" }),
        ]),
      );
      await category("Aplicación disponible");
    } finally {
      chmodSync(backupDir, 0o700);
    }
  });

  it("rechaza copias inválidas o de otra versión sin cambiar los datos", async () => {
    const filename = await backup();
    await category("Datos actuales");
    writeFileSync(join(backupDir, "invalid.sqlite"), "No soy SQLite");
    expect((await restore("invalid.sqlite")).statusCode).toBe(400);
    const future = new DatabaseSync(join(backupDir, filename));
    future
      .prepare("INSERT INTO schema_migrations VALUES (?, ?)")
      .run("999_future.sql", new Date().toISOString());
    future.close();
    expect((await restore(filename)).statusCode).toBe(400);
    expect((await app.inject("/api/categories")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Datos actuales" }),
      ]),
    );
    expect((await app.inject("/api/health")).statusCode).toBe(200);
  });

  it("revierte toda la transacción si la inserción de un registro falla", async () => {
    const id = await category("Valor de la copia");
    const filename = await backup();
    await app.inject({
      method: "PUT",
      url: `/api/categories/${id}`,
      payload: { name: "Valor actual" },
    });
    const connection = new DatabaseSync(dbPath);
    connection.exec(`CREATE TRIGGER reject_restore BEFORE INSERT ON categories
      WHEN NEW.name='Valor de la copia' BEGIN SELECT RAISE(ABORT, 'Simulated restore failure'); END;`);
    connection.close();
    expect((await restore(filename)).statusCode).toBe(400);
    expect((await app.inject("/api/categories")).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Valor actual" }),
      ]),
    );
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect(await category("Sigue funcionando")).toBeGreaterThan(id);
  });

  it("bloquea peticiones durante la copia previa y vuelve a admitirlas al terminar", async () => {
    const filename = await backup();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const actual = maintenance.createBackup;
    vi.spyOn(maintenance, "createBackup").mockImplementation(
      async (source, target) => {
        entered();
        await pending;
        return actual(source, target);
      },
    );
    const operation = restore(filename);
    await started;
    try {
      expect((await app.inject("/api/dashboard")).statusCode).toBe(503);
      const mutation = await app.inject({
        method: "POST",
        url: "/api/categories",
        payload: { name: "Durante restauración" },
      });
      expect(mutation.statusCode).toBe(503);
      expect(
        (await app.inject({ method: "POST", url: "/api/backups" })).statusCode,
      ).toBe(503);
    } finally {
      release();
      await operation;
    }
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    await category("Después de la pausa");
  });
});
