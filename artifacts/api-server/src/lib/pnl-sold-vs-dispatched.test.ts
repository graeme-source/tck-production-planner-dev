import { describe, it, expect } from "vitest";
import {
  defaultMonths,
  dispatchDayForDelivery,
  dispatchDayOf,
  monthPeriods,
  orderValue,
  ordersWindow,
  rangePeriod,
  soldVsDispatched,
  type SvdOrder,
} from "./pnl-sold-vs-dispatched";

const order = (createdAt: string, tags: string | null, totalPrice = "50.00", cancelledAt: string | null = null): SvdOrder =>
  ({ createdAt, tags, totalPrice, cancelledAt });

describe("dispatch day", () => {
  it("is the day before delivery", () => {
    expect(dispatchDayForDelivery("2026-11-06")).toBe("2026-11-05"); // Fri → Thu
  });

  it("is the Friday before for a Monday delivery", () => {
    expect(dispatchDayForDelivery("2026-11-09")).toBe("2026-11-06"); // Mon → Fri
  });

  it("reads the YYYY-MM-DD tag among others", () => {
    expect(dispatchDayOf("dispatch, 2026-11-06, Subscription")).toBe("2026-11-05");
    expect(dispatchDayOf("dispatch, Subscription")).toBeNull();
    expect(dispatchDayOf(null)).toBeNull();
  });
});

describe("periods", () => {
  it("defaults to the last 3 complete months plus this month", () => {
    expect(defaultMonths("2026-11-18")).toEqual({ fromMonth: "2026-08", toMonth: "2026-11" });
    expect(defaultMonths("2026-02-03")).toEqual({ fromMonth: "2025-11", toMonth: "2026-02" });
  });

  it("builds whole months across a year end, marking the running one", () => {
    const p = monthPeriods("2025-12", "2026-02", "2026-02-10");
    expect(p.map(x => [x.key, x.from, x.to, x.label, x.partial])).toEqual([
      ["2025-12", "2025-12-01", "2025-12-31", "Dec 2025", false],
      ["2026-01", "2026-01-01", "2026-01-31", "Jan 2026", false],
      ["2026-02", "2026-02-01", "2026-02-28", "Feb 2026", true],
    ]);
  });

  it("reads orders from six weeks before the first period", () => {
    expect(ordersWindow(monthPeriods("2026-08", "2026-10", "2026-11-18"))).toEqual({ from: "2026-06-20", to: "2026-10-31" });
  });
});

describe("soldVsDispatched", () => {
  const oct = monthPeriods("2026-10", "2026-11", "2026-11-18");

  it("a delivery on the 1st was dispatched the previous month", () => {
    // Sold 28 Oct, delivered Sun 1 Nov → dispatched Sat 31 Oct.
    const r = soldVsDispatched([order("2026-10-28T10:00:00Z", "2026-11-01")], oct);
    expect(r.rows[0]).toMatchObject({ key: "2026-10", sold: 1, dispatched: 1, difference: 0 });
    expect(r.rows[1]).toMatchObject({ key: "2026-11", sold: 0, dispatched: 0 });
  });

  it("a Monday 2nd delivery was dispatched on the Friday of the month before", () => {
    // Mon 2 Nov 2026 → Fri 30 Oct.
    const r = soldVsDispatched([order("2026-11-01T09:00:00Z", "2026-11-02", "40.00")], oct);
    expect(r.rows[0]).toMatchObject({ sold: 0, dispatched: 1, difference: -1, dispatchedValue: 40, valueDifference: -40 });
    expect(r.rows[1]).toMatchObject({ sold: 1, dispatched: 0, difference: 1, soldValue: 40, valueDifference: 40 });
  });

  it("leaves cancelled orders out of both sides", () => {
    const r = soldVsDispatched([order("2026-10-10T10:00:00Z", "2026-10-15", "60.00", "2026-10-11T08:00:00Z")], oct);
    expect(r.totals).toMatchObject({ sold: 0, dispatched: 0, soldValue: 0, dispatchedValue: 0, noDeliveryDate: 0 });
  });

  it("counts an order with no date tag as sold and as 'no delivery date', never dispatched", () => {
    const r = soldVsDispatched([order("2026-10-10T10:00:00Z", "dispatch, wholesale", "25.50")], oct);
    expect(r.rows[0]).toMatchObject({ sold: 1, soldValue: 25.5, dispatched: 0, noDeliveryDate: 1 });
  });

  it("places the sold day in London time (00:30 BST on the 1st is that month)", () => {
    // 23:30 UTC on 30 Sep = 00:30 BST on 1 Oct.
    const r = soldVsDispatched([order("2026-09-30T23:30:00Z", "2026-10-06")], oct);
    expect(r.rows[0]).toMatchObject({ sold: 1, dispatched: 1 });
  });

  it("counts an order placed weeks ahead in its dispatch month only", () => {
    const r = soldVsDispatched([order("2026-09-15T10:00:00Z", "2026-10-20")], oct);
    expect(r.rows[0]).toMatchObject({ sold: 0, dispatched: 1 });
  });

  it("totals the rows and adds up the £", () => {
    const r = soldVsDispatched([
      order("2026-10-05T10:00:00Z", "2026-10-07", "10.10"),
      order("2026-10-30T10:00:00Z", "2026-11-04", "20.20"),
      order("2026-11-03T10:00:00Z", "2026-11-05", "30.30"),
    ], oct);
    expect(r.totals).toMatchObject({ sold: 3, dispatched: 3, difference: 0, soldValue: 60.6, dispatchedValue: 60.6, valueDifference: 0 });
  });

  it("doesn't count a pre-order as dispatched before its dispatch day comes", () => {
    const orders = [order("2026-11-02T10:00:00Z", "2026-11-25"), order("2026-11-02T10:00:00Z", "2026-11-10")];
    const r = soldVsDispatched(orders, oct, undefined, "2026-11-18");
    expect(r.rows[1]).toMatchObject({ sold: 2, dispatched: 1 });
  });

  it("shows APC only for periods starting on or after the first APC scan", () => {
    const p = monthPeriods("2026-07", "2026-08", "2026-11-18");
    const r = soldVsDispatched([], p, { scannedByPeriod: new Map([["2026-08", 1838]]), apcFrom: "2026-07-30" });
    expect(r.rows.map(x => x.apcScanned)).toEqual([null, 1838]);
    expect(r.totals.apcScanned).toBeNull();
  });

  it("groups a custom range into one row", () => {
    const p = [rangePeriod("2026-10-03", "2026-11-18", "2026-11-18")];
    expect(p[0]!.label).toBe("3 Oct – 18 Nov 2026");
    const r = soldVsDispatched([order("2026-10-05T10:00:00Z", "2026-11-10")], p);
    expect(r.rows[0]).toMatchObject({ sold: 1, dispatched: 1 });
  });
});

describe("orderValue", () => {
  it("is total_price, 0 when missing or junk", () => {
    expect(orderValue({ totalPrice: "54.95" })).toBe(54.95);
    expect(orderValue({ totalPrice: null })).toBe(0);
    expect(orderValue({ totalPrice: "abc" })).toBe(0);
  });
});
