import { describe, it, expect } from "vitest";
import { isSettledOrder, settledOrders, ORDER_SETTLE_MINUTES } from "./order-age";

const NOW = new Date("2026-08-21T14:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("isSettledOrder", () => {
  it("hides an order younger than 15 minutes — AfterSell may still hold or amend it", () => {
    expect(isSettledOrder(minutesAgo(0), NOW)).toBe(false);
    expect(isSettledOrder(minutesAgo(5), NOW)).toBe(false);
    expect(isSettledOrder(minutesAgo(14.9), NOW)).toBe(false);
  });

  it("shows an order at or past 15 minutes", () => {
    expect(isSettledOrder(minutesAgo(15), NOW)).toBe(true);
    expect(isSettledOrder(minutesAgo(16), NOW)).toBe(true);
    expect(isSettledOrder(minutesAgo(60 * 24), NOW)).toBe(true);
  });

  it("handles Shopify's timezone-offset timestamps", () => {
    // Shopify sends BST offsets: "T14:50:00+01:00" is 13:50Z — 10 minutes
    // before a NOW of 14:00Z, so still inside the hold window.
    expect(isSettledOrder("2026-08-21T14:50:00+01:00", NOW)).toBe(false);
    // "T14:40:00+01:00" is 13:40Z — 20 minutes ago, settled.
    expect(isSettledOrder("2026-08-21T14:40:00+01:00", NOW)).toBe(true);
  });

  it("treats missing or unparseable dates as settled — never hide forever on bad data", () => {
    expect(isSettledOrder(null, NOW)).toBe(true);
    expect(isSettledOrder(undefined, NOW)).toBe(true);
    expect(isSettledOrder("not a date", NOW)).toBe(true);
  });

  it("matches the constant the docs promise", () => {
    expect(ORDER_SETTLE_MINUTES).toBe(15);
  });
});

describe("settledOrders", () => {
  it("filters only the young ones", () => {
    const orders = [
      { id: 1, created_at: minutesAgo(120) },
      { id: 2, created_at: minutesAgo(3) },
      { id: 3, created_at: minutesAgo(30) },
    ];
    expect(settledOrders(orders, NOW).map(o => o.id)).toEqual([1, 3]);
  });
});
