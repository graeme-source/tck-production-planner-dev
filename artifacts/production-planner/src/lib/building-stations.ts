// ── Building stations: one rule for "has building started?" ────────────────
//
// Builds are recorded per building table — station types building_1 and
// building_2 (and any building_N added later). Nothing is ever recorded
// under a bare "building", so checking that name alone never sees a build:
// that's why the Mixing padlock (row locked once building has started) never
// appeared (Graeme approved the fix, 23 Oct 2026).
//
// Rule: a station type is a building station when it is "building" or
// "building_" followed by a table number. Pure, no React.

const BUILDING_STATION = /^building(?:_\d+)?$/;

/** True for building_1, building_2, … building_N (and the legacy bare
 *  "building"). False for anything else, e.g. "rebuilding" or "building_x". */
export function isBuildingStation(stationType: string): boolean {
  return BUILDING_STATION.test(stationType);
}

/** Batches completed across every building station, from an item's
 *  stationCompletions map ({ station type → batches done }). */
export function buildingBatchesDone(stationCompletions: unknown): number {
  if (!stationCompletions || typeof stationCompletions !== "object") return 0;
  let total = 0;
  for (const [station, count] of Object.entries(stationCompletions as Record<string, unknown>)) {
    if (!isBuildingStation(station)) continue;
    const n = Number(count);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/** Has building started on this item? (Any building table has completed a batch.) */
export function hasBuildingStarted(item: { stationCompletions?: unknown }): boolean {
  return buildingBatchesDone(item.stationCompletions) > 0;
}
