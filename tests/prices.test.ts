import { describe, expect, it } from "vitest";
import { parseCents, priceDifference, unitPrice } from "../server/prices";
import { productIdentity } from "../server/db";
import { localDateTime, madridToISO } from "../src/lib";

describe("Importes exactos y formatos", () => {
  it.each([
    ["2,19", 219],
    ["1.79", 179],
    ["0", 0],
    ["0,01", 1],
    ["01,9", 190],
    ["999999.99", 99999999],
  ])("convierte %s a %i céntimos", (input, output) =>
    expect(parseCents(input)).toBe(output),
  );
  it.each(["-1", "1,999", "1e2", "NaN", "1.000,50", "", "1000000", "Infinity"])(
    "rechaza %s",
    (input) => expect(() => parseCents(input)).toThrow(),
  );
  it("suma y resta céntimos sin errores de coma flotante", () => {
    expect(parseCents("0,10") + parseCents("0,20")).toBe(30);
    expect(priceDifference(219, 179).cents).toBe(40);
  });
  it("evita dividir por cero", () =>
    expect(priceDifference(0, 0).percent).toBeNull());
  it("convierte mililitros y gramos para precio por litro/kg", () => {
    expect(unitPrice(150, 500, "ml")).toEqual({ cents: 300, unit: "l" });
    expect(unitPrice(300, 250, "g")).toEqual({ cents: 1200, unit: "kg" });
    expect(unitPrice(200, 4, "ud")).toEqual({ cents: 50, unit: "ud" });
  });
  it("detecta formatos equivalentes sin mezclar tamaños distintos", () => {
    expect(productIdentity("Pépsi Zero", "Pepsi", 2, "l")).toBe(
      productIdentity(" pepsi  zero ", "pepsi", 2000, "ml"),
    );
    expect(productIdentity("Pepsi", "", 2, "l")).not.toBe(
      productIdentity("Pepsi", "", 330, "ml"),
    );
  });
});
describe("Fecha española independiente del dispositivo", () => {
  it("convierte la hora de Madrid en verano e invierno", () => {
    expect(madridToISO("2026-07-01T12:30")).toBe("2026-07-01T10:30:00.000Z");
    expect(madridToISO("2026-01-01T12:30")).toBe("2026-01-01T11:30:00.000Z");
    expect(localDateTime("2026-07-01T10:30:00.000Z")).toBe("2026-07-01T12:30");
  });
  it("rechaza una hora inexistente del cambio horario", () =>
    expect(() => madridToISO("2026-03-29T02:30")).toThrow());
});
