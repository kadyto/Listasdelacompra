import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as tar from "tar";
import { createApp } from "../server/app";
import { localBuildInfo } from "../server/version-source";
import { runtimePaths, writeJson } from "../server/runtime-state";
import { randomUUID } from "node:crypto";
import type { runBuildCommand, testRelease } from "../server/updater";

const commit = "c".repeat(40);
let directory: string,
  database: string,
  backups: string,
  source: string,
  archive: string;
let app: Awaited<ReturnType<typeof createApp>>;
let remote: ReturnType<typeof vi.fn<typeof fetch>>;
let run: ReturnType<typeof vi.fn<typeof runBuildCommand>>;
let preflight: ReturnType<typeof vi.fn<typeof testRelease>>;
let activate: ReturnType<typeof vi.fn>;

async function pack() {
  await tar.c({ cwd: join(directory, "source"), file: archive, gzip: true }, [
    `Listasdelacompra-${commit}`,
  ]);
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "compra-updater-"));
  database = join(directory, "db.sqlite");
  backups = join(directory, "backups");
  source = join(directory, "source", `Listasdelacompra-${commit}`);
  archive = join(directory, "source.tar.gz");
  mkdirSync(source, { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    JSON.stringify({ version: "1.3.1", config: { runtimeUpdaterProtocol: 1 } }),
  );
  writeFileSync(join(source, "package-lock.json"), "{}");
  await pack();
  remote = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (
      url ===
      "https://api.github.com/repos/kadyto/Listasdelacompra/commits/main"
    )
      return new Response(JSON.stringify({ sha: commit }));
    if (
      url ===
      `https://api.github.com/repos/kadyto/Listasdelacompra/commits/${commit}/check-runs?per_page=100`
    )
      return new Response(
        JSON.stringify({
          check_runs: [
            { id: 1, name: "app", status: "completed", conclusion: "success" },
            {
              id: 2,
              name: "container",
              status: "completed",
              conclusion: "success",
            },
          ],
        }),
      );
    if (
      url ===
      `https://codeload.github.com/kadyto/Listasdelacompra/tar.gz/${commit}`
    )
      return new Response(readFileSync(archive));
    throw new Error("Destino no autorizado en la prueba.");
  });
  run = vi
    .fn<typeof runBuildCommand>()
    .mockImplementation(async (stage, args) => {
      if (args[0] === "run") {
        const info = localBuildInfo(stage);
        mkdirSync(join(stage, "dist/client"), { recursive: true });
        writeFileSync(
          join(stage, "dist/client/index.html"),
          "<html>La Compra</html>",
        );
        writeFileSync(join(stage, "dist/version.json"), JSON.stringify(info));
      }
    });
  preflight = vi.fn<typeof testRelease>().mockResolvedValue(undefined);
  activate = vi.fn();
  app = await createApp({
    dbPath: database,
    backupDir: backups,
    seed: false,
    serveClient: false,
    buildInfo: { version: "1.3.0", source: "a".repeat(64) },
    updater: { enabled: true, fetch: remote, run, preflight, activate },
  });
  await app.inject({
    method: "POST",
    url: "/api/categories",
    payload: { name: "Datos anteriores" },
  });
});
afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
const status = async () =>
  (await app.inject({ method: "GET", url: "/api/updates" })).json();
const start = (payload: object = { confirm: true }) =>
  app.inject({ method: "POST", url: "/api/updates", payload });
async function finished(phase: string) {
  await vi.waitFor(async () => expect((await status()).job.phase).toBe(phase));
  return (await status()).job;
}

