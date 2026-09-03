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
