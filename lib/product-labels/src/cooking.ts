/**
 * Cooking-time halves for the label (pure, tested).
 *
 * Customers set the FULL time and forgot to turn the calzones (the turn was
 * only in step 3, which read like "serve"), so the tops burnt (Graeme,
 * 2026-10-11). Step 2 now reads cook → TURN OVER → cook again, with the time
 * split in two:
 *
 *   first half  = floor(min / 2) – floor(max / 2)
 *   second half = (min − first min) – (max − first max)
 *
 * so the two halves always add up to the stated totals:
 *   oven 18–22      → 9–11 then 9–11
 *   air fryer 16–19 → 8–9  then 8–10
 */
import type { CookingValues } from "./template";

export interface HalvedRange {
  first: [number, number];
  second: [number, number];
}

export function halveRange(min: number | null, max: number | null): HalvedRange | null {
  if (min == null || max == null) return null;
  const a = Math.floor(min / 2);
  const b = Math.floor(max / 2);
  return { first: [a, b], second: [min - a, max - b] };
}

/** Every fill-in the cooking steps can use, from the resolved cooking values.
 *  A blank appliance gives blank fill-ins, so its [bracketed] line drops. */
export function cookingPlaceholderValues(c: CookingValues): Record<string, number | null> {
  const oven = halveRange(c.ovenMinMinutes, c.ovenMaxMinutes);
  const air = halveRange(c.airFryerMinMinutes, c.airFryerMaxMinutes);
  return {
    ovenTemp: c.ovenTempC, fanTemp: c.fanTempC, ovenMin: c.ovenMinMinutes, ovenMax: c.ovenMaxMinutes,
    airTemp: c.airFryerTempC, airMin: c.airFryerMinMinutes, airMax: c.airFryerMaxMinutes,
    ovenHalfMin: oven?.first[0] ?? null, ovenHalfMax: oven?.first[1] ?? null,
    ovenHalf2Min: oven?.second[0] ?? null, ovenHalf2Max: oven?.second[1] ?? null,
    airHalfMin: air?.first[0] ?? null, airHalfMax: air?.first[1] ?? null,
    airHalf2Min: air?.second[0] ?? null, airHalf2Max: air?.second[1] ?? null,
  };
}
