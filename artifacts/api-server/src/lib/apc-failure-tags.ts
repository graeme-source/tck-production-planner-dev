/**
 * Marking orders APC won't carry.
 *
 * When a consignment can't be booked because the courier has no service to
 * that postcode on that day, the order needs to be findable in Shopify — to
 * search for, to build a segment from, to hang a Flow off, or just to see the
 * reason on the order itself rather than only in a batch report that vanishes
 * when the dialog closes.
 *
 * The tag means "APC will not carry this RIGHT NOW", not "this once failed".
 * So it is removed again the moment the order books, or is rescheduled to a
 * day the courier does serve. A tag that outlives its cause is worse than no
 * tag: it accumulates on orders that shipped perfectly well and quietly
 * poisons every search and segment built on it.
 */

/** The tag applied to an order APC has refused on service grounds. */
export const APC_NO_SERVICE_TAG = "apc-no-service";

/**
 * Is this failure the courier saying "no service to here, on this day"?
 *
 * Deliberately narrow. APC returns the same shaped error for a lot of things,
 * and only this one is a statement about coverage:
 *
 *   tagged   — "APC order failed: NO Services available."
 *   NOT      — authentication failures (our credentials, not their coverage)
 *   NOT      — missing address or postcode (our data, fixable here)
 *   NOT      — transport errors and timeouts (says nothing either way)
 *
 * Mis-tagging any of those would put a permanent "we can't deliver here" mark
 * on an order that is perfectly deliverable.
 */
export function isNoServiceFailure(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  if (!m) return false;
  // An auth or system failure can mention services in passing; never treat
  // those as a coverage verdict.
  if (m.includes("authentication") || m.includes("credential") || m.includes("100019")) return false;
  return m.includes("no services available");
}

/**
 * Is this failure something the operator can go and FIX on the order, then
 * retry — rather than something about coverage or about us?
 *
 *   yes — "CREATION FAILED — Delivery City: Enter a value less than 32
 *         characters long" (Graeme shortened the city and retried)
 *   yes — our own "Missing address or postcode"
 *   NO  — no-service refusals: the data is fine, the route isn't
 *   NO  — authentication and transport errors: nothing on the order to fix
 *
 * Only used to decide whether to show "fix it in Shopify, then Retry"
 * alongside the courier's own wording, so a wrong answer costs a line of
 * text, never a booking.
 */
export function isDataFixableFailure(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  if (!m) return false;
  if (isNoServiceFailure(m)) return false;
  if (m.includes("authentication") || m.includes("credential") || m.includes("100019")) return false;
  return m.includes("creation failed") || m.includes("missing address or postcode");
}
