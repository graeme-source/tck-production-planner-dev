// The "dispatch" tag is the APPROVAL: an order carrying it has been signed
// off to go out on this delivery day. Everything downstream depends on it —
// most importantly courier booking, because a label commits us to shipping
// the order, so it must never be raised before the approval exists.
//
// ONE implementation. The check was written five separate times in
// routes/fulfilment.ts and the copies had drifted on case: some lower-cased
// the tag, some didn't, so an order tagged "Dispatch" counted in one place
// and not in another (2026-08-29).

export const DISPATCH_TAG = "dispatch";

/** True when the Shopify tag string carries the dispatch approval.
 *  Matches a whole tag, never a substring — "dispatched" and "no-dispatch"
 *  are different tags and must not count. */
export function isDispatchTagged(tags: string | null | undefined): boolean {
  return (tags ?? "").split(",").some(t => t.trim().toLowerCase() === DISPATCH_TAG);
}

/** Orders the customer collects from the unit: packed into a brown paper bag,
 *  left in the fridge, never booked with APC. The website applies one of these
 *  tags at checkout. Mirrors the packing screen's own list — see
 *  production-planner/src/lib/dispatch-tagging.ts. */
export const COLLECTION_TAGS = ["collections", "collection", "collection order"];

/** True when the order is collected from the unit rather than despatched.
 *  Whole tags only, so "no-collection" or "collections-team" never count. */
export function isCollectionOrder(tags: string | null | undefined): boolean {
  return (tags ?? "")
    .split(",")
    .some(t => COLLECTION_TAGS.includes(t.trim().toLowerCase()));
}

/** A collection order works on a DIFFERENT day from a courier order carrying
 *  the same date tag: the courier order tagged the 4th is packed on the 3rd,
 *  but the collection tagged the 4th is bagged and handed over ON the 4th. So
 *  a collection never belongs to the despatch wave that shares its tag — not
 *  in its counts, and not in its approval chase.
 *
 *  Two false alarms came out of missing that (Graeme, 2026-09-03): collections
 *  due tomorrow were reported as "not tagged for dispatch" on today's
 *  consignment — they are never dispatch-tagged, by design — and they inflated
 *  today's order counts with orders nobody is packing today. */
export function isPartOfDespatchWave(tags: string | null | undefined): boolean {
  return !isCollectionOrder(tags);
}

/** The rule behind "N orders awaiting approval". An order is chased for the
 *  dispatch tag only when it is actually part of the despatch wave — a
 *  collection is not, and must never be counted or tagged. */
export function needsDispatchApproval(tags: string | null | undefined): boolean {
  return !isDispatchTagged(tags) && isPartOfDespatchWave(tags);
}

// ── Cancelled orders are never despatched (Graeme, 21 Oct 2026) ─────────
// #137271 was cancelled and refunded on 16 Oct but still carried its
// delivery-date tag, so the morning's "tag for dispatch" stamped it and an
// APC label was booked for it. The order fetches never asked Shopify for
// cancelled_at, so nothing downstream could even see it was cancelled.
// "If an order is cancelled, we don't despatch it."
//
// The rule is cancelled_at ONLY. A refunded or partially refunded order
// that is NOT cancelled still goes out — "sometimes we send refunded orders
// because we've refunded a partial refund or something like that" — so
// financial_status must never decide this.

export type CancellableOrder = { cancelled_at?: string | null };

/** True when Shopify has cancelled the order. */
export function isCancelledOrder(order: CancellableOrder | null | undefined): boolean {
  return !!order?.cancelled_at;
}

/** The orders that can still be worked — cancelled ones removed. */
export function withoutCancelledOrders<T extends CancellableOrder>(orders: readonly T[]): T[] {
  return orders.filter(o => !isCancelledOrder(o));
}

type WaveOrder = CancellableOrder & { tags: string | null; fulfillment_status?: string | null };

/**
 * Orders the "tag for dispatch" step may stamp: unfulfilled, not cancelled,
 * not already tagged, and part of the despatch wave (never a collection).
 * The chargeback check comes after this, per order.
 */
export function bulkTagCandidates<T extends WaveOrder>(orders: readonly T[]): T[] {
  return orders.filter(o =>
    o.fulfillment_status !== "fulfilled"
    && !isCancelledOrder(o)
    && !isDispatchTagged(o.tags)
    && isPartOfDespatchWave(o.tags),
  );
}

/**
 * The packing bench's queue for a day: dispatch-tagged, not cancelled, and
 * not held (chargeback). An order tagged earlier and cancelled afterwards
 * drops off here on the next load.
 */
export function packQueueOrders<T extends WaveOrder>(orders: readonly T[], isHeld: (o: T) => boolean = () => false): T[] {
  return orders.filter(o => isDispatchTagged(o.tags) && !isCancelledOrder(o) && !isHeld(o));
}

/** "16 Oct" in London time, or null for a missing/unparseable timestamp. */
export function friendlyCancelledDate(cancelledAt: string | null | undefined): string | null {
  if (!cancelledAt) return null;
  const d = new Date(cancelledAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

/** The refusal every despatch path gives — shown on the bench as-is. */
export function cancelledOrderMessage(orderLabel: string, cancelledAt: string | null | undefined): string {
  const when = friendlyCancelledDate(cancelledAt);
  return `${orderLabel} was cancelled${when ? ` on ${when}` : ""} — not despatched.`;
}

/** A live APC label whose order has since been cancelled in Shopify. */
export type CancelledOrderLabel = {
  waybill: string;
  orderId: number;
  orderName: string;
  cancelledAt: string;
  message: string;
};

/**
 * Live labels (not cancelled in our ledger) whose Shopify order is now
 * cancelled. These are NOT cancelled automatically — an APC write needs a
 * person — the packing screen shows them as "Cancelled in Shopify — cancel
 * this label".
 */
export function cancelledOrderLabels(
  liveConsignments: ReadonlyArray<{ waybill: string; orderId: number; orderName: string }>,
  orders: ReadonlyArray<{ id: number; name: string; cancelled_at?: string | null }>,
): CancelledOrderLabel[] {
  const cancelled = new Map(orders.filter(isCancelledOrder).map(o => [o.id, o]));
  return liveConsignments
    .filter(c => cancelled.has(c.orderId))
    .map(c => {
      const o = cancelled.get(c.orderId)!;
      const name = o.name || c.orderName;
      return {
        waybill: c.waybill,
        orderId: c.orderId,
        orderName: name,
        cancelledAt: o.cancelled_at!,
        message: `Cancelled in Shopify — cancel this label. ${cancelledOrderMessage(name, o.cancelled_at)}`,
      };
    });
}
