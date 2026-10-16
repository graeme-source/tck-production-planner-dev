import { describe, it, expect } from "vitest";
import { shopifyWrapStatusText } from "./shopify-wrap-status-text";

describe("wrap-to-Shopify status words", () => {
  it("sent", () => expect(shopifyWrapStatusText({ state: "ok", sentPacks: 8 })).toEqual({ tone: "ok", text: "+8 sent to Shopify ✓" }));
  it("failed says retry", () => {
    const t = shopifyWrapStatusText({ state: "failed", failedIds: [3], failedPacks: 8, error: "Throttled", sentPacks: 0 });
    expect(t.tone).toBe("bad");
    expect(t.text).toBe("Shopify update failed (+8) — retry: Throttled");
  });
  it("writes off is never shown as success", () => {
    expect(shopifyWrapStatusText({ state: "skipped", packs: 8 }).tone).toBe("off");
  });
  it("nothing yet", () => expect(shopifyWrapStatusText(undefined).tone).toBe("none"));
});
