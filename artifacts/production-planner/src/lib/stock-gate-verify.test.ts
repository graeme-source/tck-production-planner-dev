import { describe, it, expect } from "vitest";
import {
  holdVerifyState,
  anyHoldNotBlocking,
  ZAPIET_SETTLE_MINUTES,
  type VerifiableHold,
} from "./stock-gate-verify";

const NOW = new Date("2026-09-03T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const hold = (over: Partial<VerifiableHold> = {}): VerifiableHold => ({
  dryRun: false,
  verifyStatus: null,
  heldAt: minutesAgo(1),
  ...over,
});

describe("holdVerifyState", () => {
  it("says nothing is blocking on a dry run — nothing was tagged", () => {
    expect(holdVerifyState(hold({ dryRun: true, verifyStatus: "failed" }), NOW)).toBe("dry-run");
  });

  it("reports a confirmed hold", () => {
    expect(holdVerifyState(hold({ verifyStatus: "verified" }), NOW)).toBe("confirmed");
  });

  it("treats a hold with no check yet as pending, not as a failure", () => {
    expect(holdVerifyState(hold({ verifyStatus: null }), NOW)).toBe("pending");
  });

  it("keeps a skipped check out of the alarm — it was never a verdict", () => {
    // "no API key" and "tomorrow isn't offered today" both land here.
    expect(holdVerifyState(hold({ verifyStatus: "skipped" }), NOW)).toBe("unchecked");
  });

  // The bug: Shopify → Zapiet isn't instant, so a check run moments after the
  // tag went on found tomorrow still bookable, wrote "failed", and was never
  // run again — a permanent red alarm on a gate that worked.
  it("gives Zapiet time to catch up before calling a failure real", () => {
    expect(holdVerifyState(hold({ verifyStatus: "failed", heldAt: minutesAgo(2) }), NOW)).toBe("settling");
    expect(holdVerifyState(hold({ verifyStatus: "failed", heldAt: minutesAgo(ZAPIET_SETTLE_MINUTES - 1) }), NOW)).toBe("settling");
  });

  // But the alarm still has to work: a date we genuinely can't cover being
  // orderable for next-day delivery is the whole reason the gate exists.
  it("still reports a hold that is not blocking well after the tag went on", () => {
    expect(holdVerifyState(hold({ verifyStatus: "failed", heldAt: minutesAgo(ZAPIET_SETTLE_MINUTES + 1) }), NOW)).toBe("not-blocking");
    expect(holdVerifyState(hold({ verifyStatus: "failed", heldAt: minutesAgo(600) }), NOW)).toBe("not-blocking");
  });

  it("never silences a failure because of an unreadable timestamp", () => {
    expect(holdVerifyState(hold({ verifyStatus: "failed", heldAt: "not a date" }), NOW)).toBe("not-blocking");
  });
});

describe("anyHoldNotBlocking", () => {
  it("is quiet while a fresh hold settles", () => {
    expect(anyHoldNotBlocking([
      hold({ verifyStatus: "verified", heldAt: minutesAgo(90) }),
      hold({ verifyStatus: "failed", heldAt: minutesAgo(3) }),
    ], NOW)).toBe(false);
  });

  it("raises the alarm for one stuck hold among healthy ones", () => {
    expect(anyHoldNotBlocking([
      hold({ verifyStatus: "verified", heldAt: minutesAgo(90) }),
      hold({ verifyStatus: "failed", heldAt: minutesAgo(90) }),
    ], NOW)).toBe(true);
  });

  it("is quiet with no holds at all", () => {
    expect(anyHoldNotBlocking([], NOW)).toBe(false);
  });

  it("never raises the alarm on dry-run holds", () => {
    expect(anyHoldNotBlocking([
      hold({ dryRun: true, verifyStatus: "failed", heldAt: minutesAgo(600) }),
    ], NOW)).toBe(false);
  });
});
