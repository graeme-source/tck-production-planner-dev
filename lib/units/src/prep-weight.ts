/**
 * How the prep room reads an amount: ALWAYS a weight (Graeme, 2026-09-29 —
 * "we measure everything in grams in the prep room … no litres at all").
 *
 * Sub-recipe replenishment, Bases & Sauces, Raw Meat and Main Prep show
 * every amount to weigh through this. Litres/ml convert at 1 g/ml (the same
 * density toGrams uses everywhere), so American Mustard 0.0667 l reads
 * "67 g". Under 1 kg it's WHOLE grams ("83 g", not 83.350 g — Graeme,
 * 2026-09-29: "really easy to follow"), except under 10 g where one decimal
 * is kept (6.7 g pepper, 0.7 g turmeric — rounding those to the gram moves
 * the recipe). From 1 kg it's kilograms to 3 decimals, i.e. to the gram.
 * Count units (pieces, each) can't be weighed and stay counts.
 *
 * Deliberately NOT used for stock counts and orders, where "1 L bottle" is
 * how the thing is bought and counted.
 */
import { gramsOrNull } from "./index";

function trim(n: number, dp: number): string {
  return String(Number(n.toFixed(dp)));
}

export function formatPrepWeight(qty: number | string, unit: string | null | undefined): string {
  const n = typeof qty === "number" ? qty : Number(qty);
  const safe = Number.isFinite(n) ? n : 0;
  const g = gramsOrNull(safe, unit);
  if (g === null) {
    const u = (unit ?? "").toLowerCase();
    if (u === "pieces" || u === "pcs" || u === "each") {
      const r = Math.round(safe);
      return `${r} ${r === 1 ? "piece" : "pieces"}`;
    }
    return `${trim(safe, 2)} ${unit ?? ""}`.trim();
  }
  const whole = Math.round(g);
  if (Math.abs(whole) >= 1000) return `${(whole / 1000).toFixed(3)} kg`;
  return Math.abs(g) < 10 ? `${trim(g, 1)} g` : `${whole} g`;
}

/**
 * How many packs to open for an amount. The amount and the pack size must be
 * in the SAME unit — the ingredient's own (kg, l, g). The replenish checklist
 * used to convert the amount to grams first and divide by a pack size in kg,
 * so 3.714 kg of mayonnaise from a 10 kg tub read "372 packs" (2026-09-29).
 */
export function packsToOpen(qty: number, packWeight: number | null | undefined): number | null {
  const pw = Number(packWeight);
  if (!Number.isFinite(pw) || pw <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
  // Round first so 2.0000001 packs of float noise isn't "3 packs".
  return Math.ceil(Math.round((qty / pw) * 1000) / 1000);
}
