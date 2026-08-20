// Single source of truth for converting an ingredient/sub-recipe quantity to
// grams. Density is assumed 1 g/ml for liquid units — the same assumption the
// ingredient-deck endpoint has always made. Unknown units (e.g. "each",
// "pieces") pass through unchanged: the number is treated as already-grams,
// which matches how those rows were entered historically.
export function toGrams(qty: number, unit: string | null | undefined): number {
  const u = (unit ?? "g").toLowerCase().trim();
  if (u === "kg") return qty * 1000;
  if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return qty * 1000;
  if (u === "ml") return qty;
  return qty;
}
