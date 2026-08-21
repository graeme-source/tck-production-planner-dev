import type { ProductionPlanItem } from "@workspace/api-client-react";
import type { StationPlanItem } from "./constants";

/**
 * Helpers for the builder-controlled recipe completion model.
 *
 * Rule of thumb: downstream stations (ovens, wrapping) derive their targets
 * and pack output from these helpers so the "builder marked complete early"
 * override flows through without each station re-implementing the logic.
 */

/**
 * Packs produced per full batch, in the recipe's OWN pack size.
 *
 * This divided by a hardcoded 2 until 2026-08-21. That is the calzone
 * convention — a calzone pack is two portions — and it silently tripled the
 * count for anything that packs differently. Cinnamon Buns pack in SIXES, so
 * a 24-batch day read as 576 packs when the kitchen was making 192, and every
 * station target derived from this was wrong by the same factor.
 *
 * `packSize` arrives as a numeric string ("2.0000") from the plan API and is
 * absent from the generated type (see project_api_spec_drift), hence the
 * cast. Falls back to 2 only when it's missing or zero, so calzones are
 * untouched.
 */
export function packsPerBatch(item: ProductionPlanItem): number {
  const packSize = Number((item as { packSize?: number | string }).packSize) || 2;
  const portions = Number(item.portionsPerBatch) || 10;
  return Math.max(1, Math.floor(portions / packSize));
}

/**
 * What downstream stations (ovens, wrapping) should actually process for a
 * plan item: the REAL combined building output, never the planned target.
 *
 * The planned `batchesTarget` is reference-only — it tells everyone what to
 * expect, but it never dictates station behaviour. Ovens cook (and wrapping
 * wraps) exactly what the builders have made, whether that's short of, equal
 * to, or over the planned target, and it grows live if builders come back and
 * add more. The building station shows `batchesTarget` separately as the
 * reference goal; it does NOT use this helper for its own progress.
 */
export function effectiveBatchesTarget(
  item: ProductionPlanItem,
  combinedBuildingCount: number,
): number {
  // Once the builder marks the recipe complete, what was built IS the day's
  // output — full stop. A short build (13 of 14 planned, topped up with
  // loose packs) must not leave downstream stations chasing an unreachable
  // planned floor: ovens/wrapping targets become the 13 that exist, and the
  // extras credit gate can actually open.
  if (item.builderMarkedCompleteAt) return combinedBuildingCount;
  // Mid-build: show at least the planned target so downstream stations
  // (ovens, wrapping) display the expected batches up front — not 0/0 until
  // building has completed them — while still growing past the plan if
  // builders over-build.
  return Math.max(item.batchesTarget ?? 0, combinedBuildingCount);
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
 * when the station has caught up to what building ACTUALLY produced
 * (`builtBatches`), not the planned/display target — a short build (13 built
 * of 14 planned + loose packs) must still release its extras once the
 * station has processed all 13. Falls back to `effectiveBatches` for callers
 * that don't pass the built count.
 */
export function packsDoneForItem(
  item: ProductionPlanItem,
  stationBatches: number,
  effectiveBatches: number,
  builtBatches?: number,
): number {
  const base = stationBatches * packsPerBatch(item);
  const gate = builtBatches ?? effectiveBatches;
  const extrasCredit = stationBatches >= gate ? (item.extraPacksBuilt ?? 0) : 0;
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
  item: StationPlanItem,
  ovensBatchCount: number,
  effectiveBatches?: number,
  builtBatches?: number,
): number {
  const grossPacks = Math.floor((ovensBatchCount * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item.eightPackBagCount ?? 0) * 4;
  const wonky = item.wonlyCount ?? 0;
  const extras = item.extraPacksBuilt ?? 0;
  const legacyShort = item.builderMarkedCompleteAt ? 0 : (item.shortCount ?? 0);
  // Extras cook in the same trays as the regular batches, so they count as
  // "through ovens" once ovens has caught up with what building ACTUALLY
  // produced (`builtBatches`) — never the planned/display target, which a
  // short build can leave permanently out of reach and strand the extras
  // (13 built of 14 planned: ovens can only ever reach 13, so gating on 14
  // hid the extra packs from wrapping forever).
  // If the caller supplied neither count, fall back to always crediting
  // (legacy behaviour) so unrelated callers aren't silently affected.
  const gate = builtBatches ?? effectiveBatches;
  const extrasCredit = gate === undefined ? extras : (ovensBatchCount >= gate ? extras : 0);
  return Math.max(0, grossPacks - eightPackDeduction - wonky - legacyShort) + extrasCredit;
}
