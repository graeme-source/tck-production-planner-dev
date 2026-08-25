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
