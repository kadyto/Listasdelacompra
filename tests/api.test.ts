import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app";
import type { HTTPMethods } from "fastify";

let app: Awaited<ReturnType<typeof createApp>>,
  directory: string,
  dbPath: string;
const request = async (method: HTTPMethods, url: string, payload?: unknown) => {
  const response = await app.inject({
    method,
    url: `/api${url}`,
    payload: payload as object | undefined,
  });
  return { status: response.statusCode, data: response.json() };
};
let categoryId: number;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "compra-test-"));
  dbPath = join(directory, "db.sqlite");
  app = await createApp({ dbPath, seed: false, serveClient: false });
  categoryId = (await request("POST", "/categories", { name: "Bebidas" })).data
    .id;
});
afterEach(async () => {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
});
const store = async (name: string) => {
  const created = await request("POST", "/stores", { name });
  expect(created.status).toBe(201);
  return (await request("GET", "/stores")).data.find(
    (s: { id: number }) => s.id === created.data.id,
  );
};
const product = async (list_ids: number[] = [], overrides: object = {}) => {
  const r = await request("POST", "/products", {
    name: "Pepsi Zero",
    brand: "Pepsi",
    category_id: categoryId,
    package_amount: 2,
    unit: "l",
    list_ids,
    ...overrides,
  });
  expect(r.status).toBe(201);
  return r.data;
};
const price = async (
  product_id: number,
  store_id: number,
  value: string,
  recorded_at = "2026-10-01T12:00:00.000Z",
) => {
  const r = await request("POST", "/prices", {
    product_id,
    store_id,
    price: value,
    recorded_at,
  });
  expect(r.status).toBe(201);
  return r.data;
};

