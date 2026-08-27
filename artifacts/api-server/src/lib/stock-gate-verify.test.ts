import { describe, it, expect } from "vitest";
import {
  shouldVerify, nextVerifyStatus, needsAttention,
  FIRST_CHECK_DELAY_MS, RECHECK_INTERVAL_MS, CONFIDENCE_MS, MAX_ATTEMPTS,
  type VerifiableHold,
} from "./stock-gate-verify";

const T0 = new Date("2026-08-27T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function hold(over: Partial<VerifiableHold> = {}): VerifiableHold {
  return {
    heldAt: T0,
    dryRun: false,
    shopifyVariantId: "42",
    productGid: "gid://shopify/Product/7",
    verifyStatus: null,
    verifyAttempts: 0,
    verifyCheckedAt: null,
    ...over,
  };
}

describe("shouldVerify", () => {
  it("waits for Shopify to reach Zapiet before the first check", () => {
    // The bug: checking at sixty seconds and never again recorded a
    // not-yet-propagated tag as a permanent failure.
    expect(shouldVerify(hold(), at(60_000))).toBe(false);
    expect(shouldVerify(hold(), at(FIRST_CHECK_DELAY_MS))).toBe(true);
  });

  it("re-checks a hold that came back unconfirmed", () => {
    const h = hold({ verifyStatus: "unconfirmed", verifyAttempts: 1, verifyCheckedAt: at(FIRST_CHECK_DELAY_MS) });
    expect(shouldVerify(h, at(FIRST_CHECK_DELAY_MS + 60_000))).toBe(false);
    expect(shouldVerify(h, at(FIRST_CHECK_DELAY_MS + RECHECK_INTERVAL_MS))).toBe(true);
  });

  it("re-checks a settled failure too, so a late-working rule can clear it", () => {
    const h = hold({ verifyStatus: "failed", verifyAttempts: 3, verifyCheckedAt: T0 });
    expect(shouldVerify(h, at(RECHECK_INTERVAL_MS))).toBe(true);
  });

  it("re-checks a skipped hold — the reason it was skipped expires", () => {
    const h = hold({ verifyStatus: "skipped", verifyAttempts: 1, verifyCheckedAt: T0 });
    expect(shouldVerify(h, at(RECHECK_INTERVAL_MS))).toBe(true);
  });

  it("stops once verified — that answer cannot get worse", () => {
    const h = hold({ verifyStatus: "verified", verifyAttempts: 1, verifyCheckedAt: T0 });
    expect(shouldVerify(h, at(24 * 3600_000))).toBe(false);
  });

  it("gives up after enough attempts rather than polling Zapiet forever", () => {
    const h = hold({ verifyStatus: "failed", verifyAttempts: MAX_ATTEMPTS, verifyCheckedAt: T0 });
    expect(shouldVerify(h, at(24 * 3600_000))).toBe(false);
  });

  it("never checks a dry-run hold — no tag was written to verify", () => {
    expect(shouldVerify(hold({ dryRun: true }), at(3600_000))).toBe(false);
  });

  it("never checks a hold with nothing to ask about", () => {
    expect(shouldVerify(hold({ shopifyVariantId: null }), at(3600_000))).toBe(false);
    expect(shouldVerify(hold({ productGid: null }), at(3600_000))).toBe(false);
  });
});

describe("nextVerifyStatus", () => {
  it("believes a confirmation immediately", () => {
    expect(nextVerifyStatus("verified", { heldAt: T0 }, 1, at(FIRST_CHECK_DELAY_MS))).toBe("verified");
  });

  it("records a meaningless check as skipped, not as a failure", () => {
    expect(nextVerifyStatus("skipped", { heldAt: T0 }, 1, at(FIRST_CHECK_DELAY_MS))).toBe("skipped");
  });

  // The heart of the fix: one early "still offered" reading proves nothing.
  it("holds back on a single still-offered reading", () => {
    expect(nextVerifyStatus("failed", { heldAt: T0 }, 1, at(FIRST_CHECK_DELAY_MS))).toBe("unconfirmed");
    expect(nextVerifyStatus("failed", { heldAt: T0 }, 2, at(20 * 60_000))).toBe("unconfirmed");
  });

  it("needs both enough checks AND enough elapsed time before calling it failed", () => {
    // Enough attempts, too soon.
    expect(nextVerifyStatus("failed", { heldAt: T0 }, 5, at(10 * 60_000))).toBe("unconfirmed");
    // Enough time, too few attempts.
    expect(nextVerifyStatus("failed", { heldAt: T0 }, 1, at(CONFIDENCE_MS))).toBe("unconfirmed");
    // Both.
    expect(nextVerifyStatus("failed", { heldAt: T0 }, 3, at(CONFIDENCE_MS))).toBe("failed");
  });

  it("lets a confirmation overturn an earlier failure", () => {
    expect(nextVerifyStatus("verified", { heldAt: T0 }, 5, at(2 * 3600_000))).toBe("verified");
  });
});

describe("needsAttention", () => {
  it("is true only for a settled failure on a real hold", () => {
    expect(needsAttention({ dryRun: false, verifyStatus: "failed" })).toBe(true);
  });

  it("stays quiet for every in-flight state", () => {
    for (const s of ["unconfirmed", "skipped", "verified", null] as const) {
      expect(needsAttention({ dryRun: false, verifyStatus: s })).toBe(false);
    }
  });

  it("stays quiet for a dry run, which never wrote a tag", () => {
    expect(needsAttention({ dryRun: true, verifyStatus: "failed" })).toBe(false);
  });
});
