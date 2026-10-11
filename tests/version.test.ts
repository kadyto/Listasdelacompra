import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createApp } from "../server/app";
import { installedBuild } from "../server/version";
import { localBuildInfo, sourceFingerprint } from "../server/version-source";

const tree = {
  truncated: false,
  tree: [
    { path: "package.json", sha: "a".repeat(40), type: "blob" },
    { path: "src/App.tsx", sha: "b".repeat(40), type: "blob" },
    { path: "README.md", sha: "c".repeat(40), type: "blob" },
  ],
};
const build = { version: "1.1.0", source: sourceFingerprint(tree.tree) };
let app: Awaited<ReturnType<typeof createApp>>;
let directory: string;
let clock: number;
let remote: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "compra-version-"));
  clock = Date.parse("2026-10-11T12:00:00Z");
  remote = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify(tree), { headers: { etag: '"tree-1"' } }),
    );
  app = await createApp({
    dbPath: join(directory, "db.sqlite"),
    seed: false,
    serveClient: false,
    buildInfo: build,
    updateFetch: remote,
    updateNow: () => clock,
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
const check = () => app.inject({ method: "GET", url: "/api/version/check" });

describe("Versión instalada y actualizaciones", () => {
  it("muestra la compilación instalada sin depender de Internet", async () => {
    const response = await app.inject({ method: "GET", url: "/api/version" });
    expect(response.json()).toEqual({
      ...build,
      projectUrl: "https://github.com/kadyto/Listasdelacompra",
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(remote).not.toHaveBeenCalled();
  });
  it("compara el código con main, comparte peticiones y limita las consultas a una por hora", async () => {
    const replies = await Promise.all([check(), check(), check()]);
    expect(remote).toHaveBeenCalledTimes(1);
    for (const reply of replies) {
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toMatchObject({
        ...build,
        status: "current",
        checkedAt: new Date(clock).toISOString(),
      });
    }
    const [url, options] = remote.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/kadyto/Listasdelacompra/git/trees/main?recursive=1",
    );
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).not.toHaveProperty("Authorization");
    clock += 59 * 60_000;
    expect((await check()).json().status).toBe("current");
    expect(remote).toHaveBeenCalledTimes(1);
    clock += 60_000;
    remote.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await check()).json()).toMatchObject({
      status: "current",
      checkedAt: new Date(clock).toISOString(),
    });
    expect(remote).toHaveBeenCalledTimes(2);
    expect(remote.mock.calls[1][1]?.headers).toHaveProperty(
      "If-None-Match",
      '"tree-1"',
    );
  });
  it("detecta un cambio de código aunque el número de versión sea el mismo", async () => {
    const changed = structuredClone(tree);
    changed.tree[1].sha = "d".repeat(40);
    remote.mockResolvedValueOnce(new Response(JSON.stringify(changed)));
    expect((await check()).json()).toMatchObject({
      ...build,
      status: "available",
    });
  });
  it("los cambios solo en documentación no provocan una actualización de la aplicación", async () => {
    const changed = structuredClone(tree);
    changed.tree.reverse();
    changed.tree.find((entry) => entry.path === "README.md")!.sha = "d".repeat(
      40,
    );
    remote.mockResolvedValueOnce(new Response(JSON.stringify(changed)));
    expect((await check()).json().status).toBe("current");
  });
  it("no dice al día si falla GitHub y vuelve a intentarlo tras cinco minutos", async () => {
    remote.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await check()).json()).toMatchObject({
      status: "unknown",
      nextCheckAt: new Date(clock + 5 * 60_000).toISOString(),
    });
    await check();
    expect(remote).toHaveBeenCalledTimes(1);
    clock += 5 * 60_000;
    expect((await check()).json().status).toBe("current");
    clock += 60 * 60_000;
    remote.mockRejectedValueOnce(new Error("Sin red"));
    expect((await check()).json().status).toBe("unknown");
    expect(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
    ).toBe(200);
  });
  it.each([
    { ...tree, truncated: true },
    { tree: [] },
    { truncated: false, tree: [] },
    {
      truncated: false,
      tree: [{ path: "package.json", sha: "inválido", type: "blob" }],
    },
  ])(
    "rechaza respuestas incompletas sin confundirlas con una actualización: %j",
    async (body) => {
      remote.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      expect((await check()).json().status).toBe("unknown");
    },
  );
  it("una imagen sin identificador no declara estar actualizada", async () => {
    await app.close();
    app = await createApp({
      dbPath: join(directory, "db.sqlite"),
      serveClient: false,
      buildInfo: { version: "1.1.0", source: null },
      updateFetch: remote,
    });
    expect((await check()).json().status).toBe("unknown");
    expect(remote).not.toHaveBeenCalled();
  });
  it("identifica archivos locales igual que GitHub sin necesitar un directorio .git", () => {
    const content = '{"version":"1.1.0"}\n';
    writeFileSync(join(directory, "package.json"), content);
    writeFileSync(join(directory, "README.md"), "Solo documentación");
    const sha = createHash("sha1")
      .update(`blob ${Buffer.byteLength(content)}\0`)
      .update(content)
      .digest("hex");
    expect(localBuildInfo(directory)).toEqual({
      version: "1.1.0",
      source: sourceFingerprint([{ path: "package.json", sha, type: "blob" }]),
    });
  });
  it("la versión de producción queda fijada a la compilación aunque se modifique el código local", () => {
    mkdirSync(join(directory, "dist"));
    writeFileSync(join(directory, "dist/version.json"), JSON.stringify(build));
    writeFileSync(join(directory, "package.json"), '{"version":"9.9.9"}');
    vi.stubEnv("NODE_ENV", "production");
    expect(installedBuild(directory)).toEqual(build);
  });
  it("una imagen sin metadatos conserva el número de versión y deja la revisión desconocida", () => {
    writeFileSync(join(directory, "package.json"), '{"version":"1.1.0"}');
    vi.stubEnv("NODE_ENV", "production");
    expect(installedBuild(directory)).toEqual({
      version: "1.1.0",
      source: null,
    });
  });
});
