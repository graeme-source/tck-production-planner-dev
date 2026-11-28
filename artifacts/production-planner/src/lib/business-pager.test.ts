import { describe, it, expect } from "vitest";
import {
  businessNavTabs, intoBusinessFollow, pagerFollow, pagerNeighbours, pagerSnap, rubberBand, settleDurationMs,
  ORDERS_TAB, SETTLE_MAX_MS, SETTLE_MIN_MS,
} from "./business-pager";

const TABS = [
  { href: "/founder/numbers", label: "Numbers" },
  { href: "/founder/ads", label: "Ads" },
  { href: "/founder/pnl", label: "P&L" },
];

describe("businessNavTabs", () => {
  it("puts Orders first on a touch screen for anyone who can open Numbers", () => {
    expect(businessNavTabs({ tabs: TABS, canNumbers: true, touchPrimary: true }).map(t => t.href))
      .toEqual([ORDERS_TAB.href, "/founder/numbers", "/founder/ads", "/founder/pnl"]);
  });
  it("leaves the strip exactly as it was with a mouse", () => {
    expect(businessNavTabs({ tabs: TABS, canNumbers: true, touchPrimary: false })).toEqual(TABS);
  });
  it("no Orders for someone who can't open Numbers", () => {
    const sales = [{ href: "/founder/sales", label: "Marketing Calendar" }];
    expect(businessNavTabs({ tabs: sales, canNumbers: false, touchPrimary: true })).toEqual(sales);
  });
});

describe("pagerNeighbours", () => {
  const row = ["/founder/orders", "/founder/numbers", "/founder/ads"];
  it("Numbers has Orders on its left and Ads on its right", () => {
    expect(pagerNeighbours(row, "/founder/numbers")).toEqual({ index: 1, prev: "/founder/orders", next: "/founder/ads" });
  });
  it("nothing past the ends", () => {
    expect(pagerNeighbours(row, "/founder/orders")?.prev).toBeNull();
    expect(pagerNeighbours(row, "/founder/ads")?.next).toBeNull();
  });
  it("not a page of the row, or only one page: no paging", () => {
    expect(pagerNeighbours(row, "/founder/focus")).toBeNull();
    expect(pagerNeighbours(["/founder/numbers"], "/founder/numbers")).toBeNull();
  });
});

describe("pagerFollow", () => {
  const both = { width: 400, hasPrev: true, hasNext: true };
  it("follows the finger one for one while there's a page that way", () => {
    expect(pagerFollow(120, both)).toBe(120);
    expect(pagerFollow(-250, both)).toBe(-250);
  });
  it("never more than a page", () => {
    expect(pagerFollow(900, both)).toBe(400);
  });
  it("resists past the end, and gives less the further you pull", () => {
    const end = { width: 400, hasPrev: false, hasNext: true };
    const a = pagerFollow(100, end);
    const b = pagerFollow(300, end);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(100);
    expect(b - a).toBeLessThan(200 * 0.6);
    expect(pagerFollow(5000, end)).toBeLessThan(400 * 0.9);
  });
  it("rubber band keeps the sign", () => {
    expect(rubberBand(-100, 400)).toBeLessThan(0);
    expect(rubberBand(0, 400)).toBe(0);
  });
});

describe("pagerSnap", () => {
  const base = { width: 400, hasPrev: true, hasNext: true };
  it("a slow drag turns the page past 40%", () => {
    expect(pagerSnap({ ...base, dx: 170, velocityPxPerMs: 0.05 })).toBe("prev");
    expect(pagerSnap({ ...base, dx: -170, velocityPxPerMs: -0.05 })).toBe("next");
    expect(pagerSnap({ ...base, dx: 150, velocityPxPerMs: 0.05 })).toBe("stay");
  });
  it("a flick turns it early, once it has gone 10%", () => {
    expect(pagerSnap({ ...base, dx: 60, velocityPxPerMs: 0.8 })).toBe("prev");
    expect(pagerSnap({ ...base, dx: -60, velocityPxPerMs: -0.8 })).toBe("next");
    expect(pagerSnap({ ...base, dx: 30, velocityPxPerMs: 0.8 })).toBe("stay");
  });
  it("a flick back the other way cancels, however far it went", () => {
    expect(pagerSnap({ ...base, dx: 300, velocityPxPerMs: -0.6 })).toBe("stay");
  });
  it("never past the ends", () => {
    expect(pagerSnap({ ...base, hasPrev: false, dx: 380, velocityPxPerMs: 1 })).toBe("stay");
    expect(pagerSnap({ ...base, hasNext: false, dx: -380, velocityPxPerMs: -1 })).toBe("stay");
  });
});

describe("settleDurationMs", () => {
  it("picks up at the finger's speed: a faster flick settles sooner", () => {
    const slow = settleDurationMs({ fromPx: 100, toPx: 400, velocityPxPerMs: 0.4, width: 400 });
    const fast = settleDurationMs({ fromPx: 100, toPx: 400, velocityPxPerMs: 2, width: 400 });
    expect(fast).toBeLessThan(slow);
  });
  it("stays within its bounds", () => {
    expect(settleDurationMs({ fromPx: 0, toPx: 1000, velocityPxPerMs: 0.31, width: 1000 })).toBe(SETTLE_MAX_MS);
    expect(settleDurationMs({ fromPx: 390, toPx: 400, velocityPxPerMs: 5, width: 400 })).toBe(SETTLE_MIN_MS);
  });
  it("a release moving away from where it's going ignores that speed", () => {
    const d = settleDurationMs({ fromPx: 100, toPx: 0, velocityPxPerMs: 2, width: 400 });
    expect(d).toBe(Math.round(240 + 160 * 0.25));
  });
  it("nothing left to go: no slide", () => {
    expect(settleDurationMs({ fromPx: 400, toPx: 400, velocityPxPerMs: 1, width: 400 })).toBe(0);
  });
});

describe("intoBusinessFollow", () => {
  it("follows rightwards only, up to a full width", () => {
    expect(intoBusinessFollow(-30, 390)).toBe(0);
    expect(intoBusinessFollow(200, 390)).toBe(200);
    expect(intoBusinessFollow(800, 390)).toBe(390);
  });
});
