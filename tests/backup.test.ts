import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
} from "../server/maintenance";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "compra-backup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("Copias consistentes y restauración", () => {
  it("no sobrescribe el destino cuando coinciden dos copias concurrentes", async () => {
    const path = join(dir, "db.sqlite"),
      snapshot = join(dir, "snapshot.sqlite");
    openDatabase(path).close();
    const results = await Promise.allSettled([
      createBackup(path, snapshot),
      createBackup(path, snapshot),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    verifyBackup(snapshot);
  });
  it("respeta categorías eliminadas y comercios desactivados tras reiniciar", () => {
    const path = join(dir, "db.sqlite"),
      db = openDatabase(path);
    db.exec("DELETE FROM categories; UPDATE stores SET active=0");
    db.close();
    const reopened = openDatabase(path);
    expect(
      reopened.prepare("SELECT COUNT(*) AS n FROM categories").get()?.n,
    ).toBe(0);
    expect(
      reopened.prepare("SELECT COUNT(*) AS n FROM stores WHERE active=1").get()
        ?.n,
    ).toBe(0);
    reopened.close();
  });
  it("copia con WAL y aplicación abierta, restaura y conserva una copia previa", async () => {
    const path = join(dir, "db.sqlite"),
      snapshot = join(dir, "snapshot.sqlite");
    const db = openDatabase(path);
    db.prepare(
      "INSERT INTO categories (name,normalized_name) VALUES (?,?)",
    ).run("Nueva categoría", "nueva categoria");
    await createBackup(path, snapshot);
    verifyBackup(snapshot);
    db.prepare("DELETE FROM categories WHERE name=?").run("Nueva categoría");
    db.close();
    const previous = await restoreBackup(snapshot, path);
    expect(previous).toBeTruthy();
    const restored = openDatabase(path);
    expect(
      restored
        .prepare("SELECT name FROM categories WHERE name=?")
        .get("Nueva categoría"),
    ).toBeTruthy();
    restored.close();
    const prior = openDatabase(previous!, false);
    expect(
      prior
        .prepare("SELECT name FROM categories WHERE name=?")
        .get("Nueva categoría"),
    ).toBeUndefined();
    prior.close();
  });
  it("rechaza archivos inválidos sin dañar la base actual ni sobrescribir copias", async () => {
    const path = join(dir, "db.sqlite"),
      bad = join(dir, "bad.sqlite");
    openDatabase(path).close();
    const before = readFileSync(path);
    writeFileSync(bad, "No soy SQLite");
    await expect(restoreBackup(bad, path)).rejects.toThrow();
    expect(readFileSync(path)).toEqual(before);
    const snapshot = join(dir, "snapshot.sqlite");
    await createBackup(path, snapshot);
    await expect(createBackup(path, snapshot)).rejects.toThrow("ya existe");
  });
});
