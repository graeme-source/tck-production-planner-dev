/** When a stock-gate hold's Zapiet check should be believed.
 *
 *  The gate does two things when a product runs short: it puts a tag on the
 *  product in Shopify, and Zapiet's preparation-time rule reads that tag and
 *  pulls tomorrow off the delivery calendar. The app then checks Zapiet's own
 *  calendar API to confirm tomorrow really did go.
 *
 *  That confirmation is not instant. Shopify has to save the tag, and Zapiet
 *  has to notice it. Checking a minute later and never checking again turned
 *  a slow handover into a permanent red alarm saying the hold "isn't
 *  blocking" — on a gate that was working perfectly well (Graeme,
 *  2026-09-03). The check now repeats, and this decides when a failure has
 *  gone on long enough to be worth shouting about.
 *
 *  The alarm is NOT deleted, because the thing it warns about is real: a
 *  product we can't cover still being orderable for next-day delivery. It
 *  just has to be true before it shouts.
 */

/** How long Shopify → Zapiet gets before a failed check is treated as real. */
export const ZAPIET_SETTLE_MINUTES = 20;

export type HoldVerifyState =
  /** Not a real hold — nothing was tagged. */
  | "dry-run"
  /** Zapiet confirms tomorrow is gone. */
  | "confirmed"
  /** Checked and not blocking yet, but still inside the settle window. */
  | "settling"
  /** Still not blocking well after the tag went on. This one is worth red. */
  | "not-blocking"
  /** Couldn't be checked at all (no API key, or tomorrow isn't offered). */
  | "unchecked"
  /** Tagged, first check not due yet. */
  | "pending";

export interface VerifiableHold {
  dryRun: boolean;
  verifyStatus: string | null;
  heldAt: string;
}

export function holdVerifyState(hold: VerifiableHold, now: Date = new Date()): HoldVerifyState {
  if (hold.dryRun) return "dry-run";
  if (hold.verifyStatus === "verified") return "confirmed";
  if (hold.verifyStatus === "skipped") return "unchecked";
  if (hold.verifyStatus === "failed") {
    const heldMs = now.getTime() - new Date(hold.heldAt).getTime();
    // An unparseable timestamp must not silence a real failure.
    if (Number.isNaN(heldMs)) return "not-blocking";
    return heldMs < ZAPIET_SETTLE_MINUTES * 60_000 ? "settling" : "not-blocking";
  }
  return "pending";
}

/** Does the banner have something genuinely wrong to report? Only a hold that
 *  is STILL not blocking after the settle window counts. */
export function anyHoldNotBlocking(holds: readonly VerifiableHold[], now: Date = new Date()): boolean {
  return holds.some(h => holdVerifyState(h, now) === "not-blocking");
}
