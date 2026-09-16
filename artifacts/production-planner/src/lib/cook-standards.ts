/**
 * UK FSA time/temperature equivalents for safe cooking.
 *
 * 70°C for 2 minutes achieves the same pathogen kill as 75°C for 30
 * seconds — the standard table used across the UK food industry (and the
 * one on the factory wall). The mac cheese station records against this
 * table instead of chasing a fixed 75°C, because a cheese sauce takes a
 * long time to climb the last few degrees (Graeme, 2026-09-16; also the
 * standing rule that a safe cook temp is never a hard-coded 75 —
 * 2026-08-19).
 *
 * Table (temperature held for at least the paired time):
 *   60°C — 45 minutes
 *   65°C — 10 minutes
 *   70°C — 2 minutes
 *   75°C — 30 seconds
 *   80°C — 6 seconds
 */

export const FSA_COOK_BANDS: ReadonlyArray<{ tempC: number; holdSeconds: number }> = [
  { tempC: 80, holdSeconds: 6 },
  { tempC: 75, holdSeconds: 30 },
  { tempC: 70, holdSeconds: 120 },
  { tempC: 65, holdSeconds: 600 },
  { tempC: 60, holdSeconds: 2700 },
];

/** The default hold time for a measured temperature: the requirement of the
 *  highest band the temperature reaches. Below 60°C there is no safe hold
 *  time — returns null. */
export function defaultHoldSeconds(tempC: number): number | null {
  for (const band of FSA_COOK_BANDS) {
    if (tempC >= band.tempC) return band.holdSeconds;
  }
  return null;
}

/** Does a recorded temperature + hold meet the FSA table? */
export function meetsCookStandard(tempC: number, heldForSeconds: number): boolean {
  const required = defaultHoldSeconds(tempC);
  return required != null && heldForSeconds >= required;
}

/** "2 min" / "30 sec" — how the table reads on the wall. */
export function formatHold(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const mins = seconds / 60;
  return Number.isInteger(mins) ? `${mins} min` : `${Math.round(mins * 10) / 10} min`;
}
