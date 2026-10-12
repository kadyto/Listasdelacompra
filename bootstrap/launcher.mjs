import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  activeSchema,
  compareVersions,
  ensureDirectory,
  jobSchema,
  pendingSchema,
  readJson,
  releaseSchema,
  runtimePaths,
  writeJson,
} from "../dist/server/runtime-state.js";

const baseDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = releaseSchema.parse(
  JSON.parse(readFileSync(join(baseDirectory, "dist/version.json"), "utf8")),
);
const database = resolve(process.env.DATABASE_PATH ?? "/data/compra.sqlite");
const backups = resolve(process.env.BACKUP_DIRECTORY ?? "/backups");
const paths = runtimePaths(database);
ensureDirectory(paths.directory);
ensureDirectory(paths.releases);
let child,
  stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    child?.kill("SIGTERM");
  });

function activeRelease() {
  const value = readJson(paths.active);
  if (!value) return null;
  const active = activeSchema.parse(value);
  if (
    active.base_source !== base.source &&
    compareVersions(base.version, active.version) >= 0
  ) {
    rmSync(paths.active, { force: true });
    return null;
  }
  return active;
}
function releaseDirectory(active) {
  if (!active) return baseDirectory;
  const directory = join(paths.releases, active.source);
  if (!lstatSync(directory).isDirectory())
    throw new Error("La versión instalada no está disponible.");
  const info = releaseSchema.parse(
    JSON.parse(readFileSync(join(directory, "dist/version.json"), "utf8")),
  );
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (
    info.source !== active.source ||
    info.version !== active.version ||
    pkg.config?.runtimeUpdaterProtocol !== 1
  )
    throw new Error("La versión instalada no es compatible con este arranque.");
  return directory;
}
function restorePrevious(pending) {
  const source = join(backups, pending.backup_filename);
  const snapshot = new DatabaseSync(source, { readOnly: true });
  try {
    if (
      snapshot.prepare("PRAGMA integrity_check").get().integrity_check !==
        "ok" ||
      snapshot.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("La copia previa no supera la verificación.");
  } finally {
    snapshot.close();
  }
  // The child is stopped. Preserve its failed database and sidecars for recovery.
  const failed = join(
    paths.directory,
    `failed-${pending.job_id}-${randomUUID()}.sqlite`,
  );
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(database + suffix))
      renameSync(database + suffix, failed + suffix);
  }
  const temporary = `${database}.update-rollback.tmp`;
  copyFileSync(source, temporary);
  renameSync(temporary, database);
  if (pending.previous) writeJson(paths.active, pending.previous);
  else rmSync(paths.active, { force: true });
}
function finish(pending, phase, message) {
  const value = jobSchema.parse(readJson(paths.status));
  if (value.id !== pending.job_id)
    throw new Error("La actualización pendiente no coincide.");
  // Publish completion only after the activation journal is gone. A client may
  // start writing as soon as completion is visible, so rollback must be disabled.
  rmSync(paths.pending, { force: true });
  writeJson(paths.status, {
    ...value,
    phase,
    message,
    updated_at: new Date().toISOString(),
  });
}
function cleanReleases(current, previous) {
  const keep = new Set([current, previous]);
  for (const name of readdirSync(paths.releases)) {
    const path = join(paths.releases, name);
    if (
      /^[a-f0-9]{64}$/.test(name) &&
      !keep.has(name) &&
      lstatSync(path).isDirectory()
    )
      rmSync(path, { recursive: true, force: true });
  }
}
function start(active) {
  const directory = releaseDirectory(active);
  child = spawn(process.execPath, ["dist/server/index.js"], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_UPDATER_PROTOCOL: "1",
      APP_IMAGE_SOURCE: base.source,
      APP_PREFLIGHT: "",
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  const processChild = child;
  const exited = new Promise((resolveExit) =>
    processChild.once("close", (code, signal) => resolveExit({ code, signal })),
  );
  const ready = new Promise((resolveReady) => {
    const timeout = setTimeout(() => resolveReady(false), 45_000);
    processChild.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(timeout);
        resolveReady(true);
      }
    });
    processChild.once("exit", () => {
      clearTimeout(timeout);
      resolveReady(false);
    });
    processChild.once("error", () => {
      clearTimeout(timeout);
      resolveReady(false);
    });
  });
  return { ready, exited, process: processChild };
}

async function stop(processChild, exited) {
  processChild.kill("SIGTERM");
  const timer = setTimeout(() => processChild.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(timer);
}
try {
  while (!stopping) {
    const value = readJson(paths.pending);
    const pending = value ? pendingSchema.parse(value) : null;
    let active = activeRelease();
    if (pending) {
      // Recover an activation interrupted before the ready signal.
      if (active?.source === pending.release.source) restorePrevious(pending);
      if (
        pending.base_source !== base.source &&
        compareVersions(base.version, pending.release.version) >= 0
      ) {
        restorePrevious(pending);
        rmSync(paths.active, { force: true });
        finish(
          pending,
          "failed",
          "La actualización se ha cancelado al cambiar la imagen. Se han conservado los datos previos.",
        );
        active = null;
      } else {
        active = { ...pending.release, base_source: base.source };
        writeJson(paths.active, active);
      }
    }
    let running;
    try {
      running = start(active);
    } catch (error) {
      if (!pending) throw error;
      restorePrevious(pending);
      finish(
        pending,
        "failed",
        "No se pudo iniciar la nueva versión. Se han recuperado la aplicación y los datos anteriores.",
      );
      continue;
    }
    const ready = await running.ready;
    if (!ready) {
      await stop(running.process, running.exited);
      if (stopping) break;
      if (!pending) throw new Error("La aplicación no ha podido arrancar.");
      restorePrevious(pending);
      finish(
        pending,
        "failed",
        "La nueva versión no ha arrancado. Se han recuperado la aplicación y los datos anteriores.",
      );
      continue;
    }
    if (pending && existsSync(paths.pending)) {
      finish(
        pending,
        "completed",
        "Actualización instalada. Tus listas y precios se han conservado.",
      );
      try {
        cleanReleases(pending.release.source, pending.previous?.source);
      } catch {
        console.error("No se han podido eliminar algunas versiones antiguas.");
      }
    }
    const result = await running.exited;
    if (stopping) break;
    if (result.code === 75 && existsSync(paths.pending)) continue;
    process.exitCode = result.code ?? 1;
    break;
  }
} catch (error) {
  console.error("No se ha podido iniciar La Compra:", error.message);
  process.exitCode = 1;
}