describe("Flujo real de compra compartido", () => {
  it("cumple los escenarios 1–9, incluido reinicio con persistencia", async () => {
    const carrefour = await store("Carrefour"),
      costco = await store("Costco");
    const p = await product([carrefour.list_id, costco.list_id]);
    await price(p.id, carrefour.id, "2,19");
    await price(p.id, costco.id, "1,79");
    let list = (await request("GET", `/stores/${carrefour.id}/list`)).data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0].prices.map((r: { cents: number }) => r.cents)).toEqual(
      [179, 219],
    );
    expect(list.items[0].prices[0].store_name).toBe("Costco");
    await price(p.id, carrefour.id, "1,89", "2026-10-02T12:00:00.000Z");
    let detail = (await request("GET", `/products/${p.id}`)).data;
    expect(detail.history).toHaveLength(3);
    expect(detail.history.some((r: { cents: number }) => r.cents === 219)).toBe(
      true,
    );
    expect(
      detail.latest.find(
        (r: { store_id: number }) => r.store_id === carrefour.id,
      ).cents,
    ).toBe(189);
    expect(
      detail.latest.find(
        (r: { store_id: number }) => r.store_id === carrefour.id,
      ).difference.cents,
    ).toBe(10);
    await request("PUT", `/items/${list.items[0].id}`, { purchased: true });
    expect(
      (await request("GET", `/stores/${costco.id}/list`)).data.items[0]
        .purchased,
    ).toBe(0);
    expect(
      (await request("GET", `/stores/${carrefour.id}/list`)).data.items[0]
        .purchased,
    ).toBe(1);
    await request("DELETE", `/items/${list.items[0].id}`);
    expect(
      (await request("GET", `/products/${p.id}`)).data.history,
    ).toHaveLength(3);
    await app.close();
    app = await createApp({ dbPath, seed: false, serveClient: false });
    detail = (await request("GET", `/products/${p.id}`)).data;
    expect(detail.history).toHaveLength(3);
    expect(detail.lists).toHaveLength(1);
    expect(detail.lists[0].store_name).toBe("Costco");
    expect(detail.lists[0].purchased).toBe(0);
    expect((await request("GET", "/health")).data.status).toBe("ok");
  });
  it("elige el último por fecha observada, no por orden de inserción", async () => {
    const s = await store("DIA"),
      p = await product();
    await price(p.id, s.id, "2", "2026-10-02T12:00:00Z");
    await price(p.id, s.id, "1", "2026-01-01T12:00:00Z");
    expect(
      (await request("GET", `/products/${p.id}`)).data.latest[0].cents,
    ).toBe(200);
  });
  it("consulta precios de un comercio incluso sin productos en su lista", async () => {
    const a = await store("Carrefour"),
      b = await store("Costco"),
      p = await product();
    await price(p.id, a.id, "2");
    await price(p.id, b.id, "1");
    const result = await request("GET", `/prices?store_id=${a.id}`);
    expect(result.status).toBe(200);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].store_name).toBe("Carrefour");
    expect(result.data[0].product_name).toBe("Pepsi Zero");
    expect(
      (await request("GET", `/stores/${a.id}/list`)).data.items,
    ).toHaveLength(0);
  });
  it("distingue cero y precio desconocido al estimar cantidades", async () => {
    const s = await store("DIA"),
      p = await product([s.list_id]),
      p2 = await product([s.list_id], { name: "Agua" });
    await price(p.id, s.id, "0");
    let stats = (await request("GET", "/stores")).data[0];
    expect(stats.pending_count).toBe(2);
    expect(stats.priced_count).toBe(1);
    expect(stats.estimated_cents).toBe(0);
    const items = (await request("GET", `/stores/${s.id}/list`)).data.items;
    await price(p2.id, s.id, "0,10");
    await request(
      "PUT",
      `/items/${items.find((i: { product_id: number }) => i.product_id === p2.id).id}`,
      { quantity: 3 },
    );
    expect((await request("GET", "/stores")).data[0].estimated_cents).toBe(30);
  });
  it("vacía comprados solo con confirmación y sin tocar precios", async () => {
    const s = await store("Carrefour"),
      p = await product([s.list_id]);
    await price(p.id, s.id, "2");
    const item = (await request("GET", `/stores/${s.id}/list`)).data.items[0];
    await request("PUT", `/items/${item.id}`, { purchased: true });
    expect(
      (await request("DELETE", `/lists/${s.list_id}/purchased`, {})).status,
    ).toBe(400);
    expect(
      (
        await request("DELETE", `/lists/${s.list_id}/purchased`, {
          confirm: true,
        })
      ).data.removed,
    ).toBe(1);
    expect(
      (await request("GET", `/products/${p.id}`)).data.history,
    ).toHaveLength(1);
  });
  it("corrige y elimina solo el precio erróneo; respeta la oferta", async () => {
    const s = await store("Carrefour"),
      p = await product();
    const old = await price(p.id, s.id, "2");
    await price(p.id, s.id, "3", "2026-10-03T12:00:00Z");
    expect(
      (
        await request("PUT", `/prices/${old.id}`, {
          product_id: p.id,
          store_id: s.id,
          price: "1,49",
          recorded_at: old.recorded_at,
          on_sale: true,
        })
      ).data.on_sale,
    ).toBe(1);
    await request("DELETE", `/prices/${old.id}`);
    expect(
      (await request("GET", `/products/${p.id}`)).data.history,
    ).toHaveLength(1);
  });
  it("conserva el orden manual y rechaza un orden incompleto", async () => {
    const s = await store("Costco");
    await product([s.list_id]);
    await product([s.list_id], { name: "Leche" });
    const ids = (await request("GET", `/stores/${s.id}/list`)).data.items
      .map((i: { id: number }) => i.id)
      .reverse();
    expect(
      (await request("PUT", `/lists/${s.list_id}/order`, { item_ids: ids }))
        .status,
    ).toBe(200);
    expect(
      (await request("GET", `/stores/${s.id}/list`)).data.items.map(
        (i: { id: number }) => i.id,
      ),
    ).toEqual(ids);
    expect(
      (
        await request("PUT", `/lists/${s.list_id}/order`, {
          item_ids: [ids[0]],
        })
      ).status,
    ).toBe(409);
  });
});
describe("Validación, integridad y seguridad", () => {
  it("evita duplicados, incluyendo litros/mililitros y EAN", async () => {
    await product();
    const body = {
      name: " pepsi  zero ",
      brand: "pépsi",
      category_id: categoryId,
      package_amount: 2000,
      unit: "ml",
    };
    expect((await request("POST", "/products", body)).status).toBe(409);
    await product([], { name: "Formato pequeño", ean: "1234567890123" });
    expect(
      (
        await request("POST", "/products", {
          ...body,
          name: "Otro",
          ean: "1234567890123",
        })
      ).status,
    ).toBe(409);
  });
  it("no mezcla formatos ni permite cambiarlos cuando tienen precios", async () => {
    const s = await store("Carrefour"),
      p = await product();
    await price(p.id, s.id, "2");
    const small = await product([], { package_amount: 330, unit: "ml" });
    expect(
      (await request("GET", `/products/${small.id}`)).data.latest,
    ).toHaveLength(0);
    expect(
      (
        await request("PUT", `/products/${p.id}`, {
          name: p.name,
          brand: p.brand,
          category_id: categoryId,
          package_amount: 1,
          unit: "l",
        })
      ).status,
    ).toBe(409);
  });
  it("revierte creación completa si una lista no existe", async () => {
    expect(
      (
        await request("POST", "/products", {
          name: "Prueba",
          category_id: categoryId,
          package_amount: 1,
          unit: "ud",
          list_ids: [9999],
        })
      ).status,
    ).toBe(400);
    expect((await request("GET", "/products")).data).toHaveLength(0);
  });
  it("desactiva y reactiva comercios sin perder datos ni incluirlos en el menor", async () => {
    const a = await store("Carrefour"),
      b = await store("Costco"),
      p = await product([a.list_id, b.list_id]);
    await price(p.id, a.id, "2");
    await price(p.id, b.id, "1");
    await request("PUT", `/stores/${b.id}`, { name: b.name, active: false });
    expect(
      (await request("POST", `/lists/${b.list_id}/items`, { product_id: p.id }))
        .status,
    ).toBe(400);
    const detail = (await request("GET", `/products/${p.id}`)).data;
    expect(
      detail.latest.find((r: { store_id: number }) => r.store_id === a.id)
        .difference.cents,
    ).toBe(0);
    expect(detail.history).toHaveLength(2);
    await request("PUT", `/stores/${b.id}`, { name: b.name, active: true });
    expect(
      (await request("GET", `/stores/${b.id}/list`)).data.items,
    ).toHaveLength(1);
  });
  it("añadir dos veces no duplica ni reinicia el estado comprado", async () => {
    const s = await store("Costco"),
      p = await product([s.list_id]);
    const item = (await request("GET", `/stores/${s.id}/list`)).data.items[0];
    await request("PUT", `/items/${item.id}`, {
      purchased: true,
      quantity: 4,
      notes: "Para casa",
    });
    const again = await request("POST", `/lists/${s.list_id}/items`, {
      product_id: p.id,
      quantity: 1,
    });
    expect(again.data.purchased).toBe(1);
    expect(again.data.quantity).toBe(4);
  });
  it("protege categorías utilizadas y valida cantidades, importes y fechas", async () => {
    const p = await product(),
      s = await store("DIA");
    expect((await request("DELETE", `/categories/${categoryId}`)).status).toBe(
      409,
    );
    expect(
      (
        await request("POST", "/prices", {
          product_id: p.id,
          store_id: s.id,
          price: "1,999",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("POST", "/prices", {
          product_id: p.id,
          store_id: s.id,
          price: "1",
          recorded_at: "ayer",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("POST", `/lists/${s.list_id}/items`, {
          product_id: p.id,
          quantity: 0,
        })
      ).status,
    ).toBe(400);
  });
  it("bloquea mutaciones desde otro origen y no cachea la API", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/stores",
      headers: { origin: "https://malicioso.example", host: "localhost:3000" },
      payload: { name: "Malicioso" },
    });
    expect(response.statusCode).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/health" })).headers[
        "cache-control"
      ],
    ).toBe("no-store");
  });
  it("busca nombres sin depender de mayúsculas o tildes", async () => {
    await product([], { name: "Limón", brand: "Casa" });
    expect((await request("GET", "/products?search=LIMON")).data).toHaveLength(
      1,
    );
  });
});
