import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// Isolated sources served by a fetch mock to exercise the real updater without
// publishing test versions or allowing a configurable production download URL.
export function createUpdateFixtures(directory) {
  mkdirSync(directory, { recursive: true });
  const files = [
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.server.json",
    "src",
    "server",
    "public",
    "scripts",
    "bootstrap",
  ];
  const current = JSON.parse(readFileSync(resolve("package.json"), "utf8"))
    .version.split(".")
    .map(Number);
  const versions = [];
  for (const [name, broken, increment] of [
    ["good", false, 1],
    ["bad", true, 2],
  ]) {
    const sha = createHash("sha1").update(name).digest("hex");
    const parent = join(directory, name),
      root = join(parent, `Listasdelacompra-${sha}`);
    mkdirSync(root, { recursive: true });
    for (const file of files)
      cpSync(resolve(file), join(root, file), { recursive: true });
    const version = `${current[0]}.${current[1]}.${current[2] + increment}`;
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    pkg.version = version;
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
    const lock = JSON.parse(
      readFileSync(join(root, "package-lock.json"), "utf8"),
    );
    lock.version = lock.packages[""].version = version;
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify(lock, null, 2) + "\n",
    );
    const pages = join(root, "src/pages.tsx");
    writeFileSync(
      pages,
      readFileSync(pages, "utf8").replace(
        "Todas tus listas. Los precios que recuerdas.",
        "La actualización desde el contenedor funciona.",
      ),
    );
    if (broken) {
      writeFileSync(
        join(root, "server/migrations/004_update_test.sql"),
        "UPDATE products SET notes='Este cambio debe revertirse'; CREATE TABLE update_test_only (id INTEGER PRIMARY KEY);\n",
      );
      const index = join(root, "server/index.ts"),
        code = readFileSync(index, "utf8");
      const marker = '  process.send?.({ type: "ready" });';
      if (!code.includes(marker))
        throw new Error("No se puede preparar la prueba de recuperación.");
      writeFileSync(
        index,
        code.replace(
          marker,
          '  if (process.env.APP_PREFLIGHT !== "1") throw new Error("Fallo simulado después de migrar");\n' +
            marker,
        ),
      );
    }
    execFileSync("tar", [
      "-czf",
      join(directory, `${name}.tar.gz`),
      "-C",
      parent,
      `Listasdelacompra-${sha}`,
    ]);
    versions.push({ name, sha, version });
  }
  writeFileSync(join(directory, "selection.json"), JSON.stringify(versions[0]));
  writeFileSync(
    join(directory, "mock.mjs"),
    `import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)), original=globalThis.fetch;
globalThis.fetch=async(input, options)=>{
 const url=String(input), selected=JSON.parse(readFileSync(join(root,'selection.json'),'utf8'));
 if(url==='https://api.github.com/repos/kadyto/Listasdelacompra/commits/main') return new Response(JSON.stringify({sha:selected.sha}));
 if(url==='https://api.github.com/repos/kadyto/Listasdelacompra/commits/'+selected.sha+'/check-runs?per_page=100') return new Response(JSON.stringify({check_runs:[{id:1,name:'app',status:'completed',conclusion:'success'},{id:2,name:'container',status:'completed',conclusion:'success'}]}));
 if(url==='https://codeload.github.com/kadyto/Listasdelacompra/tar.gz/'+selected.sha) return new Response(readFileSync(join(root,selected.name+'.tar.gz')));
 return original(input, options);
};\n`,
  );
  return versions;
}
