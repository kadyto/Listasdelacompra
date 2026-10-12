import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const releaseSchema = z.object({
  source: z.string().regex(/^[a-f0-9]{64}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});
export const activeSchema = releaseSchema.extend({
  base_source: releaseSchema.shape.source,
});
export const pendingSchema = z.object({
  job_id: z.uuid(),
  release: releaseSchema,
  previous: activeSchema.nullable(),
  base_source: releaseSchema.shape.source,
  backup_filename: z
    .string()
    .regex(/^antes-de-actualizar-[a-zA-Z0-9._-]+\.sqlite$/),
});
export const jobSchema = z.object({
  id: z.uuid(),
  phase: z.enum([
    "downloading",
    "installing",
    "building",
    "testing",
    "backing-up",
    "restarting",
    "completed",
    "failed",
  ]),
  message: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
  target_version: z.string().optional(),
  target_source: releaseSchema.shape.source.optional(),
  backup_filename: z.string().optional(),
});
export type Release = z.infer<typeof releaseSchema>;
export type ActiveRelease = z.infer<typeof activeSchema>;
export type PendingUpdate = z.infer<typeof pendingSchema>;
export type UpdateJob = z.infer<typeof jobSchema>;

export function runtimePaths(database: string) {
  const directory = join(dirname(resolve(database)), ".app-runtime");
  return {
    directory,
    releases: join(directory, "releases"),
    staging: join(directory, "staging"),
    cache: join(directory, "npm-cache"),
    active: join(directory, "active.json"),
    pending: join(directory, "pending.json"),
    status: join(directory, "status.json"),
  };
}
export function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory())
    throw new Error("La carpeta de actualización no es válida.");
}
export function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile())
    throw new Error("El archivo de actualización no es válido.");
  return JSON.parse(readFileSync(path, "utf8"));
}
export function writeJson(path: string, value: unknown) {
  ensureDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export function compareVersions(a: string, b: string) {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
