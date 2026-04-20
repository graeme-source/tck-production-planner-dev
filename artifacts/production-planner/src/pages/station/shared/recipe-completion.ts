import type { ProductionPlanItem } from "@workspace/api-client-react";

/**
 * Helpers for the builder-controlled recipe completion model.
 *
 * Rule of thumb: downstream stations (ovens, wrapping) derive their targets
 * and pack output from these helpers so the "builder marked complete early"
 * override flows through without each station re-implementing the logic.
 */

/** Two-packs produced per full batch. */
export function packsPerBatch(item: ProductionPlanItem): number {
  return Math.max(1, Math.floor((item.portionsPerBatch ?? 10) / 2));
}

/**
 * Effective batches target for a plan item.
 *
 * - If the builder has marked this recipe complete, the effective target is
 *   whatever the combined building count was at that moment (we read the
 *   current combined count; once marked complete the builder can't add more).
 * - Otherwise, the original plan target applies.
 */
export function effectiveBatchesTarget(
  item: ProductionPlanItem,
  combinedBuildingCount: number,
): number {
  if (item.builderMarkedCompleteAt) return combinedBuildingCount;
  return item.batchesTarget ?? 0;
}

/**
 * Pack target for a plan item at a station whose cap is `effectiveBatches`
 * batches. Batches contribute `packsPerBatch` packs each; any builder-added
 * extra packs ride along and are processed by the same station (same trays,
 * etc.) — they get credited once all batches at this station are complete.
 */
export function packsTargetForItem(
  item: ProductionPlanItem,
  effectiveBatches: number,
): number {
  return effectiveBatches * packsPerBatch(item) + (item.extraPacksBuilt ?? 0);
}

/**
 * Packs completed at a station, based on batch completions. Extras credit in
 * when the station has caught up to its effective batch target.
 */
export function packsDoneForItem(
  item: ProductionPlanItem,
  stationBatches: number,
  effectiveBatches: number,
): number {
  const base = stationBatches * packsPerBatch(item);
  const extrasCredit = effectiveBatches > 0 && stationBatches >= effectiveBatches
    ? (item.extraPacksBuilt ?? 0)
    : 0;
  return base + extrasCredit;
}

/**
 * Net two-packs available to send to wrapping for a plan item.
 *
 * - builderMarkedCompleteAt path ignores any legacy `shortCount` — the
 *   builder has authoritatively stated what was made.
 * - Pre-completion path keeps the legacy shortCount subtraction so in-flight
 *   plans with shortCount > 0 still display correctly until the builder
 *   finishes or marks complete.
 */
export function netTwoPacks(
  item: ProductionPlanItem,
  ovensBatchCount: number,
  effectiveBatches?: number,
): number {
  const grossPacks = Math.floor((ovensBatchCount * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item.eightPackBagCount ?? 0) * 4;
  const wonky = item.wonlyCount ?? 0;
  const extras = item.extraPacksBuilt ?? 0;
  const legacyShort = item.builderMarkedCompleteAt ? 0 : (item.shortCount ?? 0);
  // Extras cook in the same trays as the regular batches, so they only count
  // as "through ovens" once all batches on this station have completed.
  // If the caller didn't supply effectiveBatches, fall back to always crediting
  // (legacy behaviour) so unrelated callers aren't silently affected.
  const extrasCredit = effectiveBatches === undefined
    ? extras
    : (effectiveBatches > 0 && ovensBatchCount >= effectiveBatches ? extras : 0);
  return Math.max(0, grossPacks - eightPackDeduction - wonky - legacyShort) + extrasCredit;
}
