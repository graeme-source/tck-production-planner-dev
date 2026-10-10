/**
 * Cooking-time halves for the label (pure, tested).
 *
 * Customers set the FULL time and forgot to turn the calzones, so the tops
 * burnt (Graeme, 2026-10-11). Step 2 reads cook → TURN OVER → cook again:
 * a FIXED first half, and the range only on the second (Graeme, 2026-10-12):
 *
 *   first  = half the midpoint, rounded half up = round(((min + max) / 2) / 2)
 *   second = (min − first) – (max − first), never below 1 minute
 *
 * so first + second always adds up to the stated total range:
 *   oven 18–22      → 10, then 8–12
 *   air fryer 16–19 →  9, then 7–10
 *
 * If the first half would leave less than a minute for the second (a total
 * under 2 minutes), the first half is capped so the second is still 1.
 */
import type { CookingValues } from "./template";

export interface HalvedRange {
  /** Minutes before turning — one fixed number. */
  first: number;
  /** Minutes after turning — a range (min = max when it's one number). */
  second: [number, number];
}

export function halveRange(min: number | null, max: number | null): HalvedRange | null {
  if (min == null || max == null || min < 2 || max < min) return null;
  const midHalf = (min + max) / 4;
  const rounded = Math.floor(midHalf + 0.5); // half up
  const first = Math.max(1, Math.min(rounded, min - 1));
  return { first, second: [min - first, max - first] };
}

/** "8–12", or "10" when both ends are the same. */
export function formatRange(a: number, b: number): string {
  return a === b ? String(a) : `${a}–${b}`;
}

/** Every fill-in the cooking steps can use, from the resolved cooking values.
 *  A blank appliance gives blank fill-ins, so its [bracketed] line drops.
 *
 *  {ovenHalfMin}/{ovenHalfMax} are both the fixed first half (wording written
 *  "{ovenHalfMin}–{ovenHalfMax}" still prints one number — equal ranges are
 *  collapsed, see collapseEqualRanges); {ovenFirst}/{ovenSecond} are the
 *  ready-formatted halves. */
export function cookingPlaceholderValues(c: CookingValues): Record<string, number | string | null> {
  const oven = halveRange(c.ovenMinMinutes, c.ovenMaxMinutes);
  const air = halveRange(c.airFryerMinMinutes, c.airFryerMaxMinutes);
  return {
    ovenTemp: c.ovenTempC, fanTemp: c.fanTempC, ovenMin: c.ovenMinMinutes, ovenMax: c.ovenMaxMinutes,
    airTemp: c.airFryerTempC, airMin: c.airFryerMinMinutes, airMax: c.airFryerMaxMinutes,
    ovenHalfMin: oven?.first ?? null, ovenHalfMax: oven?.first ?? null,
    ovenHalf2Min: oven?.second[0] ?? null, ovenHalf2Max: oven?.second[1] ?? null,
    airHalfMin: air?.first ?? null, airHalfMax: air?.first ?? null,
    airHalf2Min: air?.second[0] ?? null, airHalf2Max: air?.second[1] ?? null,
    ovenFirst: oven ? String(oven.first) : null,
    ovenSecond: oven ? formatRange(oven.second[0], oven.second[1]) : null,
    airFirst: air ? String(air.first) : null,
    airSecond: air ? formatRange(air.second[0], air.second[1]) : null,
  };
}

/** "10–10 min" → "10 min": a range whose two ends are the same number reads
 *  as that number (applied to filled cooking-step wording). */
export function collapseEqualRanges(text: string): string {
  return text.replace(/(?<![\d.])(\d+)–(\d+)(?![\d.])/g, (m, a: string, b: string) => (a === b ? a : m));
}
