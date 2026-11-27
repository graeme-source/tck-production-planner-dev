import { describe, expect, it } from "vitest";
import { describeFailure, entriesToKeep, isRetryable, retryDelayMs, type QueueEntry } from "./fulfil-queue";

describe("fulfil queue rules", () => {
  it("retries when the server wasn't there, never on our server's own answer", () => {
    expect(isRetryable(null)).toBe(true);
    // Railway's edge while the app restarts (#140447, 27 Nov 2026).
    expect(isRetryable(502, { status: "error", code: 502, message: "Application failed to respond" })).toBe(true);
    expect(isRetryable(503, null)).toBe(true);
    expect(isRetryable(502, { error: "Shopify won't accept fulfilment" })).toBe(false);
    expect(isRetryable(409, { error: "No barcode" })).toBe(false);
    expect(isRetryable(400)).toBe(false);
  });
  it("backs off then settles at 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 15000, 30000, 30000]);
  });
  it("keeps a day of entries and resumes one cut off mid-send", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    const e = (orderId: number, hoursAgo: number, state: QueueEntry["state"]): QueueEntry => ({
      key: String(orderId), orderId, orderName: `#${orderId}`, customerName: "x", consignmentNumber: null,
      firstAt: now - hoursAgo * 3600_000, tries: 1, lastError: null, state,
    });
    const kept = entriesToKeep([e(1, 1, "sending"), e(2, 2, "gave-up"), e(3, 25, "waiting")], now);
    expect(kept.map(k => [k.orderId, k.state])).toEqual([[1, "waiting"], [2, "gave-up"]]);
  });
  it("says 'didn't answer' for a restart, the server's words otherwise", () => {
    expect(describeFailure(null, null)).toMatch(/didn't answer/);
    expect(describeFailure(502, null)).toMatch(/didn't answer/);
    expect(describeFailure(502, "Shopify won't accept fulfilment")).toBe("Shopify won't accept fulfilment");
    expect(describeFailure(409, "No barcode")).toBe("No barcode");
  });
});
