import { describe, expect, it } from "vitest";
import { addDaysToDateString } from "./london-time";
import {
  buildTrendSeries,
  calendarMonthsTouched,
  dayCountBetween,
  granularityOptions,
  mondayOf,
  resolveGranularity,
  roasPercentFor,
  type BuildTrendInput,
} from "./sales-trend";
import { getNetRevenue, isCountableOrder, isPaidOrder, orderHasTag } from "./order-revenue";

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
    expect(granularityOptions("2026-09-24", "2026-09-24")).toEqual({ granularity: "hour", allowed: ["hour"] });
  });
  it("draws a week by the day, no switch", () => {
    expect(granularityOptions("2026-09-18", "2026-09-24")).toEqual({ granularity: "day", allowed: ["day"] });
  });
  it("offers weekly from a fortnight, opening daily; a single month has no Monthly", () => {
    expect(granularityOptions("2026-09-11", "2026-09-24")).toEqual({ granularity: "day", allowed: ["day", "week"] });
    expect(granularityOptions("2026-08-01", "2026-08-31")).toEqual({ granularity: "day", allowed: ["day", "week"] });
    // Two months touched but only 22 days: two half-month stubs aren't worth a switch.
    expect(granularityOptions("2026-08-20", "2026-09-10").allowed).not.toContain("month");
  });
  it("offers Monthly from about two months, without changing the default", () => {
    expect(granularityOptions("2026-07-25", "2026-09-24")).toEqual({ granularity: "week", allowed: ["day", "week", "month"] });
    expect(granularityOptions("2026-08-01", "2026-09-24")).toEqual({ granularity: "day", allowed: ["day", "week", "month"] });
  });
  it("Last 6 and 12 months open weekly with Daily and Monthly on offer; very long ranges lose Daily", () => {
    expect(granularityOptions("2026-03-24", "2026-09-24")).toEqual({ granularity: "week", allowed: ["day", "week", "month"] });
    expect(granularityOptions("2025-09-24", "2026-09-24").allowed).toEqual(["day", "week", "month"]);
    expect(granularityOptions("2025-01-01", "2026-09-24")).toEqual({ granularity: "week", allowed: ["week", "month"] });
  });
  it("ignores a requested grain that doesn't suit the period", () => {
    expect(resolveGranularity("2026-09-24", "2026-09-24", "week")).toBe("hour");
    expect(resolveGranularity("2026-08-26", "2026-09-24", "week")).toBe("week");
    expect(resolveGranularity("2026-08-26", "2026-09-24", "month")).toBe("day");
    expect(resolveGranularity("2026-03-24", "2026-09-24", "month")).toBe("month");
    expect(resolveGranularity("2026-08-26", "2026-09-24", null)).toBe("day");
  });
  it("counts calendar months touched", () => {
    expect(calendarMonthsTouched("2026-09-20", "2026-10-03")).toBe(2);
    expect(calendarMonthsTouched("2025-12-31", "2026-01-01")).toBe(2);
    expect(calendarMonthsTouched("2026-09-01", "2026-09-30")).toBe(1);
  });
});

