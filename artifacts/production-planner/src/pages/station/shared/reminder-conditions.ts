// ─────────────────────────────────────────────────────────────────────────────
// Timed-reminder conditions (pure — no React, no fetch).
//
// A timed reminder can be made conditional on the work it's chasing still
// being outstanding. Each condition belongs to the stations whose work it is:
//
//   • onlyIfStockChecksOutstanding — PREP only: today's ingredient stock
//     checks (Passata, Tomato Puree…). Never Packing/Wrapping.
//   • onlyIfFactoryCountOutstanding — PACKING/WRAPPING only: today's Factory
//     Number update (the completed count in Stock Control → Production fridge).
//
// A flag set on a station it doesn't belong to is ignored there, so a
// reminder shared across stations can never show another station's numbers
// (Graeme, 13 Oct 2026: Packing showed "2 outstanding" — two prep stock checks).
// ─────────────────────────────────────────────────────────────────────────────

/** Station keys that do the ingredient stock checks (Prep and its sub-stations). */
export const PREP_STATION_KEYS: readonly string[] = ["prep", "main_prep", "prep_bases", "prep_meat"];

/** Station keys whose job includes the daily Factory Number count. */
export const FACTORY_COUNT_STATION_KEYS: readonly string[] = ["wrapping", "packing"];

export const isPrepStation = (key: string) => PREP_STATION_KEYS.includes(key);
export const isFactoryCountStation = (key: string) => FACTORY_COUNT_STATION_KEYS.includes(key);

export interface ReminderConditionFlags {
  onlyIfStockChecksOutstanding?: boolean;
  onlyIfFactoryCountOutstanding?: boolean;
}

/** The stock-check condition only applies on a prep station. */
export function stockCheckConditionApplies(r: ReminderConditionFlags, stationType: string): boolean {
  return !!r.onlyIfStockChecksOutstanding && isPrepStation(stationType);
}

/** The factory-count condition only applies on Packing/Wrapping. */
export function factoryCountConditionApplies(r: ReminderConditionFlags, stationType: string): boolean {
  return !!r.onlyIfFactoryCountOutstanding && isFactoryCountStation(stationType);
}

/** Whether the editor should offer each condition, given the chosen stations. */
export function conditionsOffered(stations: readonly string[]): { stockChecks: boolean; factoryCount: boolean } {
  return {
    stockChecks: stations.some(isPrepStation),
    factoryCount: stations.some(isFactoryCountStation),
  };
}

export interface FactoryCountState {
  complete: boolean;
  /** Products still to count, or null when the count has no per-product entries. */
  outstanding: number | null;
}

export interface ReminderLiveCounts {
  /** Today's unrecorded prep stock checks; null = not loaded / not asked. */
  stockChecksOutstanding: number | null;
  /** Today's Factory Number count; null = not loaded / not asked. */
  factoryCount: FactoryCountState | null;
}

export interface ReminderDisplay {
  show: boolean;
  /** Text appended to the title after an em dash, or null for none. */
  suffix: string | null;
}

/**
 * Decide whether a reminder (already inside its time window on this station)
 * shows, and what number goes after its title. While a condition's data is
 * still loading the banner stays hidden rather than flashing up.
 */
export function resolveReminderDisplay(
  r: ReminderConditionFlags,
  stationType: string,
  counts: ReminderLiveCounts,
): ReminderDisplay {
  if (stockCheckConditionApplies(r, stationType)) {
    const n = counts.stockChecksOutstanding;
    if (n === null || n <= 0) return { show: false, suffix: null };
    return { show: true, suffix: `${n} outstanding` };
  }
  if (factoryCountConditionApplies(r, stationType)) {
    const fc = counts.factoryCount;
    if (fc === null || fc.complete) return { show: false, suffix: null };
    return { show: true, suffix: fc.outstanding !== null && fc.outstanding > 0 ? `${fc.outstanding} still to count` : null };
  }
  return { show: true, suffix: null };
}
