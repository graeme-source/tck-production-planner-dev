/**
 * When the stock gate should re-check a hold against Zapiet.
 *
 * Kept apart from stock-gating.ts so it can be unit-tested: that module opens
 * a database connection at import time, and the test harness is pure logic
 * only.
 */

/** Shopify → Zapiet propagation isn't instant, so a hold is not judged the
 *  moment it is tagged. */
export const VERIFY_GRACE_MS = 60_000;

/** A ceiling on Zapiet calls per cycle. Re-checking is cheap for the handful
 *  of holds normally live, but the gate must not turn into a polling loop
 *  against someone else's API if a bad day produces dozens. */
export const MAX_VERIFIES_PER_CYCLE = 10;

export interface VerifiableHold {
  verifyStatus: string | null;
  dryRun: boolean;
  shopifyVariantId: string | null;
  productGid: string | null;
  heldAt: Date;
}

/**
 * Should this hold's Zapiet check run (again) this cycle?
 *
 * "verified" is the ONLY terminal answer. Everything else is retried, because
 * the check is a snapshot of an external system while the dashboard presents
 * it as current state.
 *
 * A failed check used to be permanent: it ran once, and if Zapiet had not yet
 * picked up the tag — or the rule was finished a minute later, or the API
 * blipped — the banner read "a hold isn't blocking, check Zapiet" for the
 * rest of that hold's life, clearable only by releasing the hold. Graeme
 * confirmed by hand that a hold flagged this way was in fact blocking
 * (2026-08-26): the gate was right and the badge was stale, which is the
 * worse of the two failures — it teaches people to distrust a safety net that
 * is working.
 */
export function shouldVerify(hold: VerifiableHold, now: number): boolean {
  if (hold.dryRun) return false;                       // nothing was tagged
  if (!hold.shopifyVariantId || !hold.productGid) return false;
  if (hold.verifyStatus === "verified") return false;  // settled
  return now - hold.heldAt.getTime() > VERIFY_GRACE_MS;
}
