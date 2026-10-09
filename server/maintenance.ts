import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  linkSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function verifyBackup(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const result = db.prepare("PRAGMA integrity_check").all();
    if (result.length !== 1 || result[0].integrity_check !== "ok")
      throw new Error(
        "La copia no supera la comprobación de integridad de SQLite.",
      );
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("La copia contiene relaciones inconsistentes.");
    for (const table of [
      "schema_migrations",
      "stores",
      "categories",
      "products",
      "shopping_lists",
      "list_items",
      "price_records",
    ])
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        throw new Error("El archivo no es una base de datos de La Compra.");
  } finally {
    db.close();
  }
}

export async function createBackup(source: string, target: string) {
  if (!existsSync(source))
    throw new Error("No existe la base de datos de origen.");
  if (existsSync(target))
    throw new Error(
      "El destino ya existe. Elige otro nombre; no se sobrescriben copias.",
    );
  if (resolve(source) === resolve(target))
    throw new Error("Origen y destino deben ser diferentes.");
  mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const db = new DatabaseSync(source, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");
  try {
    await backup(db, temporary);
    verifyBackup(temporary);
    chmodSync(temporary, 0o600);
    // Publish atomically without overwriting another backup with the same name.
    linkSync(temporary, target);
  } finally {
    db.close();
    rmSync(temporary, { force: true });
  }
}

export async function restoreBackup(source: string, target: string) {
  if (resolve(source) === resolve(target))
    throw new Error("Origen y destino deben ser diferentes.");
  verifyBackup(source);
  mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
  // This operation must run with every application instance stopped.
  const previous = existsSync(target)
    ? `${target}.before-restore-${randomUUID()}.sqlite`
    : null;
  if (previous) await createBackup(target, previous);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    copyFileSync(source, temporary);
    chmodSync(temporary, 0o600);
    verifyBackup(temporary);
    // Old WAL files belong to the previous database and must not be replayed.
    rmSync(`${target}-wal`, { force: true });
    rmSync(`${target}-shm`, { force: true });
    renameSync(temporary, target);
    return previous;
  } finally {
    rmSync(temporary, { force: true });
  }
}

if (process.argv[1] && /maintenance\.(ts|js)$/.test(process.argv[1])) {
  const [, , command, file, confirmation] = process.argv;
  const database = process.env.DATABASE_PATH ?? "./data/compra.sqlite";
  try {
    if (!file)
      throw new Error(
        "Uso: backup <destino.sqlite> | restore <copia.sqlite> --confirm-stopped",
      );
    if (command === "backup") {
      await createBackup(database, file);
      console.log("Copia SQLite consistente creada y verificada:", file);
    } else if (command === "restore") {
      if (confirmation !== "--confirm-stopped")
        throw new Error(
          "Detén la aplicación y todos los accesos a SQLite antes de restaurar. Añade --confirm-stopped después de detenerla.",
        );
      const previous = await restoreBackup(file, database);
      console.log(
        "Base de datos restaurada y verificada.",
        previous ? `Copia previa conservada: ${previous}` : "",
      );
    } else throw new Error("Comando desconocido. Usa backup o restore.");
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
