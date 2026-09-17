/**
 * The two decisions behind the packing "orders still to go out" closing check.
 *
 * Pure and dependency-free so they can be unit tested — the module that
 * actually talks to Shopify pulls in the database, which tests must not.
 */

/** The delivery tag packing is working to on a given dispatch day.
 *
 *  Packing today goes out for tomorrow. Anchored at noon UTC so the date is
 *  unambiguous either side of the BST/GMT switch, where a naive +24 hours
 *  lands on the wrong day. */
export function deliveryTagFor(dispatchDateIso: string): string {
  const d = new Date(`${dispatchDateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Does the closing check appear today?
 *
 * Only when something is genuinely outstanding — a check that is nearly
 * always a no-op teaches people to tick without reading (Graeme, 2026-09-17).
 *
 * `null` means the lookup failed, and then it SHOWS: hiding on an error would
 * quietly tell the team everything had gone out, which is the one wrong
 * answer to give by accident.
 */
export function showOutstandingCheck(count: number | null): boolean {
  if (count == null) return true;
  return count > 0;
}
