export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "No se puede conectar. Comprueba tu conexión e inténtalo de nuevo.",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.details?.length
        ? `${data.message} ${data.details.map((d: { field: string; message: string }) => `${d.field}: ${d.message}`).join(" · ")}`
        : (data.message ?? "No se pudo completar la operación."),
    );
  return data as T;
}
export const money = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export const number = (value: number) =>
  new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value);
export const date = (value: string) =>
  new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
export const oldPrice = (value: string) =>
  Date.now() - new Date(value).getTime() > 30 * 86400000;
export const pack = (p: {
  package_amount: number;
  unit: string;
  brand?: string;
}) => `${p.brand ? `${p.brand} · ` : ""}${number(p.package_amount)} ${p.unit}`;
export function localDateTime(value = new Date().toISOString()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
  return parts.replace(" ", "T");
}
// Convert Madrid wall time independently of the device's timezone (including DST).
export function madridToISO(value: string) {
  const target = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(target)) throw new Error("La fecha no es válida.");
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const rendered = new Date(
      `${localDateTime(new Date(candidate).toISOString())}:00Z`,
    ).getTime();
    candidate += target - rendered;
  }
  if (localDateTime(new Date(candidate).toISOString()) !== value)
    throw new Error(
      "Esta hora no existe por el cambio horario. Elige otra hora.",
    );
  return new Date(candidate).toISOString();
}
export function storeStyle(name: string) {
  const key = name.toLowerCase();
  if (key.includes("carrefour"))
    return { color: "#205bbb", bg: "#eaf1fd", mark: "C", label: "Carrefour" };
  if (key.includes("costco"))
    return { color: "#cf3545", bg: "#fceced", mark: "Co", label: "Costco" };
  if (key === "dia")
    return { color: "#db343b", bg: "#fff0ef", mark: "DIA", label: "DIA" };
  if (key.includes("mercadona"))
    return { color: "#2a794c", bg: "#eaf4e9", mark: "M", label: "Mercadona" };
  return {
    color: "#795aa5",
    bg: "#f0ebf7",
    mark: name.slice(0, 2).toUpperCase(),
    label: name,
  };
}
