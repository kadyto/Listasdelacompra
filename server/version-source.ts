import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const rootFiles = new Set([
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.server.json",
  "scripts/build-version.mjs",
]);
export type SourceEntry = { path: string; sha: string; type: string };
export function isApplicationSource(path: string) {
  return rootFiles.has(path) || /^(src|server|public)\//.test(path);
}
export function sourceFingerprint(entries: SourceEntry[]) {
  const files = entries
    .filter((entry) => entry.type === "blob" && isApplicationSource(entry.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!files.some((entry) => entry.path === "package.json"))
    throw new Error("No se puede identificar el código del proyecto.");
  return createHash("sha256")
    .update(files.map((entry) => `${entry.path}\0${entry.sha}\n`).join(""))
    .digest("hex");
}
export function localBuildInfo(root: string) {
  const entries: SourceEntry[] = [];
  function visit(directory = "") {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (
        entry.isDirectory() &&
        ["src", "server", "public", "scripts"].includes(path.split("/")[0])
      )
        visit(path);
      else if (entry.isFile() && isApplicationSource(path)) {
        const content = readFileSync(join(root, path));
        entries.push({
          path,
          type: "blob",
          sha: createHash("sha1")
            .update(`blob ${content.length}\0`)
            .update(content)
            .digest("hex"),
        });
      }
    }
  }
  visit();
  const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as { version: string };
  return { version, source: sourceFingerprint(entries) };
}
