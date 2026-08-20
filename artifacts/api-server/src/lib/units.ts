// Single source of truth for converting an ingredient/sub-recipe quantity to
// grams. Density is assumed 1 g/ml for liquid units — the same assumption the
// ingredient-deck endpoint has always made. Unknown units (e.g. "each",
// "pieces") pass through unchanged: the number is treated as already-grams,
// which matches how those rows were entered historically.
// Recipe quantities are on a COOKED basis; processingRatio is the cooked yield
// per unit of raw input (e.g. 0.7 = 1 kg raw cooks down to 700 g). Raw demand
// is therefore cooked ÷ ratio — the convention orders.ts and
// outstanding-prep.ts have always used. Guard against 0/undefined ratios.
export function cookedToRaw(cookedQty: number, processingRatio: number | null | undefined): number {
  const ratio = Number(processingRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return cookedQty;
  return cookedQty / ratio;
}

export function toGrams(qty: number, unit: string | null | undefined): number {
  const u = (unit ?? "g").toLowerCase().trim();
  if (u === "kg") return qty * 1000;
  if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return qty * 1000;
  if (u === "ml") return qty;
  return qty;
}
