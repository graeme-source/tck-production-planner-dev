/**
 * How quantities read on a pull sheet.
 *
 * Recipes store grams and millilitres because that is how they are written,
 * but nobody walks into a chill store looking for 74771 g of chicken. Over a
 * thousand, it reads in the bigger unit; under it, it stays as written.
 */
export function formatQuantity(qty: number, unit: string): string {
  const n = Number.isFinite(qty) ? qty : 0;
  const u = (unit ?? "").trim().toLowerCase();

  if (u === "g" && Math.abs(n) >= 1000) return `${trim(n / 1000)} kg`;
  if (u === "ml" && Math.abs(n) >= 1000) return `${trim(n / 1000)} L`;
  return `${trim(n)}${u ? ` ${unit}` : ""}`;
}

/** Two decimals at most, and no trailing zeros — "3 kg", not "3.00 kg". */
function trim(n: number): string {
  return String(Math.round(n * 100) / 100);
}
