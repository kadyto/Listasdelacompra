import { test, expect } from "@playwright/test";

test("reutiliza catálogo, respeta cantidades y vacía comprados con confirmación", async ({
  page,
  request,
}, testInfo) => {
  const stores = await (await request.get("/api/stores")).json();
  const store = stores.find((s: { name: string }) => s.name === "DIA");
  const category = (await (await request.get("/api/categories")).json())[0];
  const name = `Leche entera ${testInfo.project.name}`;
  const created = await request.post("/api/products", {
    data: { name, category_id: category.id, package_amount: 1, unit: "l" },
  });
  expect(created.status()).toBe(201);
  const product = await created.json();
  expect(
    (
      await request.post("/api/prices", {
        data: { product_id: product.id, store_id: store.id, price: "0,99" },
      })
    ).status(),
  ).toBe(201);
  await page.goto(`/#/list/${store.id}`);
  await page
    .getByRole("button", { name: "Añadir productos", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Buscar productos para añadir" })
    .fill(name);
  await page.getByRole("spinbutton", { name: "Cantidad a comprar" }).fill("3");
  await page.locator(".picker-row").filter({ hasText: name }).click();
  await page
    .getByRole("button", { name: /Listo · 1 producto añadido/ })
    .click();
  const row = page
    .locator(".list-row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row.locator(".quantity-control>span")).toHaveText("3");
  await expect(page.locator(".list-total")).toContainText("2,97");
  await page
    .getByRole("checkbox", { name: `Marcar comprado ${name}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Vaciar comprados", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(row).toBeVisible();
  await page
    .getByRole("button", { name: "Vaciar comprados", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto(`/#/product/${product.id}`);
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".history-row")).toContainText("0,99");
});

test("compra móvil: crear, comparar, actualizar y conservar estados independientes", async ({
  page,
}, testInfo) => {
  const name = `Pepsi Zero ${testInfo.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tu compra, en orden." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nuevo producto", exact: true })
    .click();
  await page.getByLabel("Nombre del producto").fill(name);
  await page.getByLabel("Marca", { exact: false }).fill("Pepsi");
  await page.getByLabel("Cantidad del envase").fill("2");
  await page
    .getByRole("combobox", { name: "Unidad", exact: true })
    .selectOption("l");
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption({ label: "Bebidas" });
  await page.getByLabel("Carrefour", { exact: false }).check();
  await page.getByLabel("Costco", { exact: false }).check();
  await page
    .getByRole("button", { name: "Crear producto", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".store-card")
    .filter({
      has: page.getByRole("heading", { name: "Carrefour", exact: true }),
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Carrefour", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Actualizar precio de ${name}`, exact: true })
    .click();
  await page.getByRole("textbox", { name: "Precio en euros" }).fill("2,19");
  await page
    .getByRole("button", { name: "Guardar precio", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Registrar precio", exact: true })
    .first()
    .click();
  await page
    .getByRole("combobox", { name: "Supermercado", exact: true })
    .selectOption({ label: "Costco" });
  await page.getByRole("textbox", { name: "Precio en euros" }).fill("1,79");
  await page
    .getByRole("button", { name: "Guardar precio", exact: true })
    .click();
  await expect(page.locator(".comparison-card.best")).toContainText("Costco");
  await expect(page.locator(".comparison-card.best")).toContainText("1,79");
  await expect(
    page.locator(".comparison-card").filter({ hasText: "Carrefour" }),
  ).toContainText("0,40");
  await page
    .locator(".association-row")
    .filter({ hasText: "Carrefour" })
    .click();
  const article = page
    .locator(".list-row")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(article.locator(".cheaper-hint")).toContainText("0,40");
  await expect(article.locator(".cheaper-hint")).toContainText("Costco");
  await page
    .getByRole("button", { name: `Actualizar precio de ${name}`, exact: true })
    .click();
  await page.getByRole("textbox", { name: "Precio en euros" }).fill("1,89");
  await page
    .getByRole("button", { name: "Guardar precio", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: `Marcar comprado ${name}`, exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: `Desmarcar ${name}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(3);
  await expect(
    page.locator(".history-row").filter({ hasText: "2,19" }),
  ).toBeVisible();
  await page.locator(".association-row").filter({ hasText: "Costco" }).click();
  await expect(
    page.getByRole("checkbox", {
      name: `Marcar comprado ${name}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({
    path: `test-results/list-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("configuración, modo oscuro e instalación PWA sin cachear la API", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "Tu espacio, tus reglas." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cambiar a oscuro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Cambiar a claro" }).click();
  await page
    .getByRole("button", { name: "Editar Carrefour", exact: true })
    .click();
  await page.getByLabel("Comercio activo").uncheck();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.locator(".settings-row").filter({ hasText: "Carrefour" }),
  ).toContainText("Desactivado");
  await page
    .getByRole("button", { name: "Editar Carrefour", exact: true })
    .click();
  await page.getByLabel("Comercio activo").check();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.locator(".settings-row").filter({ hasText: "Carrefour" }),
  ).not.toContainText("Desactivado");
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).icons).toHaveLength(3);
  expect(
    (await request.get("/icons/icon-512.png")).headers()["content-type"],
  ).toContain("image/png");
  expect((await request.get("/api/health")).headers()["cache-control"]).toBe(
    "no-store",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cachesAPI = await page.evaluate(async () => {
    const names = await caches.keys();
    const keys = await Promise.all(
      names.map(async (name) =>
        (await (await caches.open(name)).keys()).map((r) => r.url),
      ),
    );
    return keys.flat().filter((url) => url.includes("/api/"));
  });
  expect(cachesAPI).toEqual([]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tu compra, en orden." }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