describe("Actualizar desde la aplicación", () => {
  it("prepara una versión aparte, mantiene los datos disponibles y guarda una copia antes de activar", async () => {
    let releaseInstall!: () => void;
    const install = new Promise<void>((resolveInstall) => {
      releaseInstall = resolveInstall;
    });
    const build = run.getMockImplementation()!;
    run.mockImplementation(async (...args) => {
      if (args[1][0] === "ci") await install;
      await build(...args);
    });
    const started = await start();
    expect(started.statusCode).toBe(202);
    expect((await start()).statusCode).toBe(409);
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/categories",
          payload: { name: "Guardado durante la instalación" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await app.inject({ method: "POST", url: "/api/backups" })).statusCode,
    ).toBe(409);
    releaseInstall();
    const job = await finished("restarting");
    expect(activate).toHaveBeenCalledTimes(1);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.map((call) => call[1][0])).toEqual([
      "ci",
      "run",
      "prune",
    ]);
    const pending = JSON.parse(
      readFileSync(runtimePaths(database).pending, "utf8"),
    );
    expect(pending.release.version).toBe("1.3.1");
    expect(pending.backup_filename).toBe(job.backup_filename);
    expect(
      existsSync(
        join(
          runtimePaths(database).releases,
          pending.release.source,
          "dist/version.json",
        ),
      ),
    ).toBe(true);
    const snapshot = new DatabaseSync(join(backups, job.backup_filename), {
      readOnly: true,
    });
    expect(
      snapshot
        .prepare("SELECT name FROM categories ORDER BY id")
        .all()
        .map((row) => row.name),
    ).toEqual(["Datos anteriores", "Guardado durante la instalación"]);
    snapshot.close();
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).statusCode,
    ).toBe(503);
    expect(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
    ).toBe(200);
    expect((await status()).enabled).toBe(true);
  });
  it("exige confirmación y no acepta URLs ni peticiones de otros sitios", async () => {
    expect((await start({ confirm: false })).statusCode).toBe(400);
    expect(
      (await start({ confirm: true, url: "https://otro-sitio.example/codigo" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/updates",
          payload: { confirm: true },
          headers: { "sec-fetch-site": "cross-site" },
        })
      ).statusCode,
    ).toBe(403);
    expect(remote).not.toHaveBeenCalled();
  });
  it("una compilación fallida conserva el código y los datos actuales", async () => {
    run.mockRejectedValueOnce(new Error("Compilación rechazada"));
    await start();
    expect((await finished("failed")).message).toBe("Compilación rechazada");
    expect(activate).not.toHaveBeenCalled();
    expect(existsSync(runtimePaths(database).pending)).toBe(false);
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).json()[0]
        .name,
    ).toBe("Datos anteriores");
    expect(readdirSync(runtimePaths(database).staging)).toEqual([]);
  });
  it("no ejecuta código de una versión que aún no ha pasado las pruebas de GitHub", async () => {
    const normal = remote.getMockImplementation()!;
    remote.mockImplementation(async (...args) => {
      if (String(args[0]).includes("/check-runs"))
        return new Response(
          JSON.stringify({
            check_runs: [
              {
                id: 1,
                name: "app",
                status: "completed",
                conclusion: "success",
              },
              {
                id: 2,
                name: "container",
                status: "in_progress",
                conclusion: null,
              },
            ],
          }),
        );
      return normal(...args);
    });
    await start();
    expect((await finished("failed")).message).toContain("pruebas de GitHub");
    expect(run).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });
  it("no cambia de versión si no puede guardar la copia previa", async () => {
    writeFileSync(backups, "No es una carpeta");
    await start();
    await finished("failed");
    expect(activate).not.toHaveBeenCalled();
    expect(existsSync(runtimePaths(database).pending)).toBe(false);
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).statusCode,
    ).toBe(200);
  });
  it("rechaza enlaces en el archivo antes de escribir o ejecutar el código", async () => {
    symlinkSync(database, join(source, "link.sqlite"));
    await pack();
    await start();
    await finished("failed");
    expect(run).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).json()[0]
        .name,
    ).toBe("Datos anteriores");
  });
  it("rechaza una versión anterior y un arranque incompatible antes de activar", async () => {
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({
        version: "1.2.0",
        config: { runtimeUpdaterProtocol: 1 },
      }),
    );
    await pack();
    await start();
    expect((await finished("failed")).message).toContain("anterior");
    expect(run).not.toHaveBeenCalled();
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({ version: "1.3.1" }),
    );
    await pack();
    await start();
    expect((await finished("failed")).message).toContain("Dockhand");
    expect(activate).not.toHaveBeenCalled();
  });
  it("la prueba previa detecta datos incompatibles sin tocar SQLite en uso", async () => {
    preflight.mockRejectedValueOnce(
      new Error("Datos incompatibles con la nueva versión"),
    );
    await start();
    expect((await finished("failed")).message).toContain("incompatibles");
    expect(activate).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).json()[0]
        .name,
    ).toBe("Datos anteriores");
  });
  it("el modo sin supervisor informa de que hay que instalar primero la imagen", async () => {
    await app.close();
    app = await createApp({ dbPath: database, serveClient: false });
    expect((await status()).enabled).toBe(false);
    expect((await start()).statusCode).toBe(409);
  });
  it("recupera una activación confirmada si se reinicia antes de guardar el mensaje final", async () => {
    await app.close();
    const paths = runtimePaths(database);
    writeJson(paths.active, {
      version: "1.3.1",
      source: "b".repeat(64),
      base_source: "a".repeat(64),
    });
    writeJson(paths.status, {
      id: randomUUID(),
      phase: "restarting",
      message: "Reiniciando…",
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      target_version: "1.3.1",
      target_source: "b".repeat(64),
    });
    app = await createApp({
      dbPath: database,
      serveClient: false,
      buildInfo: { version: "1.3.1", source: "b".repeat(64) },
      updater: { enabled: true, activate },
    });
    expect((await status()).job.phase).toBe("completed");
    expect(
      (await app.inject({ method: "GET", url: "/api/categories" })).statusCode,
    ).toBe(200);
  });
});
