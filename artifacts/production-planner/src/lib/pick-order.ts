/**
 * The pick walk — the single source of truth for the order anything in the
 * building is visited in.
 *
 * Graeme, 2026-09-18: "This should come from a single source of truth... We
 * should always follow the dynamic picking order that is presented in the
 * picking screen, not just copy it once."
 *
 * The walk is: zones in the order set on the Bin Locations page (drag the
 * zone cards there to do the fridge or the freezer first), then door by
 * door, then shelf by shelf with A at the top. That is exactly the fridge
 * map as drawn on Bin Locations, so the map IS the order.
 *
 * Every caller passes the LIVE zone order in from the pick-config query
 * (`GET /api/fulfilment/pick-config`) — nothing in here hard-codes
 * fridge → freezer → ambient, because an admin can reorder the zones.
 *
 * Used by:
 *  - Order Packing Live's picking list (`pages/fulfilment.tsx`)
 *  - The packing station's first/last pack batch-number checks
 *    (`pages/station/shared/checklist/station-checklist.tsx`)
 */

/** A bin on the fridge map. Door/shelf are null on the ambient tray and on
 *  legacy free-text locations. */
export interface PickBin {
  zone: string;
  door?: number | null;
  shelf?: string | null;
}

export type ZoneOrder = readonly string[];

/** Only a fallback for the instant before the pick-config query resolves.
 *  Never use this as the answer — read the config. */
export const FALLBACK_ZONE_ORDER: ZoneOrder = ["fridge", "freezer", "ambient"];

/**
 * Compare two bins by the walk: zone, then door, then shelf.
 *
 * A missing bin sorts LAST — you cannot walk to something with no home, so
 * it goes after everything you can. Two bins that are the same bin (or both
 * missing) compare equal, which leaves whatever order the caller already had
 * intact under a stable sort.
 *
 * Note on an unknown zone: `indexOf` returns -1, which puts a zone that is
 * not in the configured order BEFORE every zone that is. That is the
 * behaviour Order Packing Live has always had and it is preserved here
 * deliberately — the zone list is a fixed three-value enum and the Bin
 * Locations page only ever reorders the zones it was given, so it is not
 * reachable through the UI. See the test that pins it.
 */
export function compareBins(
  a: PickBin | null | undefined,
  b: PickBin | null | undefined,
  zoneOrder: ZoneOrder,
): number {
  const idxA = a ? zoneOrder.indexOf(a.zone) : zoneOrder.length;
  const idxB = b ? zoneOrder.indexOf(b.zone) : zoneOrder.length;
  if (idxA !== idxB) return idxA - idxB;

  // Within a zone the walk is door by door, shelf by shelf (A at the top).
  const doorA = a?.door ?? Number.MAX_SAFE_INTEGER;
  const doorB = b?.door ?? Number.MAX_SAFE_INTEGER;
  if (doorA !== doorB) return doorA - doorB;

  const shelfA = a?.shelf ?? "ZZ";
  const shelfB = b?.shelf ?? "ZZ";
  if (shelfA !== shelfB) return shelfA.localeCompare(shelfB);

  return 0;
}

/**
 * The earliest bin in the walk among a set of bins — where you FIRST meet
 * this thing as you walk.
 *
 * A recipe can map to several Shopify variants (2-pack, 8-pack bag, wonky)
 * and they may sit in different bins. The recipe belongs at the first door
 * where any of its packs live, because that is where the picker meets it.
 * Returns null when none of them have a bin.
 */
export function earliestBin(
  bins: readonly (PickBin | null | undefined)[] | null | undefined,
  zoneOrder: ZoneOrder,
): PickBin | null {
  let best: PickBin | null = null;
  for (const bin of bins ?? []) {
    if (!bin) continue;
    if (best === null || compareBins(bin, best, zoneOrder) < 0) best = bin;
  }
  return best;
}

/** A row on the picking list: a bin, plus the tie-breakers used when two
 *  items share one. */
export interface PickWalkItem {
  location?: PickBin | null;
  sku?: string | null;
  title?: string | null;
}

/**
 * The full picking-list comparator: the walk first, then — for two items in
 * the same bin, or two items with no bin at all — the kitchen's own SKU
 * label numbering (1, 3c, 5b, 5c), then the title.
 *
 * Items with no SKU sort after items that have one.
 */
export function comparePickWalk(
  a: PickWalkItem,
  b: PickWalkItem,
  zoneOrder: ZoneOrder,
): number {
  const byBin = compareBins(a.location, b.location, zoneOrder);
  if (byBin !== 0) return byBin;

  // Same bin (or no bin): SKU natural sort keeps the kitchen's label
  // numbering; items with no SKU sort last.
  if (a.sku && !b.sku) return -1;
  if (!a.sku && b.sku) return 1;
  if (a.sku && b.sku) return a.sku.localeCompare(b.sku, undefined, { numeric: true });
  return (a.title ?? "").localeCompare(b.title ?? "");
}

/**
 * Sort any list of rows into the walk, given a way to read each row's bins.
 *
 * Stable: rows that land in the same place — same bin, or no bin at all —
 * keep the order they arrived in. That is what keeps recipes with no bin
 * sitting at the end in their existing (SKU) order rather than being
 * shuffled or, worse, hidden.
 */
export function sortByPickOrder<T>(
  rows: readonly T[],
  binsOf: (row: T) => readonly (PickBin | null | undefined)[] | null | undefined,
  zoneOrder: ZoneOrder,
): T[] {
  const decorated = rows.map(row => ({ row, bin: earliestBin(binsOf(row), zoneOrder) }));
  decorated.sort((x, y) => compareBins(x.bin, y.bin, zoneOrder));
  return decorated.map(d => d.row);
}
