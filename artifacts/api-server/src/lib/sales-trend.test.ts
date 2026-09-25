import { describe, expect, it } from "vitest";
import {
  buildTrendSeries,
  dayCountBetween,
  granularityOptions,
  mondayOf,
  resolveGranularity,
  roasPercentFor,
  type BuildTrendInput,
} from "./sales-trend";
import { getNetRevenue, isCountableOrder, orderHasTag } from "./order-revenue";

let nextId = 1;
function order(createdAt: string, total: string, tags = "", over: Record<string, unknown> = {}) {
  return {
    id: nextId++,
    created_at: createdAt,
    cancelled_at: null,
    financial_status: "paid",
    total_price: total,
    refunds: [],
    tags,
    ...over,
  } as BuildTrendInput["orders"][number];
}

const LATER = new Date("2027-01-01T00:00:00Z");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("granularityOptions", () => {
  it("draws one day by the hour", () => {
    expect(granularityOptions(1)).toEqual({ granularity: "hour", allowed: ["hour"] });
  });
  it("draws a week by the day, no toggle", () => {
    expect(granularityOptions(7)).toEqual({ granularity: "day", allowed: ["day"] });
  });
  it("offers weekly from a fortnight up to 60 days, opening daily", () => {
    expect(granularityOptions(14)).toEqual({ granularity: "day", allowed: ["day", "week"] });
    expect(granularityOptions(60)).toEqual({ granularity: "day", allowed: ["day", "week"] });
  });
  it("opens weekly beyond 60 days, daily still allowed for a year", () => {
    expect(granularityOptions(61)).toEqual({ granularity: "week", allowed: ["day", "week"] });
    expect(granularityOptions(366).allowed).toContain("day");
    expect(granularityOptions(500)).toEqual({ granularity: "week", allowed: ["week"] });
  });
  it("ignores a requested grain that doesn't suit the period", () => {
    expect(resolveGranularity(1, "week")).toBe("hour");
    expect(resolveGranularity(30, "week")).toBe("week");
    expect(resolveGranularity(30, null)).toBe("day");
  });
});

describe("date helpers", () => {
  it("counts days inclusively", () => {
    expect(dayCountBetween("2026-09-24", "2026-09-24")).toBe(1);
    expect(dayCountBetween("2026-09-01", "2026-09-30")).toBe(30);
    expect(dayCountBetween("2026-09-02", "2026-09-01")).toBe(0);
  });
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-09-24")).toBe("2026-09-21"); // Thu
    expect(mondayOf("2026-09-21")).toBe("2026-09-21"); // Mon
    expect(mondayOf("2026-09-27")).toBe("2026-09-21"); // Sun
  });
});

describe("hourly buckets (a single London day)", () => {
  it("has 24 London hours on an ordinary summer day, starting at London midnight", () => {
    const s = buildTrendSeries({ from: "2026-09-24", to: "2026-09-24", orders: [], spend: [], now: LATER });
    expect(s.granularity).toBe("hour");
    expect(s.buckets).toHaveLength(24);
    expect(s.buckets[0].start).toBe("2026-09-23T23:00:00.000Z");
    expect(s.buckets[0].label).toBe("00:00");
    expect(s.buckets[23].label).toBe("23:00");
    expect(s.buckets.map(b => b.hourOfDay)).toEqual([...Array(24).keys()]);
  });

  it("puts an order at 00:30 BST on that day's first hour, not the day before", () => {
    const s = buildTrendSeries({
      from: "2026-09-24", to: "2026-09-24", spend: [], now: LATER,
      orders: [order("2026-09-24T00:30:00+01:00", "30.00"), order("2026-09-24T14:59:59+01:00", "20.00")],
    });
    expect(s.buckets[0].revenue).toBe(30);
    expect(s.buckets[14].revenue).toBe(20);
    expect(s.outsideOrders).toBe(0);
  });

  it("has 23 hours when the clocks go forward and 25 when they go back", () => {
    const spring = buildTrendSeries({ from: "2026-03-29", to: "2026-03-29", orders: [], spend: [], now: LATER });
    expect(spring.buckets).toHaveLength(23);
    expect(spring.buckets.map(b => b.label)).not.toContain("01:00");

    const autumn = buildTrendSeries({ from: "2026-10-25", to: "2026-10-25", orders: [], spend: [], now: LATER });
    expect(autumn.buckets).toHaveLength(25);
    const ones = autumn.buckets.filter(b => b.label === "01:00");
    expect(ones).toHaveLength(2);
    expect(ones[0].longLabel).toMatch(/BST/);
    expect(ones[1].longLabel).toMatch(/GMT/);
  });

  it("marks the running hour partial and later hours future", () => {
    const s = buildTrendSeries({
      from: "2026-09-25", to: "2026-09-25", orders: [], spend: [],
      now: new Date("2026-09-25T13:20:00+01:00"),
    });
    expect(s.buckets[12].future).toBe(false);
    expect(s.buckets[13].partial).toBe(true);
    expect(s.buckets[13].future).toBe(false);
    expect(s.buckets[14].future).toBe(true);
  });

  it("counts an order outside the day rather than dropping it silently", () => {
    const s = buildTrendSeries({
      from: "2026-09-24", to: "2026-09-24", spend: [], now: LATER,
      orders: [order("2026-09-25T00:10:00+01:00", "10.00")],
    });
    expect(s.outsideOrders).toBe(1);
    expect(s.totals.orders).toBe(0);
  });
});

