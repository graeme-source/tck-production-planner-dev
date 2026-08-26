import { describe, expect, it } from "vitest";
import { shouldVerify } from "./stock-gate-verify";

// The stock gate tags a product, then checks through Zapiet's calendar API
// that tomorrow really disappeared. That check used to run exactly once per
// hold: if it came back "failed" the dashboard showed "a hold isn't blocking,
// check Zapiet" for the rest of the hold's life, and nothing would ever
// re-examine it.
//
// Graeme hit precisely that on 2026-08-26 — he confirmed by hand that the
// held product WAS blocked in the date picker while the banner still said it
// wasn't. A safety net that cries wolf gets ignored, so a non-verified check
// is now retried until it settles.

const held = (over: Partial<Parameters<typeof shouldVerify>[0]> = {}) => ({
  verifyStatus: null as string | null,
  dryRun: false,
  shopifyVariantId: "123",
  productGid: "gid://shopify/Product/456",
  heldAt: new Date("2026-08-26T10:00:00Z"),
  ...over,
});

const LATER = new Date("2026-08-26T10:05:00Z").getTime();
const IMMEDIATELY = new Date("2026-08-26T10:00:30Z").getTime();

describe("shouldVerify", () => {
  it("checks a hold once Shopify has had a moment to reach Zapiet", () => {
    expect(shouldVerify(held(), LATER)).toBe(true);
  });

  it("waits out the grace period rather than judging instantly", () => {
    expect(shouldVerify(held(), IMMEDIATELY)).toBe(false);
  });

  it("retries a failed check instead of leaving the warning up forever", () => {
    // The regression. Zapiet may not have propagated yet, the rule may have
    // been finished a minute later, or the API may simply have blipped.
    expect(shouldVerify(held({ verifyStatus: "failed" }), LATER)).toBe(true);
  });

  it("retries a skipped check — the reason for skipping is usually temporary", () => {
    // "Tomorrow wasn't offered for anything today" is true on a Sunday and
    // false on Monday.
    expect(shouldVerify(held({ verifyStatus: "skipped" }), LATER)).toBe(true);
  });

  it("stops once a hold has verified — that answer is terminal", () => {
    expect(shouldVerify(held({ verifyStatus: "verified" }), LATER)).toBe(false);
  });

  it("never checks a dry-run hold, because nothing was tagged", () => {
    expect(shouldVerify(held({ dryRun: true }), LATER)).toBe(false);
    expect(shouldVerify(held({ dryRun: true, verifyStatus: "failed" }), LATER)).toBe(false);
  });

  it("skips a hold with nothing to look up", () => {
    expect(shouldVerify(held({ shopifyVariantId: null }), LATER)).toBe(false);
    expect(shouldVerify(held({ productGid: null }), LATER)).toBe(false);
  });
});
