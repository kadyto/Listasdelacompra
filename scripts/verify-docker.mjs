import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "compra-docker-"));
mkdirSync(join(root, "data"));
mkdirSync(join(root, "backups"));
const envFile = join(root, "test.env"),
  override = join(root, "override.yaml");
writeFileSync(
  envFile,
  `DATA_DIR=${join(root, "data")}\nBACKUP_DIR=${join(root, "backups")}\nBIND_ADDRESS=127.0.0.1\nHTTP_PORT=0\nAPP_UID=${process.getuid?.() ?? 1000}\nAPP_GID=${process.getgid?.() ?? 1000}\nALLOWED_ORIGINS=\n`,
);
const project = `compra-test-${process.pid}`;
const ca = process.env.BUILD_CA_CERT;
writeFileSync(
  override,
  `services:\n  app:\n    image: listasdelacompra:${project}\n${ca ? "    build:\n      secrets:\n        - build_ca\nsecrets:\n  build_ca:\n    file: " + JSON.stringify(resolve(ca)) + "\n" : ""}`,
);
const args = [
  "compose",
  "-p",
  project,
  "--env-file",
  envFile,
  "-f",
  resolve("compose.yaml"),
  "-f",
  override,
];
const compose = (...command) =>
  execFileSync("docker", [...args, ...command], { stdio: "inherit" });
let baseURL;
function discoverPort() {
  const address = execFileSync("docker", [...args, "port", "app", "3000"], {
    encoding: "utf8",
  }).trim();
  baseURL = `http://${address}`;
}
async function api(path, method = "GET", body) {
  const response = await fetch(`${baseURL}/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${await response.clone().text()}`,
  );
  return response.json();
}
try {
  compose("up", "-d", "--build", "--wait", "--wait-timeout", "90");
  discoverPort();
  const stores = await api("/stores"),
    category = (await api("/categories"))[0];
  const carrefour = stores.find((s) => s.name === "Carrefour"),
    costco = stores.find((s) => s.name === "Costco");
  const product = await api("/products", "POST", {
    name: "Pepsi Zero",
    brand: "Pepsi",
    category_id: category.id,
    package_amount: 2,
    unit: "l",
    list_ids: [carrefour.list_id, costco.list_id],
  });
  await api("/prices", "POST", {
    product_id: product.id,
    store_id: carrefour.id,
    price: "2,19",
  });
  await api("/prices", "POST", {
    product_id: product.id,
    store_id: costco.id,
    price: "1,79",
  });
  compose(
    "exec",
    "-T",
    "app",
    "node",
    "dist/server/maintenance.js",
    "backup",
    "/backups/verified.sqlite",
  );
  compose("restart", "app");
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  discoverPort();
  assert.equal((await api(`/products/${product.id}`)).history.length, 2);
  compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "90");
  discoverPort();
  const restored = await api(`/products/${product.id}`);
  assert.equal(restored.history.length, 2);
  assert.equal(restored.lists.length, 2);
  assert.equal(restored.latest[0].cents, 179);
  await api("/prices", "POST", {
    product_id: product.id,
    store_id: carrefour.id,
    price: "1,49",
  });
  assert.equal((await api(`/products/${product.id}`)).history.length, 3);
  compose("stop", "app");
  compose(
    "run",
    "--rm",
    "--no-deps",
    "app",
    "node",
    "dist/server/maintenance.js",
    "restore",
    "/backups/verified.sqlite",
    "--confirm-stopped",
  );
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  discoverPort();
  assert.equal((await api(`/products/${product.id}`)).history.length, 2);
  const html = await fetch(`${baseURL}/`, {
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(html.ok);
  assert.match(await html.text(), /La Compra/);
  const webBackup = await api("/backups", "POST");
  const downloaded = await fetch(
    `${baseURL}/api/backups/${webBackup.filename}/download`,
  );
  assert.ok(downloaded.ok);
  assert.equal(
    Buffer.from(await downloaded.arrayBuffer())
      .subarray(0, 16)
      .toString(),
    "SQLite format 3\0",
  );
  await api("/prices", "POST", {
    product_id: product.id,
    store_id: carrefour.id,
    price: "0,99",
  });
  const restoredFromSettings = await api("/backups/restore", "POST", {
    filename: webBackup.filename,
    confirm: true,
  });
  assert.equal((await api(`/products/${product.id}`)).history.length, 2);
  assert.ok(
    (await api("/backups")).some(
      (file) =>
        file.filename === restoredFromSettings.previous && file.automatic,
    ),
  );
  compose("restart", "app");
  compose("up", "-d", "--wait", "--wait-timeout", "90");
  discoverPort();
  assert.equal((await api(`/products/${product.id}`)).history.length, 2);
  console.log(
    "Docker: build, healthcheck, API, reinicio, recreación, copias CLI y desde Ajustes, descarga y restauración verificados.",
  );
} finally {
  try {
    compose("down", "--remove-orphans");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