describe("daily and weekly buckets", () => {
  it("one bucket per London day, labelled", () => {
    const s = buildTrendSeries({ from: "2026-09-18", to: "2026-09-24", orders: [], spend: [], now: LATER });
    expect(s.granularity).toBe("day");
    expect(s.buckets.map(b => b.key)).toEqual([
      "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
    ]);
    expect(s.buckets[6].label).toBe("24 Sep");
    expect(s.buckets[6].longLabel).toBe("Thursday 24 September");
  });

  it("weeks start on Monday and short end weeks say so", () => {
    const s = buildTrendSeries({ from: "2026-09-03", to: "2026-09-24", granularity: "week", orders: [], spend: [], now: LATER });
    expect(s.granularity).toBe("week");
    expect(s.buckets.map(b => b.key)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(s.buckets.map(b => b.dayCount)).toEqual([4, 7, 7, 4]);
    expect(s.buckets[0].partial).toBe(true);
    expect(s.buckets[0].longLabel).toMatch(/4 of 7 days/);
    expect(s.buckets[1].partial).toBe(false);
  });
});

describe("reconciliation with the tiles", () => {
  // A realistic muddle: refunds, cancellations, doubly-tagged subscriptions,
  // awkward pennies, and orders either side of midnight.
  const orders = [
    order("2026-09-24T00:05:00+01:00", "35.99", "new-customer"),
    order("2026-09-24T04:02:11+01:00", "42.10", "Subscription Recurring Order"),
    order("2026-09-24T04:02:40+01:00", "42.10", "Subscription Recurring Order, Subscription New Order"),
    order("2026-09-24T10:15:00+01:00", "19.99", "new-customer, Subscription New Order"),
    order("2026-09-24T10:47:00+01:00", "200.00", "wholesale"),
    order("2026-09-24T12:00:00+01:00", "55.55", "", {
      financial_status: "partially_refunded",
      refunds: [{ id: 1, created_at: "2026-09-24T13:00:00+01:00", transactions: [{ amount: "5.56", kind: "refund", status: "success" }] }],
    }),
    order("2026-09-24T18:30:00+01:00", "33.33", "", { cancelled_at: "2026-09-24T19:00:00+01:00" }),
    order("2026-09-24T21:00:00+01:00", "12.34", "", { financial_status: "refunded" }),
    order("2026-09-24T23:59:59+01:00", "0.01", "new-customer"),
  ];

  // What the tiles compute, independently, from the same orders.
  const countable = orders.filter(isCountableOrder);
  const tileRevenue = Math.round(sum(countable.map(getNetRevenue)) * 100) / 100;
  const tileOrders = countable.length;
  const tileNewCustomerRevenue = sum(countable.filter(o => orderHasTag(o, "new-customer")).map(getNetRevenue));
  const tileSubRevenue = sum(countable
    .filter(o => orderHasTag(o, "Subscription Recurring Order") || orderHasTag(o, "Subscription New Order"))
    .map(getNetRevenue));

  const hourly = buildTrendSeries({ from: "2026-09-24", to: "2026-09-24", orders, spend: [], now: LATER });

  it("hourly revenue buckets sum to the Total Sales tile to the penny", () => {
    expect(sum(hourly.buckets.map(b => b.revenue))).toBeCloseTo(tileRevenue, 10);
    expect(hourly.totals.revenue).toBeCloseTo(tileRevenue, 10);
    expect(sum(hourly.buckets.map(b => b.orders))).toBe(tileOrders);
  });

  it("new-customer and subscription revenue buckets sum to their tiles", () => {
    expect(sum(hourly.buckets.map(b => b.newCustomerRevenue))).toBeCloseTo(tileNewCustomerRevenue, 10);
    expect(sum(hourly.buckets.map(b => b.subscriptionRevenue))).toBeCloseTo(tileSubRevenue, 10);
    // The doubly-tagged subscription order is counted once in the combined figure…
    expect(hourly.totals.subscriptionOrders).toBe(3);
    // …but once in EACH of the per-type counts, like the per-tag tiles.
    expect(hourly.totals.recurringSubOrders).toBe(2);
    expect(hourly.totals.newSubOrders).toBe(2);
    expect(hourly.totals.newCustomerOrders).toBe(3);
  });

  it("AOV is weighted: period AOV = total revenue ÷ total orders, not the mean of hourly AOVs", () => {
    expect(hourly.totals.aov).toBeCloseTo(tileRevenue / tileOrders, 10);
    const withOrders = hourly.buckets.filter(b => b.orders > 0);
    const meanOfBucketAovs = sum(withOrders.map(b => b.aov ?? 0)) / withOrders.length;
    expect(Math.abs(meanOfBucketAovs - (hourly.totals.aov ?? 0))).toBeGreaterThan(1);
    // and each bucket's AOV is its own revenue ÷ its own orders
    for (const b of withOrders) expect(b.aov).toBeCloseTo(b.revenue / b.orders, 10);
  });

  it("an hour with no orders has no AOV (a gap, not £0)", () => {
    expect(hourly.buckets[2].orders).toBe(0);
    expect(hourly.buckets[2].aov).toBeNull();
  });

  it("daily and weekly buckets also sum to the same totals", () => {
    const more = [...orders, order("2026-09-20T09:00:00+01:00", "48.00"), order("2026-09-08T09:00:00+01:00", "27.27")];
    const countableMore = more.filter(isCountableOrder);
    const expected = Math.round(sum(countableMore.map(getNetRevenue)) * 100) / 100;
    for (const granularity of ["day", "week"] as const) {
      const s = buildTrendSeries({ from: "2026-09-01", to: "2026-09-24", granularity, orders: more, spend: [], now: LATER });
      expect(s.granularity).toBe(granularity);
      expect(sum(s.buckets.map(b => b.revenue))).toBeCloseTo(expected, 10);
      expect(s.totals.revenue).toBeCloseTo(expected, 10);
      expect(sum(s.buckets.map(b => b.orders))).toBe(countableMore.length);
      expect(s.outsideOrders).toBe(0);
    }
  });
});

describe("ad spend and ROAS", () => {
  const orders = [
    order("2026-09-22T10:00:00+01:00", "100.00", "new-customer"),
    order("2026-09-23T10:00:00+01:00", "60.00", "new-customer"),
    order("2026-09-24T10:00:00+01:00", "90.00", "new-customer"),
  ];

  it("per-day ROAS and a period ROAS of total revenue ÷ total spend", () => {
    const s = buildTrendSeries({
      from: "2026-09-22", to: "2026-09-24", orders, now: LATER,
      spend: [{ date: "2026-09-22", amount: 50 }, { date: "2026-09-23", amount: 30 }, { date: "2026-09-24", amount: 20 }],
    });
    expect(s.buckets.map(b => b.roasPercent)).toEqual([200, 200, 450]);
    expect(s.totals.adSpend).toBe(100);
    expect(s.totals.roasPercent).toBe(250); // 250 ÷ 100, not the mean (283)
  });

  it("a day with no spend figure has no ROAS, and the period has none either", () => {
    const s = buildTrendSeries({
      from: "2026-09-22", to: "2026-09-24", orders, now: LATER,
      spend: [{ date: "2026-09-22", amount: 50 }, { date: "2026-09-24", amount: null }],
    });
    expect(s.buckets.map(b => b.roasPercent)).toEqual([200, null, null]);
    expect(s.buckets[1].adSpend).toBeNull();
    // Spend total is the days we have — the Ad Spend tile shows the same.
    expect(s.totals.adSpend).toBe(50);
    expect(s.totals.spendDaysRecorded).toBe(1);
    expect(s.totals.roasPercent).toBeNull();
  });

  it("a recorded £0 is still nothing to divide by", () => {
    expect(roasPercentFor(100, 1, 1, 0)).toBeNull();
  });

  it("hour buckets carry no spend (it's recorded per day) but the period total does", () => {
    const s = buildTrendSeries({
      from: "2026-09-24", to: "2026-09-24", orders, now: LATER, spend: [{ date: "2026-09-24", amount: 20 }],
    });
    expect(s.buckets.every(b => b.adSpend === null && b.roasPercent === null)).toBe(true);
    expect(s.totals.adSpend).toBe(20);
    expect(s.totals.roasPercent).toBe(450);
  });
});
