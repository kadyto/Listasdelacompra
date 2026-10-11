import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { localBuildInfo, sourceFingerprint } from "./version-source.js";

export const projectUrl = "https://github.com/kadyto/Listasdelacompra";
const treeUrl =
  "https://api.github.com/repos/kadyto/Listasdelacompra/git/trees/main?recursive=1";
export type BuildInfo = { version: string; source: string | null };
export type UpdateResult = {
  status: "current" | "available" | "unknown";
  checkedAt: string;
  nextCheckAt: string;
};
const buildSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  source: z.string().regex(/^[a-f0-9]{64}$/),
});
const treeSchema = z.object({
  truncated: z.literal(false),
  tree: z.array(
    z.object({
      path: z.string(),
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      type: z.string(),
    }),
  ),
});
export function installedBuild(root = process.cwd()): BuildInfo {
  try {
    return buildSchema.parse(
      process.env.NODE_ENV === "production" ||
        new URL(import.meta.url).pathname.endsWith(".js")
        ? JSON.parse(readFileSync(resolve(root, "dist/version.json"), "utf8"))
        : localBuildInfo(root),
    );
  } catch {
    // Never infer the installed revision from the current GitHub branch.
    const { version } = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { version: string };
    return { version, source: null };
  }
}
export function createUpdateChecker(
  installed: BuildInfo,
  options: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: UpdateResult | undefined;
  let pending: Promise<UpdateResult> | undefined;
  let etag: string | undefined;
  let latestSource: string | undefined;
  async function check(): Promise<UpdateResult> {
    let status: UpdateResult["status"] = "unknown";
    let lifetime = 5 * 60_000;
    try {
      if (!installed.source) throw new Error("Compilación sin identificador.");
      const response = await request(treeUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Listasdelacompra-update-check",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(etag ? { "If-None-Match": etag } : {}),
        },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (response.status === 304 && latestSource) {
        // Reuse the previous tree only after GitHub confirms it has not changed.
      } else {
        if (!response.ok) throw new Error("GitHub no está disponible.");
        const tree = treeSchema.parse(await response.json());
        latestSource = sourceFingerprint(tree.tree);
        etag = response.headers.get("etag") ?? undefined;
      }
      status = latestSource === installed.source ? "current" : "available";
      lifetime = 60 * 60_000;
    } catch {
      // Offline, rate limits and malformed replies must never appear as 'current'.
    }
    const checked = now();
    return (cached = {
      status,
      checkedAt: new Date(checked).toISOString(),
      nextCheckAt: new Date(checked + lifetime).toISOString(),
    });
  }
  return function updates() {
    if (cached && now() < Date.parse(cached.nextCheckAt))
      return Promise.resolve(cached);
    if (!pending)
      pending = check().finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
