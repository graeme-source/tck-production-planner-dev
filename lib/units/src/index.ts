/**
 * THE unit-conversion module — the single source of truth for turning an
 * ingredient/sub-recipe quantity into grams or kilograms, shared by the API
 * server and the browser.
 *
 * It exists because every screen used to hand-roll `unit === "kg" ? ×1000 :
 * as-is`, and each copy disagreed about litres: the sub-recipe form skipped
 * "l" rows entirely (a 10 L mayonnaise batch derived a 0.65 kg yield from
 * its seasonings alone), the recipe form counted 10 L as 10 g, and the
 * server counted it as 10 kg — three answers for one row (Graeme,
 * 2026-09-04). New code must import from here rather than switching on the
 * unit string itself.
 *
 * Semantics:
 *  - Weight: g, kg (and mg for pack labels).
 *  - Volume: ml, l + spelling variants — converted at density 1 g/ml, the
 *    assumption the ingredient-deck endpoint has always made. Good enough
 *    for kitchen maths on sauces and liquids.
 *  - Count units ("each", "pieces", "box", "roll"): NOT weights. toGrams
 *    passes the number through unchanged (legacy deck-ordering behaviour —
 *    those rows were historically entered as if grams); gramsOrNull returns
 *    null so weight totals can SKIP them and say so, rather than silently
 *    absorbing "23 each" as 23 g or 23 kg.
 */

/** True for units this module can genuinely turn into grams. */
export function isWeighable(unit: string | null | undefined): boolean {
  return GRAMS_PER_UNIT[normalise(unit)] !== undefined;
}

const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  mg: 0.001,
  // Volume at density 1 g/ml.
  ml: 1,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
};

function normalise(unit: string | null | undefined): string {
  return (unit ?? "g").toLowerCase().trim();
}

/** Quantity → grams. Unknown units (counts) pass through unchanged — the
 *  historical behaviour label/deck ordering depends on. Use gramsOrNull when
 *  a total must not swallow count units. */
export function toGrams(qty: number, unit: string | null | undefined): number {
  const factor = GRAMS_PER_UNIT[normalise(unit)];
  return factor !== undefined ? qty * factor : qty;
}

/** Quantity → grams, or null for a unit that isn't a weight or volume —
 *  so a weight total can skip "3 each" instead of miscounting it. */
export function gramsOrNull(qty: number, unit: string | null | undefined): number | null {
  const factor = GRAMS_PER_UNIT[normalise(unit)];
  return factor !== undefined ? qty * factor : null;
}

/** Quantity → kilograms, or null for count units. */
export function kgOrNull(qty: number, unit: string | null | undefined): number | null {
  const g = gramsOrNull(qty, unit);
  return g === null ? null : g / 1000;
}

// Recipe quantities are on a COOKED basis; processingRatio is the cooked
// yield per unit of raw input (e.g. 0.7 = 1 kg raw cooks down to 700 g).
// Raw demand is therefore cooked ÷ ratio — the convention orders.ts and
// outstanding-prep.ts have always used. Guard against 0/undefined ratios.
export function cookedToRaw(cookedQty: number, processingRatio: number | null | undefined): number {
  const ratio = Number(processingRatio);
  if (!Number.isFinite(ratio) || ratio <= 0) return cookedQty;
  return cookedQty / ratio;
}
