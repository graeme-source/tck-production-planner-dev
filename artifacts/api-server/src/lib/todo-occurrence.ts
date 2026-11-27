/**
 * A repeating to-do ticked off makes the next one — unless that day's one is
 * already on the list (Graeme, 27 Nov 2026: three future Friday despatch
 * checks were ticked early and reopened; ticking them again on the day must
 * not make second copies of the weeks already there). Pure — tested.
 */
export function shouldCreateNextOccurrence(next: string, listedDates: readonly (string | null)[]): boolean {
  return !listedDates.some(d => d != null && String(d).slice(0, 10) === next);
}
