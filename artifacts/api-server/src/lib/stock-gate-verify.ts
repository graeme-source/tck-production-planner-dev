/**
 * When to check a stock-gate hold against Zapiet, and what to believe.
 *
 * WHY THIS EXISTS (Graeme, 2026-08-27): the banner said "a hold isn't
 * blocking, check Zapiet" for a product that WAS being blocked on the live
 * site. A false negative on a safety mechanism is worse than no message at
 * all — it teaches people to distrust the one banner that matters.
 *
 * The cause was structural, not cosmetic. The old code checked each hold
 * exactly ONCE, sixty seconds after tagging, and then filtered on
 * `verifyStatus === null` forever after. So:
 *
 *   • Tagging a product in Shopify does not instantly change what Zapiet's
 *     calendar returns. A minute is optimistic.
 *   • Whatever that single early check said became permanent. A hold that
 *     started working at minute three was still recorded as "failed" at
 *     minute three hundred, and the dashboard shouted about it all day.
 *
 * So verification is now a repeated observation with a settling period, and
 * a single "still offered" reading is no longer treated as proof of failure:
 *
 *   null          not checked yet, or still inside the settling window
 *   verified      Zapiet confirms tomorrow is gone. TERMINAL — stop asking.
 *   skipped       the check couldn't say anything (no API key, or tomorrow
 *                 wasn't on offer for anything today). Re-checked later,
 *                 because that reason expires.
 *   unconfirmed   Zapiet still offers tomorrow, but not for long enough or
 *                 often enough to conclude anything. NOT an alarm.
 *   failed        still offered after the confidence window. Worth a look —
 *                 and even here the wording is "couldn't confirm", because
 *                 the only thing we actually know is what Zapiet's calendar
 *                 API told us, which is not the same as what the storefront
 *                 does.
 *
 * Everything here is pure so the timing rules can be tested without a
 * database, a clock, or Zapiet.
 */

/** What a single Zapiet calendar check can come back with. */
export type RawVerifyResult = "verified" | "failed" | "skipped";

/** What we store. `null` means "no answer yet". */
export type VerifyStatus = "verified" | "failed" | "skipped" | "unconfirmed" | null;

/** Leave Shopify → Zapiet time to propagate before the first check. Sixty
 *  seconds was not enough and produced the false negative this module fixes. */
export const FIRST_CHECK_DELAY_MS = 5 * 60_000;

/** Don't hammer Zapiet — one check per hold per this interval. */
export const RECHECK_INTERVAL_MS = 10 * 60_000;

/** Before calling a hold failed: at least this many checks that all said
 *  "still offered"… */
export const CONFIDENCE_ATTEMPTS = 3;

/** …spanning at least this long since the tag was written. */
export const CONFIDENCE_MS = 30 * 60_000;

/** Stop re-checking eventually; the answer isn't going to change and the
 *  hold releases itself when stock recovers. */
export const MAX_ATTEMPTS = 8;

/** The status column is free-form `text`, so these read it as `string | null`
 *  rather than the narrow union — a value written by an older version of this
 *  code must not make the poller fall over. */
export interface VerifiableHold {
  heldAt: Date;
  dryRun: boolean;
  shopifyVariantId: string | null;
  productGid: string | null;
  verifyStatus: string | null;
  verifyAttempts: number;
  verifyCheckedAt: Date | null;
}

/**
 * Should this hold be checked against Zapiet right now?
 *
 * A dry-run hold wrote no tag, so there is nothing to verify. A hold with no
 * variant or product can't be asked about. A verified hold is done.
 */
export function shouldVerify(hold: VerifiableHold, now: Date): boolean {
  if (hold.dryRun) return false;
  if (!hold.shopifyVariantId || !hold.productGid) return false;
  if (hold.verifyStatus === "verified") return false;
  if (hold.verifyAttempts >= MAX_ATTEMPTS) return false;
  const age = now.getTime() - hold.heldAt.getTime();
  if (age < FIRST_CHECK_DELAY_MS) return false;
  if (hold.verifyCheckedAt == null) return true;
  return now.getTime() - hold.verifyCheckedAt.getTime() >= RECHECK_INTERVAL_MS;
}

/**
 * The status to record after a check came back.
 *
 * `attemptsAfter` is the attempt count INCLUDING this check, so the first
 * check passes 1.
 */
export function nextVerifyStatus(
  raw: RawVerifyResult,
  hold: { heldAt: Date },
  attemptsAfter: number,
  now: Date,
): VerifyStatus {
  if (raw === "verified") return "verified";
  if (raw === "skipped") return "skipped";
  // raw === "failed": Zapiet still offers tomorrow. That is only news once
  // it has stayed true across several checks and a decent stretch of time.
  const settled =
    attemptsAfter >= CONFIDENCE_ATTEMPTS
    && now.getTime() - hold.heldAt.getTime() >= CONFIDENCE_MS;
  return settled ? "failed" : "unconfirmed";
}

/**
 * Is this hold worth drawing attention to on the dashboard?
 *
 * Deliberately narrow: only a settled `failed`, and only for a real (non
 * dry-run) hold. Everything else — pending, unconfirmed, skipped — is
 * ordinary in-flight state and gets no colour of its own.
 */
export function needsAttention(hold: { dryRun: boolean; verifyStatus: string | null }): boolean {
  return !hold.dryRun && hold.verifyStatus === "failed";
}
