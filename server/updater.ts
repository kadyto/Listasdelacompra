import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as tar from "tar";
import { z } from "zod";
import { createBackup } from "./maintenance.js";
import { localBuildInfo } from "./version-source.js";
import type { BuildInfo } from "./version.js";
import {
  activeSchema,
  compareVersions,
  ensureDirectory,
  jobSchema,
  readJson,
  releaseSchema,
  runtimePaths,
  writeJson,
  type UpdateJob,
} from "./runtime-state.js";

export interface UpdaterOptions {
  enabled?: boolean;
  fetch?: typeof fetch;
  run?: typeof runBuildCommand;
  preflight?: typeof testRelease;
  activate?: () => void;
}
const packageSchema = z.object({
  version: releaseSchema.shape.version,
  config: z.object({ runtimeUpdaterProtocol: z.literal(1) }),
});
const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) });
const checksSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});
const activePhases = new Set([
  "downloading",
  "installing",
  "building",
  "testing",
  "backing-up",
  "restarting",
]);

// Validate the complete archive before extracting anything. Both compressed and
// expanded sizes are bounded; links and paths outside the GitHub root are rejected.
export function extractSource(
  archive: string,
  directory: string,
  commit: string,
) {
  const raw = `${archive}.tar`;
  try {
    writeFileSync(
      raw,
      gunzipSync(readFileSync(archive), { maxOutputLength: 32 * 1024 * 1024 }),
      { mode: 0o600 },
    );
    let count = 0;
    const seen = new Set<string>();
    tar.t({
      file: raw,
      sync: true,
      strict: true,
      onReadEntry(entry) {
        const parts = entry.path.replace(/\/$/, "").split("/");
        if (
          !["File", "Directory"].includes(entry.type) ||
          entry.path.includes("\\") ||
          parts.some((part) => !part || part === "." || part === "..") ||
          parts[0] !== `Listasdelacompra-${commit}` ||
          entry.path.length > 500 ||
          seen.has(entry.path) ||
          ++count > 5000
        )
          throw new Error("El archivo de GitHub no es válido para actualizar.");
        seen.add(entry.path);
      },
    });
    ensureDirectory(directory);
    tar.x({
      file: raw,
      cwd: directory,
      strip: 1,
      sync: true,
      strict: true,
      preserveOwner: false,
      noMtime: true,
    });
    if (!existsSync(join(directory, "package-lock.json")))
      throw new Error("Falta el archivo de dependencias de la actualización.");
    return packageSchema.parse(
      JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
    );
  } finally {
    rmSync(raw, { force: true });
  }
}