describe("monthly buckets", () => {
  it("one bucket per London calendar month; part months say so on the axis and in the tooltip", () => {
    const s = buildTrendSeries({ from: "2026-03-24", to: "2026-09-24", granularity: "month", orders: [], spend: [], now: LATER });
    expect(s.granularity).toBe("month");
    expect(s.buckets.map(b => b.key)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(s.buckets.map(b => b.label)).toEqual(["Mar (part)", "Apr", "May", "Jun", "Jul", "Aug", "Sep (part)"]);
    expect(s.buckets.map(b => b.dayCount)).toEqual([8, 30, 31, 30, 31, 31, 24]);
    expect(s.buckets[0].longLabel).toBe("March 2026 — 8 of 31 days in this period");
    expect(s.buckets[6].longLabel).toBe("September 2026 — 24 of 30 days in this period");
    expect(s.buckets[1].longLabel).toBe("April 2026");
    expect(s.buckets.map(b => b.partial)).toEqual([true, false, false, false, false, false, true]);
    expect(s.buckets.every(b => !b.running)).toBe(true);
  });

  it("month boundaries are London midnights, BST and GMT alike", () => {
    const s = buildTrendSeries({ from: "2026-03-01", to: "2026-11-30", granularity: "month", orders: [], spend: [], now: LATER });
    const byKey = new Map(s.buckets.map(b => [b.key, b]));
    expect(byKey.get("2026-03")?.start).toBe("2026-03-01T00:00:00.000Z"); // GMT
    expect(byKey.get("2026-04")?.start).toBe("2026-03-31T23:00:00.000Z"); // BST
    expect(byKey.get("2026-10")?.end).toBe("2026-11-01T00:00:00.000Z"); // back on GMT
  });

  it("orders either side of a BST month boundary land in the right month", () => {
    const orders = [
      order("2026-03-31T23:30:00+01:00", "10.00"), // 31 Mar, BST (22:30 UTC)
      order("2026-04-01T00:30:00+01:00", "20.00"), // 1 Apr, BST (still 31 Mar in UTC)
      order("2026-10-31T23:30:00+00:00", "40.00"), // 31 Oct, GMT
      order("2026-11-01T00:10:00+00:00", "80.00"), // 1 Nov
    ];
    const s = buildTrendSeries({ from: "2026-03-01", to: "2026-11-30", granularity: "month", orders, spend: [], now: LATER });
    const rev = new Map(s.buckets.map(b => [b.key, b.revenue]));
    expect(rev.get("2026-03")).toBe(10);
    expect(rev.get("2026-04")).toBe(20);
    expect(rev.get("2026-10")).toBe(40);
    expect(rev.get("2026-11")).toBe(80);
    expect(s.outsideOrders).toBe(0);
  });

  it("the running month is marked running and partial", () => {
    const s = buildTrendSeries({
      from: "2026-07-01", to: "2026-09-25", granularity: "month", orders: [], spend: [],
      now: new Date("2026-09-25T13:00:00+01:00"),
    });
    const sep = s.buckets[2];
    expect(sep.running).toBe(true);
    expect(sep.partial).toBe(true);
    expect(sep.label).toBe("Sep (part)");
  });

  it("puts the year on the axis when the period crosses New Year", () => {
    const s = buildTrendSeries({ from: "2025-11-01", to: "2026-02-28", granularity: "month", orders: [], spend: [], now: LATER });
    expect(s.buckets.map(b => b.label)).toEqual(["Nov '25", "Dec '25", "Jan '26", "Feb '26"]);
  });

  it("monthly sales sum to the tile; AOV and ROAS stay weighted per month", () => {
    const orders = [
      order("2026-07-10T10:00:00+01:00", "100.00", "new-customer"),
      order("2026-07-20T10:00:00+01:00", "0.00", "resend"),
      order("2026-08-05T10:00:00+01:00", "60.00", "new-customer"),
      order("2026-08-06T10:00:00+01:00", "30.00"),
      order("2026-09-02T10:00:00+01:00", "45.45", "new-customer"),
    ];
    const spend = [];
    for (let d = "2026-07-01"; d <= "2026-09-10"; d = addDaysToDateString(d, 1)) spend.push({ date: d, amount: 1 });
    const monthly = buildTrendSeries({ from: "2026-07-01", to: "2026-09-10", granularity: "month", orders, spend, now: LATER });
    const daily = buildTrendSeries({ from: "2026-07-01", to: "2026-09-10", granularity: "day", orders, spend, now: LATER });
    expect(sum(monthly.buckets.map(b => b.revenue))).toBeCloseTo(235.45, 10);
    expect(monthly.totals).toEqual(daily.totals); // same period figures whatever the grain
    expect(monthly.buckets.map(b => b.aov)).toEqual([100, 45, 45.45]); // July: £100 ÷ 1 paid (the resend isn't a basket)
    expect(monthly.buckets.map(b => b.roasPercent)).toEqual([323, 194, 455]); // 100÷31, 60÷31, 45.45÷10
    expect(monthly.totals.aov).toBeCloseTo(235.45 / 4, 10);
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
    // A £0 resend, alone in its hour — like #135073 on live.
    order("2026-09-24T06:10:00+01:00", "0.00", "dispatch, resend, Small Box", { total_discounts: "53.30" }),
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

  it("AOV is weighted: period AOV = total revenue ÷ total PAID orders, not the mean of hourly AOVs", () => {
    const tilePaidOrders = countable.filter(isPaidOrder).length;
    expect(tilePaidOrders).toBe(tileOrders - 1);
    expect(hourly.totals.paidOrders).toBe(tilePaidOrders);
    expect(hourly.totals.aov).toBeCloseTo(tileRevenue / tilePaidOrders, 10);
    const withPaid = hourly.buckets.filter(b => b.paidOrders > 0);
    const meanOfBucketAovs = sum(withPaid.map(b => b.aov ?? 0)) / withPaid.length;
    expect(Math.abs(meanOfBucketAovs - (hourly.totals.aov ?? 0))).toBeGreaterThan(1);
    // and each bucket's AOV is its own revenue ÷ its own paid orders
    for (const b of withPaid) expect(b.aov).toBeCloseTo(b.revenue / b.paidOrders, 10);
    expect(sum(hourly.buckets.map(b => b.paidOrders))).toBe(tilePaidOrders);
  });

  it("an hour whose only order is a £0 resend has an order but no AOV (regression: #135073)", () => {
    const six = hourly.buckets[6];
    expect(six.orders).toBe(1);
    expect(six.paidOrders).toBe(0);
    expect(six.aov).toBeNull();
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
