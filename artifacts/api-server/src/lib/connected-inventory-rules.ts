/**
 * Connected Inventory — the maths (Graeme, 10 Nov 2026). Objective C.
 *
 * Product fridge items (Sauce Shop bottles, Cakehead bakes) are sold on the
 * store, so Shopify knows how many are on the shelf. When we're ordering
 * from their supplier anyway — a kanban was pulled, or something else is on
 * the card — every connected item of that supplier is topped up to its
 * maximum in the same order. One delivery, one delivery charge, and nothing
 * runs short the day after.
 *
 * Whole supplier packs only, rounded DOWN, so the delivery never takes us
 * over the maximum (there's room for all of it). Stock already on its way
 * counts as stock.
 */

/** Packs the supplier sends that top an item up to its maximum, never over. */
export function connectedTopUpPacks(args: {
  /** Shopify on-hand, in store units (bottles, bars). */
  onHandUnits: number;
  /** Store units still to arrive on placed orders. */
  inboundUnits: number;
  /** The most we hold, in store units. */
  maxUnits: number;
  /** Store units in one supplier pack (a case of 6 → 6). */
  unitsPerPack: number;
}): number {
  const per = args.unitsPerPack > 0 ? args.unitsPerPack : 1;
  const room = args.maxUnits - Math.max(0, args.onHandUnits) - Math.max(0, args.inboundUnits);
  if (!(room > 0)) return 0;
  return Math.floor(room / per + 1e-9);
}

/** Undelivered quantity on an open order line, in supplier packs. Lines
 *  counted in packs or bottles are packs already; anything else is the
 *  item's own unit, so divide by the pack size. */
export function inboundPacks(qty: number, unit: string, packWeight: number): number {
  if (!(qty > 0)) return 0;
  if (unit === "packs" || unit === "pack" || unit === "bottles") return qty;
  return packWeight > 0 ? qty / packWeight : qty;
}

/** Is this supplier card ordering anything? Only then are its connected
 *  items topped up — an empty or all-greyed-out card isn't an order. */
export function cardIsOrdering(lines: ReadonlyArray<{ packsToOrder: number; belowRequirement: boolean }>): boolean {
  return lines.some(l => !l.belowRequirement && l.packsToOrder > 0);
}