export async function runBuildCommand(
  directory: string,
  args: string[],
  signal: AbortSignal,
  cache: string,
  log: string,
) {
  signal.throwIfAborted();
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(
      "npm",
      [...args, "--cache", cache, "--no-audit", "--no-fund"],
      {
        cwd: directory,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GOMAXPROCS: "2",
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=768`,
        },
      },
    );
    let bytes = 0,
      logFailed = false,
      interrupted = false,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const output = (data: Buffer) => {
      try {
        if (bytes < 256 * 1024)
          appendFileSync(log, data.subarray(0, 256 * 1024 - bytes), {
            mode: 0o600,
          });
      } catch {
        logFailed = true;
        kill();
      }
      bytes += data.length;
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    const kill = () => {
      interrupted = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* Already stopped. */
        }
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* Already stopped. */
          }
        }, 3000);
      }
    };
    const timeout = setTimeout(kill, 5 * 60_000);
    signal.addEventListener("abort", kill, { once: true });
    const clean = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal.removeEventListener("abort", kill);
    };
    child.once("error", () => {
      clean();
      reject(
        new Error(
          "No se ha podido ejecutar la compilación. Actualiza primero la imagen desde Dockhand.",
        ),
      );
    });
    child.once("close", (code) => {
      clean();
      if (code === 0 && !interrupted && !logFailed) resolveRun();
      else
        reject(
          new Error(
            logFailed
              ? "No se pudo escribir el registro de actualización. Comprueba el espacio y los permisos."
              : interrupted
                ? "La preparación de la actualización se ha interrumpido o ha tardado demasiado."
                : "No se ha podido preparar la actualización. Revisa el acceso a GitHub y al registro de npm, el espacio y la memoria disponibles.",
          ),
        );
    });
  });
}

export async function testRelease(
  directory: string,
  database: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const probe = join(directory, ".preflight");
  ensureDirectory(probe);
  const copy = join(probe, "compra.sqlite");
  await createBackup(database, copy);
  signal.throwIfAborted();
  const child = spawn(process.execPath, ["dist/server/index.js"], {
    cwd: directory,
    env: {
      ...process.env,
      DATABASE_PATH: copy,
      BACKUP_DIRECTORY: join(probe, "backups"),
      PORT: "0",
      HOST: "127.0.0.1",
      APP_UPDATER_PROTOCOL: "0",
      APP_PREFLIGHT: "1",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const closed = new Promise((resolveClose) =>
    child.once("close", resolveClose),
  );
  try {
    await new Promise<void>((resolveReady, reject) => {
      const fail = () =>
        reject(
          new Error(
            "La nueva versión no supera la prueba con una copia de tus datos.",
          ),
        );
      const timeout = setTimeout(fail, 45_000);
      const abort = () => {
        clearTimeout(timeout);
        fail();
      };
      signal.addEventListener("abort", abort, { once: true });
      const clear = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      };
      child.on("message", (message) => {
        if ((message as { type?: string })?.type === "ready") {
          clear();
          resolveReady();
        }
      });
      child.once("error", () => {
        clear();
        fail();
      });
      child.once("exit", () => {
        clear();
        fail();
      });
    });
  } finally {
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closed;
    clearTimeout(timeout);
    rmSync(probe, { recursive: true, force: true });
  }
}

export function createUpdater(
  databasePath: string,
  backupDirectory: string,
  installed: BuildInfo,
  beforePause: () => void,
  options: UpdaterOptions = {},
) {
  const enabled =
    options.enabled ??
    (process.env.APP_UPDATER_PROTOCOL === "1" &&
      typeof process.send === "function");
  const request = options.fetch ?? fetch;
  const command = options.run ?? runBuildCommand;
  const preflight = options.preflight ?? testRelease;
  const paths = runtimePaths(databasePath);
  let worker: Promise<void> | undefined,
    controller: AbortController | undefined;
  let paused = false;
  let memoryFailure: UpdateJob | null = null;
  function job() {
    if (memoryFailure) return memoryFailure;
    const value = readJson(paths.status);
    return value ? jobSchema.parse(value) : null;
  }
  if (enabled) {
    ensureDirectory(paths.directory);
    const previous = job();
    const pending = existsSync(paths.pending);
    paused = previous?.phase === "restarting" && pending;
    if (previous && activePhases.has(previous.phase) && !pending) {
      const activeValue = readJson(paths.active);
      const active = activeValue ? activeSchema.parse(activeValue) : null;
      const committed =
        previous.phase === "restarting" &&
        active?.source === previous.target_source;
      const recovered: UpdateJob = {
        ...previous,
        phase: committed ? "completed" : "failed",
        message: committed
          ? "Actualización instalada. Tus listas y precios se han conservado."
          : "La preparación se interrumpió al reiniciar. Puedes volver a intentarlo.",
        updated_at: new Date().toISOString(),
      };
      try {
        writeJson(paths.status, recovered);
      } catch {
        memoryFailure = recovered;
      }
    }
  }
  function phase(value: UpdateJob, next: UpdateJob["phase"], message: string) {
    Object.assign(value, {
      phase: next,
      message,
      updated_at: new Date().toISOString(),
    });
    writeJson(paths.status, value);
  }
  async function download(url: string, file: string, signal: AbortSignal) {
    const response = await request(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: "error",
    });
    if (!response.ok || !response.body)
      throw new Error("No se ha podido descargar el código de GitHub.");
    const reader = response.body.getReader(),
      fd = openSync(file, "wx", 0o600);
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 8 * 1024 * 1024)
          throw new Error(
            "El código descargado supera el tamaño permitido para actualizar.",
          );
        writeSync(fd, chunk.value);
      }
    } finally {
      closeSync(fd);
      await reader.cancel();
    }
  }
  async function prepare(value: UpdateJob, signal: AbortSignal) {
    const archive = join(paths.staging, `${value.id}.gz`),
      stage = join(paths.staging, value.id);
    let published: string | undefined;
    try {
      const response = await request(
        "https://api.github.com/repos/kadyto/Listasdelacompra/commits/main",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Listasdelacompra-updater",
            "Cache-Control": "no-cache",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Error(
          "No se ha podido identificar la nueva versión en GitHub.",
        );
      const { sha } = commitSchema.parse(await response.json());
      const checksResponse = await request(
        `https://api.github.com/repos/kadyto/Listasdelacompra/commits/${sha}/check-runs?per_page=100`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Listasdelacompra-updater",
            "Cache-Control": "no-cache",
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          redirect: "error",
        },
      );
      if (!checksResponse.ok)
        throw new Error(
          "No se han podido comprobar las pruebas de la nueva versión en GitHub.",
        );
      const checks = checksSchema
        .parse(await checksResponse.json())
        .check_runs.sort((a, b) => b.id - a.id);
      for (const name of ["app", "container"]) {
        const check = checks.find((candidate) => candidate.name === name);
        if (check?.status !== "completed" || check.conclusion !== "success")
          throw new Error(
            "La nueva versión aún no ha superado todas las pruebas de GitHub. Espera a que terminen y vuelve a intentarlo.",
          );
      }
      await download(
        `https://codeload.github.com/kadyto/Listasdelacompra/tar.gz/${sha}`,
        archive,
        signal,
      );
      const pkg = extractSource(archive, stage, sha);
      const expected = localBuildInfo(stage);
      if (compareVersions(pkg.version, installed.version) < 0)
        throw new Error(
          "La versión de GitHub es anterior a la instalada. No se aplicará automáticamente.",
        );
      if (expected.source === installed.source) {
        phase(
          value,
          "completed",
          "Ya tienes instalado el código actual de GitHub.",
        );
        return;
      }
      if (pkg.version.split(".").some((part) => Number(part) > 1_000_000))
        throw new Error("La versión descargada no es válida.");
      if (pkg.version.split(".").map(Number).join(".") !== pkg.version)
        throw new Error("La versión descargada no es válida.");
      if (pkg.version.length > 32)
        throw new Error("La versión descargada no es válida.");
      value.target_version = pkg.version;
      value.target_source = expected.source;
      phase(
        value,
        "installing",
        "Instalando las dependencias de la nueva versión. Puedes seguir utilizando tus listas.",
      );
      await command(
        stage,
        ["ci", "--include=dev", "--engine-strict"],
        signal,
        paths.cache,
        join(paths.directory, "build.log"),
      );
      phase(
        value,
        "building",
        "Compilando la nueva versión. La aplicación sigue disponible.",
      );
      await command(
        stage,
        ["run", "build"],
        signal,
        paths.cache,
        join(paths.directory, "build.log"),
      );
      const built = releaseSchema.parse(
        JSON.parse(readFileSync(join(stage, "dist/version.json"), "utf8")),
      );
      if (
        built.source !== expected.source ||
        built.version !== pkg.version ||
        !existsSync(join(stage, "dist/client/index.html"))
      )
        throw new Error("La compilación no corresponde al código descargado.");
      await command(
        stage,
        ["prune", "--omit=dev"],
        signal,
        paths.cache,
        join(paths.directory, "build.log"),
      );
      phase(
        value,
        "testing",
        "Comprobando la nueva versión con una copia temporal de tus datos.",
      );
      await preflight(stage, databasePath, signal);
      signal.throwIfAborted();
      beforePause();
      paused = true;
      phase(
        value,
        "backing-up",
        "Guardando una copia de seguridad antes de cambiar de versión.",
      );
      const filename = `antes-de-actualizar-${pkg.version}-${new Date().toISOString().replace(/[:.]/g, "-")}-${value.id.slice(0, 8)}.sqlite`;
      await createBackup(databasePath, join(backupDirectory, filename));
      signal.throwIfAborted();
      value.backup_filename = filename;
      const previousValue = readJson(paths.active);
      const previous = previousValue ? activeSchema.parse(previousValue) : null;
      published = join(paths.releases, built.source);
      if (existsSync(published)) {
        if (
          previous?.source === built.source ||
          !lstatSync(published).isDirectory()
        )
          throw new Error("La carpeta de la nueva versión no es válida.");
        rmSync(published, { recursive: true });
      }
      renameSync(stage, published);
      const baseSource = process.env.APP_IMAGE_SOURCE ?? installed.source;
      if (!baseSource)
        throw new Error("No se puede identificar la imagen de arranque.");
      writeJson(paths.pending, {
        job_id: value.id,
        release: built,
        previous,
        base_source: baseSource,
        backup_filename: filename,
      });
      phase(
        value,
        "restarting",
        "Reiniciando la aplicación con la nueva versión…",
      );
      options.activate?.();
    } catch (error) {
      paused = false;
      rmSync(paths.pending, { force: true });
      if (published) rmSync(published, { recursive: true, force: true });
      phase(
        value,
        "failed",
        error instanceof z.ZodError
          ? "La nueva versión necesita actualizar la imagen desde Dockhand."
          : (error as Error).message,
      );
    } finally {
      rmSync(archive, { force: true });
      rmSync(stage, { recursive: true, force: true });
    }
  }
  return {
    enabled,
    get busy() {
      return Boolean(worker) || (enabled && existsSync(paths.pending));
    },
    get dataPaused() {
      if (paused && !worker && !activePhases.has(job()?.phase ?? ""))
        paused = false;
      return paused;
    },
    status() {
      return { enabled, job: enabled ? job() : null };
    },
    start() {
      if (!enabled || !options.activate)
        throw new Error(
          "Instala primero la imagen actualizada desde Dockhand para habilitar este botón.",
        );
      if (worker || existsSync(paths.pending))
        throw new Error("Ya hay una actualización en curso.");
      beforePause();
      for (const path of [
        paths.directory,
        paths.staging,
        paths.releases,
        paths.cache,
      ])
        ensureDirectory(path);
      const log = join(paths.directory, "build.log");
      if (existsSync(log) && !lstatSync(log).isFile())
        throw new Error("El registro de actualización no es válido.");
      writeFileSync(log, "", { mode: 0o600 });
      const disk = statfsSync(paths.directory),
        databaseBytes = statSync(databasePath).size;
      if (
        Number(disk.bavail) * Number(disk.bsize) <
        512 * 1024 * 1024 + 3 * databaseBytes
      )
        throw new Error(
          "No hay suficiente espacio libre. Se necesitan al menos 512 MB más el espacio para las copias de los datos.",
        );
      const value: UpdateJob = {
        id: randomUUID(),
        phase: "downloading",
        message: "Descargando la versión actual de main desde GitHub…",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      writeJson(paths.status, value);
      memoryFailure = null;
      controller = new AbortController();
      worker = prepare(value, controller.signal)
        .catch(() => {
          paused = false;
          memoryFailure = {
            ...value,
            phase: "failed",
            message:
              "No se pudo guardar el estado de actualización. Revisa el espacio y los permisos del volumen de datos.",
            updated_at: new Date().toISOString(),
          };
        })
        .finally(() => {
          worker = undefined;
        });
      return value;
    },
    async stop() {
      if (worker) {
        controller?.abort();
        await worker;
      }
    },
  };
}
