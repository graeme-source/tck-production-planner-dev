import { describe, it, expect } from "vitest";
import {
  cachedLiveStatus, needsTrackingRecheck, trackingFallbackNotice,
  recordTrackingOutcome, isTrackingSlow, INITIAL_TRACKING_HEALTH,
  TRACKING_CACHE_FRESH_MS, SLOW_BANNER_WINDOW_MS, SLOW_BANNER_TEXT,
  type CachedTrackingRow, type TrackingHealth,
} from "./apc-tracking-cache";
import { applyLiveStatus, type ReuseDecision } from "./apc-consignment-reuse";

// Issue #339: opening an order must use the background-cached APC answer
// instead of waiting on APC, and a slow APC is a quiet grey line, not an
// amber "APC Warnings" box on every order.

const NOW = new Date("2026-10-22T09:00:00Z").getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);
const row = (over: Partial<CachedTrackingRow> = {}): CachedTrackingRow => ({
  apc_status: null, apc_status_code: null, apc_dead_status: null, apc_status_checked_at: null, ...over,
});
const reuse: ReuseDecision = { action: "reuse", waybill: "2026102203036990020862", collectionDate: "2026-10-22" };
const CTX = { today: "2026-10-22", orderDateTag: "2026-10-23" };

describe("cachedLiveStatus — the cached-status path (#339)", () => {
  it("a recent 'alive' answer reuses the consignment with no warning and no notice", () => {
    const s = cachedLiveStatus(row({ apc_status: "ORDER CREATED", apc_status_code: "92", apc_status_checked_at: minsAgo(5) }), NOW);
    expect(s?.kind).toBe("ok");
    const d = applyLiveStatus(reuse, s!, CTX);
    expect(d).toEqual(reuse);
  });

  it("a recent 'dead' answer still books a new one (the safety check keeps working)", () => {
    const s = cachedLiveStatus(row({ apc_dead_status: "CANCELLED (22/10/2026 07:30:00)", apc_status_checked_at: minsAgo(5) }), NOW);
    const d = applyLiveStatus(reuse, s!, CTX);
    expect(d.action).toBe("book-new");
    expect(d.action === "book-new" && d.retire).toBe("cancel");
    expect(d.action === "book-new" && d.message).toContain("CANCELLED");
  });

  it("checked recently with no tracking yet → treated as 'no tracking yet' (reused, quietly)", () => {
    const s = cachedLiveStatus(row({ apc_status_checked_at: minsAgo(2) }), NOW);
    expect(s).toEqual({ kind: "not-found" });
    expect(applyLiveStatus(reuse, s!, CTX)).toEqual(reuse);
  });

  it("an old answer, a never-checked row, or no row → null (ask APC live)", () => {
    expect(cachedLiveStatus(row({ apc_status: "AT HUB", apc_status_checked_at: new Date(NOW - TRACKING_CACHE_FRESH_MS - 1) }), NOW)).toBeNull();
    expect(cachedLiveStatus(row(), NOW)).toBeNull();
    expect(cachedLiveStatus(null, NOW)).toBeNull();
  });
});

describe("needsTrackingRecheck — the background re-read", () => {
  it("reads never-checked and stale rows, skips fresh and dead ones", () => {
    expect(needsTrackingRecheck(row(), NOW)).toBe(true);
    expect(needsTrackingRecheck(row({ apc_status: "X", apc_status_checked_at: minsAgo(15) }), NOW)).toBe(true);
    expect(needsTrackingRecheck(row({ apc_status: "X", apc_status_checked_at: minsAgo(3) }), NOW)).toBe(false);
    expect(needsTrackingRecheck(row({ apc_dead_status: "CANCELLED", apc_status_checked_at: minsAgo(300) }), NOW)).toBe(false);
  });
});

describe("warning wording (#339)", () => {
  it("a timeout is one small grey line, not the old amber sentence", () => {
    expect(trackingFallbackNotice("no answer in 4s")).toBe("APC tracking slow — checked by date only");
    expect(trackingFallbackNotice("no answer in 4s")).not.toContain("Couldn't check");
  });
  it("other failures say unavailable", () => {
    expect(trackingFallbackNotice("HTTP 503")).toBe("APC tracking unavailable — checked by date only");
  });
});

describe("the 'APC is slow today' banner", () => {
  const fold = (kinds: Array<"ok" | "not-found" | "unreachable">, at = NOW): TrackingHealth =>
    kinds.reduce((h, k) => recordTrackingOutcome(h, k, at), INITIAL_TRACKING_HEALTH);

  it("shows after 3 slow checks in a row", () => {
    expect(isTrackingSlow(fold(["unreachable", "unreachable"]), NOW)).toBe(false);
    expect(isTrackingSlow(fold(["unreachable", "unreachable", "unreachable"]), NOW)).toBe(true);
    expect(SLOW_BANNER_TEXT).toBe("APC tracking is slow today — bookings checked by date only");
  });
  it("any answer from APC ends the streak", () => {
    expect(isTrackingSlow(fold(["unreachable", "unreachable", "unreachable", "not-found"]), NOW)).toBe(false);
    expect(isTrackingSlow(fold(["unreachable", "unreachable", "ok", "unreachable"]), NOW)).toBe(false);
  });
  it("clears on its own once nothing has been slow for a while", () => {
    const h = fold(["unreachable", "unreachable", "unreachable"]);
    expect(isTrackingSlow(h, NOW + SLOW_BANNER_WINDOW_MS + 1)).toBe(false);
  });
});
