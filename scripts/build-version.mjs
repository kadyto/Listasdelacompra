import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localBuildInfo } from "../server/version-source.ts";

// The source itself identifies the build, including GitHub archives without .git.
const info = localBuildInfo(process.cwd());
mkdirSync(resolve("dist"), { recursive: true });
writeFileSync(resolve("dist/version.json"), JSON.stringify(info) + "\n");
console.log(`Versión instalada: v${info.version} · ${info.source.slice(0, 8)}`);
