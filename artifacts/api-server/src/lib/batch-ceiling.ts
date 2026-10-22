/**
 * The day's calzone batch ceiling — ONE rule for Create Plan's
 * schedule-capacity and Case Orders' schedule suggestion, so the two can't
 * drift (#305, Jane Miles; approved by Graeme 2026-10-22).
 *
 *  - Dough Prep on the rota (full team): the ceiling IS the DPT "Total Daily
 *    Batches" figure (app_settings.total_daily_batches), which Jane sets
 *    herself on the DPT settings. It used to be a hidden 110.
 *  - No Dough Prep: the existing 80 setting
 *    (capacity_batches_without_dough_prep), or the DPT figure if that is
 *    lower — a short team can never have a higher ceiling than a full one.
 *  - DPT not set (0 / blank): falls back to the old full-team setting
 *    (capacity_batches_with_dough_prep, default 110) so nothing collapses
 *    to zero.
 */
export interface BatchCeilingSettings {
  /** app_settings.total_daily_batches — 0 when not set. */
  dptDailyBatches: number;
  /** capacity_batches_without_dough_prep — default 80. */
  withoutDoughPrep: number;
  /** capacity_batches_with_dough_prep — only used when DPT isn't set. */
  legacyWithDoughPrep: number;
}

export interface BatchCeilings {
  withDoughPrep: number;
  withoutDoughPrep: number;
}

const positive = (n: number): number | null => (Number.isFinite(n) && n > 0 ? Math.round(n) : null);

export function batchCeilings(s: BatchCeilingSettings): BatchCeilings {
  const dpt = positive(s.dptDailyBatches);
  const withDoughPrep = dpt ?? positive(s.legacyWithDoughPrep) ?? 110;
  const without = positive(s.withoutDoughPrep) ?? 80;
  return { withDoughPrep, withoutDoughPrep: Math.min(without, withDoughPrep) };
}

/** The ceiling for one day. */
export function batchCeilingFor(hasDoughPrep: boolean, s: BatchCeilingSettings): number {
  const c = batchCeilings(s);
  return hasDoughPrep ? c.withDoughPrep : c.withoutDoughPrep;
}
