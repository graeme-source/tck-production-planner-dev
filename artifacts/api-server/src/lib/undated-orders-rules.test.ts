import { describe, expect, it } from "vitest";
import { deliveryDayOptions, suggestedDeliveryDate, tagsWithDeliveryDate, undatedOrders, withDismissed } from "./undated-orders-rules";

const now = new Date("2026-11-23T14:30:00Z");
const line = (title = "Chicken & Chorizo", variant = "2 Pack") => ({ title, variant_title: variant, quantity: 1 });
const order = (id: number, tags: string, at = "2026-11-23T11:52:00Z", extra: Record<string, unknown> = {}) => ({
  id, name: `#${id}`, tags, created_at: at, note: null,
  customer: { first_name: "Dennis", last_name: "Hunter" }, note_attributes: [], line_items: [line()], ...extra,
});
const none = new Set<number>();

describe("undatedOrders", () => {
  it("lists an order with no delivery date and no waiting tag", () => {
    expect(undatedOrders([order(1, "Small Box")], now, none)).toEqual([{
      id: 1, name: "#1", customer: "Dennis Hunter", placedAt: "2026-11-23T11:52:00Z", bookedDate: null, note: null,
      items: [{ title: "Chicken & Chorizo", variant: "2 Pack", quantity: 1 }],
    }]);
  });

  it("leaves an order alone until it is ten minutes old", () => {
    expect(undatedOrders([order(1, "Small Box", "2026-11-23T14:21:00Z")], now, none)).toEqual([]);
    expect(undatedOrders([order(1, "Small Box", "2026-11-23T14:20:00Z")], now, none)).toHaveLength(1);
  });

  it("leaves orders that have a date tag, whatever the date", () => {
    expect(undatedOrders([order(1, "2026-11-25, Small Box"), order(2, "Small Box, 2026-10-01")], now, none)).toEqual([]);
  });

  it("leaves orders held as waiting (subscription renewals created early)", () => {
    expect(undatedOrders([order(1, "Small Box, Subscription Recurring Order, Waiting")], now, none)).toEqual([]);
  });

  it("leaves orders a manager marked as fine", () => {
    expect(undatedOrders([order(1, "Small Box"), order(2, "Small Box")], now, new Set([1])).map(o => o.id)).toEqual([2]);
  });

  it("leaves wholesale and 8-pack orders to the wholesale list (#140315)", () => {
    const wholesale = order(140315, "B2B, Large Box, Login with Shop, Shop, wg_wholesale, wholesale, wholesale-g");
    const eightPack = order(2, "Large Box", "2026-11-23T09:00:00Z", { line_items: [line("The Donald 3.0", "8 Pack Bag")] });
    expect(undatedOrders([wholesale, eightPack], now, none)).toEqual([]);
  });

  it("leaves orders with nothing to send", () => {
    expect(undatedOrders([order(1, "", "2026-11-23T09:00:00Z", { line_items: [] })], now, none)).toEqual([]);
  });

  it("carries the day the customer booked at checkout, and puts the oldest first", () => {
    const booked = order(2, "Small Box", "2026-11-22T20:00:00Z", { note_attributes: [{ name: "Delivery-Date", value: "2026/11/26" }] });
    const result = undatedOrders([order(1, "Small Box"), booked], now, none);
    expect(result.map(o => o.id)).toEqual([2, 1]);
    expect(result[0].bookedDate).toBe("2026-11-26");
  });
});

describe("deliveryDayOptions", () => {
  it("offers Tuesday to Saturday only, starting from the earliest day", () => {
    // Tue 24 Nov 2026 onwards: no Sunday 29th or Monday 30th.
    expect(deliveryDayOptions("2026-11-24", 7)).toEqual([
      "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-12-01", "2026-12-02",
    ]);
  });
});

describe("suggestedDeliveryDate", () => {
  const options = ["2026-11-25", "2026-11-26", "2026-11-27"];
  it("offers the day the customer booked when it can still be delivered", () => {
    expect(suggestedDeliveryDate("2026-11-26", "2026-11-27", options)).toBe("2026-11-26");
  });
  it("falls back to a date in the note, then to the earliest day", () => {
    expect(suggestedDeliveryDate("2026-11-24", "2026-11-27", options)).toBe("2026-11-27");
    expect(suggestedDeliveryDate(null, null, options)).toBe("2026-11-25");
    expect(suggestedDeliveryDate(null, null, [])).toBeNull();
  });
});

describe("tagsWithDeliveryDate", () => {
  it("adds the date tag and keeps every other tag", () => {
    expect(tagsWithDeliveryDate("Small Box, Shop", "2026-11-25")).toBe("Small Box, Shop, 2026-11-25");
    expect(tagsWithDeliveryDate("", "2026-11-25")).toBe("2026-11-25");
  });
  it("refuses when the order already has a date", () => {
    expect(tagsWithDeliveryDate("Small Box, 2026-11-26", "2026-11-25")).toBeNull();
  });
});

describe("withDismissed", () => {
  it("adds the order and forgets ones marked as fine over 60 days ago", () => {
    const old = { id: 1, name: "#1", by: "Kerri", at: "2026-09-01T10:00:00Z" };
    const recent = { id: 2, name: "#2", by: "Kerri", at: "2026-11-20T10:00:00Z" };
    const added = { id: 3, name: "#3", by: "Graeme", at: now.toISOString() };
    expect(withDismissed([old, recent], added, now)).toEqual([recent, added]);
  });
  it("keeps one entry per order", () => {
    const first = { id: 3, name: "#3", by: "Kerri", at: "2026-11-22T10:00:00Z" };
    const again = { id: 3, name: "#3", by: "Graeme", at: now.toISOString() };
    expect(withDismissed([first], again, now)).toEqual([again]);
  });
});
