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
 *
 * Only stock Shopify is counting is trusted: a product with "Track quantity"
 * off just drifts below zero, which would read as an empty shelf and order a
 * full load every time (Original Hot Sauce, 18 Nov 2026: 8 cases for a
 * 6-case kanban).
 */
import { kanbanOrderPacks } from "@workspace/units";

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

/**
 * The most we hold, in store units (Graeme, 25 Nov 2026: "we just always want
 * to order up to the kanban, what it would give us when we've had the
 * delivery"). With a kanban on, that's what's left when the card is pulled
 * plus what the card orders: pull at 48, order 48 → 96, so 60 left orders 36.
 * The typed maximum is only used when the item has no complete kanban.
 */
export function connectedMaxUnits(i: {
  kanbanEnabled: boolean | null;
  kanbanQuantity: number | string | null;
  kanbanOrderAmount: number | string | null;
  kanbanUnit: string | null;
  packWeight: number | string | null;
  palletSize: number | null;
  shopifyUnitsPerPack: number | string | null;
  maxStockUnits: number | null;
}): { maxUnits: number; kanban: { pullAtUnits: number; orderUnits: number } | null } | null {
  const per = Number(i.shopifyUnitsPerPack) > 0 ? Number(i.shopifyUnitsPerPack) : 1;
  const pullAt = Number(i.kanbanQuantity);
  const order = Number(i.kanbanOrderAmount);
  if (i.kanbanEnabled && pullAt > 0 && order > 0) {
    // "weight" reads as packs, as the Orders page's kanban lines do.
    const unit = i.kanbanUnit === "weight" ? "pack" : i.kanbanUnit;
    const sizes = { packWeight: i.packWeight, palletSize: i.palletSize };
    const orderPacks = kanbanOrderPacks(order, unit, sizes);
    // What's left isn't an order, so it isn't rounded up to whole packs.
    const pw = Number(i.packWeight);
    const pullAtPacks = unit === "unit" ? (pw > 0 ? pullAt / pw : pullAt)
      : unit === "pallet" ? pullAt * (i.palletSize ?? 0)
      : pullAt;
    if (orderPacks.warning == null && pullAtPacks > 0) {
      const pullAtUnits = Math.round(pullAtPacks * per);
      const orderUnits = Math.round(orderPacks.packs * per);
      return { maxUnits: pullAtUnits + orderUnits, kanban: { pullAtUnits, orderUnits } };
    }
  }
  return (i.maxStockUnits ?? 0) > 0 ? { maxUnits: i.maxStockUnits!, kanban: null } : null;
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
