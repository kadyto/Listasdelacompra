import { rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const database = resolve("test-results/e2e.sqlite");
const backups = resolve("test-results/backups");
rmSync(backups, { recursive: true, force: true });
mkdirSync(resolve("test-results"), { recursive: true });
for (const suffix of ["", "-wal", "-shm"])
  rmSync(database + suffix, { force: true });
const child = spawn(process.execPath, ["dist/server/index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: "3100",
    HOST: "127.0.0.1",
    DATABASE_PATH: database,
    BACKUP_DIRECTORY: backups,
  },
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
