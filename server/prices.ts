export function parseCents(value: string): number {
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match)
    throw new Error(
      "Introduce un precio válido, por ejemplo 1,99 (máximo dos decimales).",
    );
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function unitPrice(cents: number, amount: number, unit: string) {
  const factor = unit === "ml" || unit === "g" ? 0.001 : 1;
  return {
    cents: cents / (amount * factor),
    unit: unit === "ml" ? "l" : unit === "g" ? "kg" : unit,
  };
}

export function priceDifference(currentCents: number, otherCents: number) {
  return {
    cents: currentCents - otherCents,
    percent:
      currentCents === 0
        ? null
        : ((currentCents - otherCents) * 100) / currentCents,
  };
}
