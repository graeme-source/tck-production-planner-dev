import { describe, expect, it } from "vitest";
import { attemptOutcome } from "./fulfil-attempt-rules";

describe("attemptOutcome", () => {
  it("a 200 is fulfilled, keeping a stock-decrement failure", () => {
    expect(attemptOutcome(200, { ok: true, decrementError: null })).toEqual({ outcome: "fulfilled", error: null });
    expect(attemptOutcome(200, { ok: true, decrementError: "boom" })).toEqual({ outcome: "fulfilled", error: "boom" });
  });
  it("a 4xx gate is refused with its reason", () => {
    expect(attemptOutcome(409, { error: "No barcode", code: "NO_BARCODE" })).toEqual({ outcome: "refused", error: "No barcode" });
  });
  it("a 5xx is failed; no body still says something", () => {
    expect(attemptOutcome(502, { error: "Shopify won't accept" })).toEqual({ outcome: "failed", error: "Shopify won't accept" });
    expect(attemptOutcome(500, null)).toEqual({ outcome: "failed", error: "HTTP 500" });
  });
});

import { bookingToSend, stillOpenInShopify } from "./fulfil-attempt-rules";

describe("stillOpenInShopify", () => {
  it("unfulfilled or partial and not cancelled", () => {
    expect(stillOpenInShopify({ fulfillment_status: null, cancelled_at: null })).toBe(true);
    expect(stillOpenInShopify({ fulfillment_status: "partial", cancelled_at: null })).toBe(true);
    expect(stillOpenInShopify({ fulfillment_status: "fulfilled", cancelled_at: null })).toBe(false);
    expect(stillOpenInShopify({ fulfillment_status: null, cancelled_at: "2026-11-27T10:00:00Z" })).toBe(false);
    expect(stillOpenInShopify(null)).toBe(false);
  });
});

describe("bookingToSend", () => {
  const row = (waybill: string, createdAt: string, extra: Partial<{ cancelledAt: string; supersededAt: string }> = {}) =>
    ({ waybill, trackingUrl: `https://t/${waybill}`, createdAt, cancelledAt: extra.cancelledAt ?? null, supersededAt: extra.supersededAt ?? null });
  it("newest live booking, skipping cancelled and retired ones", () => {
    expect(bookingToSend([
      row("A", "2026-11-26T08:00:00Z"),
      row("B", "2026-11-27T08:00:00Z", { cancelledAt: "2026-11-27T09:00:00Z" }),
      row("C", "2026-11-27T07:00:00Z"),
    ])).toEqual({ waybill: "C", trackingUrl: "https://t/C" });
  });
  it("none live → null", () => {
    expect(bookingToSend([row("A", "2026-11-27T08:00:00Z", { supersededAt: "2026-11-27T09:00:00Z" })])).toBeNull();
    expect(bookingToSend([])).toBeNull();
  });
});

import { diagnoseStuckFulfil, type DiagnosisInput } from "./fulfil-attempt-rules";

describe("diagnoseStuckFulfil", () => {
  // #140447, 27 Nov 2026: label printed 10:16:53, Complete 10:19:45 while
  // the server was mid-restart (back at 10:19:40 … the press that DID reach
  // a dying server is the "started" case).
  const base: DiagnosisInput = {
    attempts: [{ outcome: "started", startedAt: "2026-11-27T10:19:37Z", error: null, consignmentNumber: "2026112703036990023665" }],
    serverStarts: ["2026-11-27T10:17:05Z", "2026-11-27T10:19:40Z"],
    shopifyOpen: true,
    booking: { waybill: "2026112703036990023665", labelPrintedAt: "2026-11-27T10:16:53Z" },
    noCourier: false,
  };
  it("the plain server crash passes every check", () => {
    const d = diagnoseStuckFulfil(base);
    expect(d.checks.filter(c => !c.ok)).toEqual([]);
    expect(d.canFix).toBe(true);
    expect(d.checks.find(c => c.key === "restart")!.detail).toBe("Complete pressed at 10:19; the server started again at 10:19.");
  });
  it("a press that never reached the server counts with a restart after it", () => {
    const d = diagnoseStuckFulfil({ ...base, attempts: [], localAt: Date.parse("2026-11-27T10:19:45Z"), serverStarts: ["2026-11-27T10:19:46Z"] });
    expect(d.canFix).toBe(true);
  });
  it("no restart → escalate", () => {
    expect(diagnoseStuckFulfil({ ...base, serverStarts: ["2026-11-27T08:00:00Z"] }).canFix).toBe(false);
  });
  it("a gate refusal or a Shopify error → escalate", () => {
    const refused = diagnoseStuckFulfil({ ...base, attempts: [...base.attempts, { outcome: "refused", startedAt: "2026-11-27T10:21:00Z", error: "No barcode", consignmentNumber: null }] });
    expect(refused.canFix).toBe(false);
    expect(refused.checks.find(c => c.key === "clean")!.detail).toBe("Refused: No barcode");
  });
  it("re-booked, label never printed, or already fulfilled → escalate", () => {
    expect(diagnoseStuckFulfil({ ...base, booking: { waybill: "2026112703036990099999", labelPrintedAt: "2026-11-27T10:16:53Z" } }).canFix).toBe(false);
    expect(diagnoseStuckFulfil({ ...base, booking: { ...base.booking!, labelPrintedAt: null } }).canFix).toBe(false);
    expect(diagnoseStuckFulfil({ ...base, booking: null }).canFix).toBe(false);
    expect(diagnoseStuckFulfil({ ...base, shopifyOpen: false }).canFix).toBe(false);
    expect(diagnoseStuckFulfil({ ...base, shopifyOpen: null }).canFix).toBe(false);
  });
  it("local delivery needs no label", () => {
    expect(diagnoseStuckFulfil({ ...base, booking: null, noCourier: true }).canFix).toBe(true);
  });
});
