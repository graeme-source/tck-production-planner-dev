import { describe, expect, it } from "vitest";
import {
  HISTORY_START, NOV_2025_OPENING_LABEL, chainHistory, computeDeferredIncome, deferralOrderFromShopify, dispatchTrust,
  estimateEmployerCosts, financialYearOf, groupByFinancialYear, historyCsv, isFinal, labourWindow, lastDayOfMonth,
  latestClosedMonthEnd, monthEndCutoff, monthEndInPeriod, monthEndsBetween, payPeriodForMonthEnd, resolveDispatch,
  summariseMonthEndLabour, type DeferralOrder, type HistoryPoint,
} from "./month-end";

const order = (o: Partial<DeferralOrder> & { paidAt: string }): DeferralOrder => ({
  id: Math.floor(Math.random() * 1e12), name: "#1", cancelledAt: null, financialStatus: "paid", fulfillmentStatus: null,
  totalPrice: 50, totalTax: 0, refunds: [], requiresShipping: true, tags: null,
  shopifyFulfilments: null, appFulfilledAt: null, apcCollectionDate: null, ...o,
});
const deferred = (monthEnd: string, ...orders: DeferralOrder[]) => computeDeferredIncome(monthEnd, orders);

describe("month end cut-off — 23:59 London on the last day", () => {
  it("is 23:00 UTC in British Summer Time", () => {
    expect(monthEndCutoff("2026-09-30").toISOString()).toBe("2026-09-30T23:00:00.000Z");
    // Clocks went forward on 29 Mar 2026, so 31 Mar is BST too.
    expect(monthEndCutoff("2026-03-31").toISOString()).toBe("2026-03-31T23:00:00.000Z");
  });
  it("is midnight UTC in GMT, including the month the clocks go back", () => {
    expect(monthEndCutoff("2025-12-31").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    // Clocks went back on 26 Oct 2025.
    expect(monthEndCutoff("2025-10-31").toISOString()).toBe("2025-11-01T00:00:00.000Z");
  });
});

describe("deferred income", () => {
  it("counts an order paid 23:59 on the 30th and dispatched the next day", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-30T23:59:00+01:00", appFulfilledAt: "2026-10-01T07:30:00Z", totalPrice: 42.5 }));
    expect(d.orders).toBe(1);
    expect(d.incVat).toBe(42.5);
    expect(d.lines[0].dispatchedOn).toBe("2026-10-01");
  });
  it("leaves out an order paid and dispatched the same day", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-30T09:00:00+01:00", shopifyFulfilments: ["2026-09-30T15:00:00+01:00"] }));
    expect(d.orders).toBe(0);
  });
  it("leaves out an order paid 00:30 London on the 1st (23:30 UTC on the 30th)", () => {
    expect(deferred("2026-09-30", order({ paidAt: "2026-09-30T23:30:00Z" })).orders).toBe(0);
  });
  it("in GMT, an order at 23:30 UTC on 31 Dec is still December's", () => {
    const d = deferred("2025-12-31", order({ paidAt: "2025-12-31T23:30:00Z", shopifyFulfilments: ["2026-01-02T10:00:00Z"] }));
    expect(d.orders).toBe(1);
  });
  it("a dispatch at 23:30 London on the last day counts as sent that month", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-29T10:00:00+01:00", appFulfilledAt: "2026-09-30T22:30:00Z" }));
    expect(d.orders).toBe(0);
  });
  it("excludes orders cancelled or fully refunded by the month end", () => {
    const d = deferred("2026-09-30",
      order({ paidAt: "2026-09-29T10:00:00+01:00", cancelledAt: "2026-09-30T12:00:00+01:00" }),
      order({ paidAt: "2026-09-29T10:00:00+01:00", refunds: [{ at: "2026-09-30T08:00:00+01:00", amount: 50 }] }),
    );
    expect(d.orders).toBe(0);
  });
  it("keeps an order cancelled after the month end, and says so", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-29T10:00:00+01:00", cancelledAt: "2026-10-02T12:00:00+01:00", refunds: [{ at: "2026-10-02T12:00:00+01:00", amount: 50 }] }));
    expect(d.orders).toBe(1);
    expect(d.laterCancelled).toEqual({ orders: 1, incVat: 50 });
  });
  it("takes off a partial refund made by the month end", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-29T10:00:00+01:00", totalPrice: 60, refunds: [{ at: "2026-09-30T08:00:00+01:00", amount: 10 }] }));
    expect(d.incVat).toBe(50);
  });
  it("leaves out unpaid orders and orders with nothing to send", () => {
    const d = deferred("2026-09-30",
      order({ paidAt: "2026-09-29T10:00:00+01:00", financialStatus: "pending" }),
      order({ paidAt: "2026-09-29T10:00:00+01:00", requiresShipping: false }),
    );
    expect(d.orders).toBe(0);
    expect(d.nothingToSend.orders).toBe(1);
  });
  it("works out ex VAT from the order's tax share", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-29T10:00:00+01:00", totalPrice: 120, totalTax: 20 }));
    expect(d.incVat).toBe(120);
    expect(d.exVat).toBe(100);
    expect(d.vat).toBe(20);
  });
  it("APC collection date is a day: the 30th is sent, the 1st isn't", () => {
    const d = deferred("2026-09-30",
      order({ paidAt: "2026-09-29T10:00:00+01:00", apcCollectionDate: "2026-09-30" }),
      order({ paidAt: "2026-09-29T10:00:00+01:00", apcCollectionDate: "2026-10-01", totalPrice: 30 }),
    );
    expect(d.orders).toBe(1);
    expect(d.bySource.apc).toEqual({ orders: 1, incVat: 30 });
  });
  it("an order paid weeks ahead for a later delivery and not sent yet is deferred", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-09-20T10:00:00+01:00", tags: "2026-11-13, Friday", shopifyFulfilments: [] }));
    expect(d.bySource.not_yet.orders).toBe(1);
  });
  it("an unsent order paid over 60 days before with no later delivery date is left out and warned about", () => {
    const d = deferred("2026-09-30", order({ paidAt: "2026-07-01T10:00:00+01:00", tags: "2026-07-03" }));
    expect(d.orders).toBe(0);
    expect(d.staleUnsent.orders).toBe(1);
    expect(d.warnings.join(" ")).toMatch(/over 60 days/);
  });
});

describe("resolveDispatch — which record wins", () => {
  const base = { paidAt: "2026-09-29T10:00:00+01:00" };
  it("Shopify's fulfilment first, then the app's record, then APC", () => {
    expect(resolveDispatch(order({ ...base, shopifyFulfilments: ["2026-10-01T08:00:00Z", "2026-09-30T08:00:00Z"], appFulfilledAt: "2026-10-05T08:00:00Z" })))
      .toMatchObject({ state: "shopify", day: "2026-09-30" });
    expect(resolveDispatch(order({ ...base, appFulfilledAt: "2026-10-01T06:00:00Z", apcCollectionDate: "2026-10-03" })))
      .toMatchObject({ state: "app", day: "2026-10-01" });
    expect(resolveDispatch(order({ ...base, apcCollectionDate: "2026-10-03" }))).toMatchObject({ state: "apc", day: "2026-10-03" });
  });
  it("estimates from the delivery-date tag only when Shopify says sent but nothing has a date", () => {
    expect(resolveDispatch(order({ ...base, fulfillmentStatus: "fulfilled", tags: "2026-10-02, Friday" }))).toMatchObject({ state: "estimate", day: "2026-10-01" });
    // A collection is handed over ON its tagged day.
    expect(resolveDispatch(order({ ...base, fulfillmentStatus: "fulfilled", tags: "2026-10-02, Collections" }))).toMatchObject({ state: "estimate", day: "2026-10-02" });
    expect(resolveDispatch(order({ ...base, fulfillmentStatus: "fulfilled" }))).toMatchObject({ state: "unknown" });
    expect(resolveDispatch(order({ ...base, fulfillmentStatus: null, tags: "2026-10-02" }))).toMatchObject({ state: "not_yet" });
  });
  it("an order marked sent with no date at all is unknown — not deferred, and warned about", () => {
    const d = deferred("2026-09-30", order({ ...base, fulfillmentStatus: "fulfilled" }));
    expect(d.orders).toBe(0);
    expect(d.unknown.orders).toBe(1);
    expect(d.warnings.join(" ")).toMatch(/no dispatch date/);
    expect(d.trust.trustworthy).toBe(false);
  });
});

describe("deferralOrderFromShopify", () => {
  it("reads refunds, tax, shipping and fulfilments from a REST order", () => {
    const o = deferralOrderFromShopify({
      id: 5, name: "#9", created_at: "2026-09-30T20:00:00+01:00", total_price: "40.00", financial_status: "partially_refunded",
      line_items: [{ requires_shipping: true, tax_lines: [{ price: "1.50" }] }, { requires_shipping: false, tax_lines: [] }],
      refunds: [{ created_at: "2026-10-01T09:00:00+01:00", transactions: [{ kind: "refund", status: "success", amount: "5.00" }, { kind: "refund", status: "failure", amount: "99" }] }],
      fulfillments: [{ created_at: "2026-10-01T08:00:00+01:00", status: "success" }, { created_at: "2026-09-30T21:00:00+01:00", status: "cancelled" }],
    }, { apcCollectionDate: "2026-10-01" });
    expect(o.totalTax).toBe(1.5);
    expect(o.refunds).toEqual([{ at: "2026-10-01T09:00:00+01:00", amount: 5 }]);
    expect(o.requiresShipping).toBe(true);
    expect(o.shopifyFulfilments).toEqual(["2026-10-01T08:00:00+01:00"]);
    expect(o.apcCollectionDate).toBe("2026-10-01");
  });
  it("no fulfillments field means unknown (null), an empty list means none", () => {
    expect(deferralOrderFromShopify({ id: 1, created_at: "2026-09-30T20:00:00Z" }).shopifyFulfilments).toBeNull();
    expect(deferralOrderFromShopify({ id: 1, created_at: "2026-09-30T20:00:00Z", fulfillments: [] }).shopifyFulfilments).toEqual([]);
  });
});

describe("pay period ↔ month end", () => {
  it("every pay period holds one month end", () => {
    expect(monthEndInPeriod("2026-09-25", "2026-10-24")).toBe("2026-09-30");
    expect(monthEndInPeriod("2025-12-25", "2026-01-24")).toBe("2025-12-31");
    expect(monthEndInPeriod("2026-01-25", "2026-02-24")).toBe("2026-01-31");
    expect(monthEndInPeriod("2026-02-25", "2026-03-24")).toBe("2026-02-28");
    expect(monthEndInPeriod("2028-02-25", "2028-03-24")).toBe("2028-02-29");
    expect(monthEndInPeriod("2026-10-01", "2026-10-20")).toBeNull();
  });
  it("a month end's pay period spans the New Year in December", () => {
    expect(payPeriodForMonthEnd("2025-12-31")).toMatchObject({ from: "2025-12-25", to: "2026-01-24" });
    expect(payPeriodForMonthEnd("2026-02-28")).toMatchObject({ from: "2026-02-25", to: "2026-03-24" });
  });
  it("the labour window is the 25th to the month end", () => {
    expect(labourWindow("2026-09-30")).toEqual({ from: "2026-09-25", to: "2026-09-30" });
    expect(labourWindow("2025-12-31")).toEqual({ from: "2025-12-25", to: "2025-12-31" });
    expect(labourWindow("2026-02-28")).toEqual({ from: "2026-02-25", to: "2026-02-28" });
    expect(lastDayOfMonth("2028-02-03")).toBe("2028-02-29");
  });
  it("latest closed month and finality", () => {
    expect(latestClosedMonthEnd("2026-10-27")).toBe("2026-09-30");
    expect(latestClosedMonthEnd("2026-10-31")).toBe("2026-09-30");
    expect(latestClosedMonthEnd("2026-11-01")).toBe("2026-10-31");
    expect(latestClosedMonthEnd("2026-01-05")).toBe("2025-12-31");
    expect(isFinal("2026-09-30", "2026-10-24")).toBe(false);
    expect(isFinal("2026-09-30", "2026-10-25")).toBe(true);
  });
  it("the history runs from 31 Mar 2025, one row a month", () => {
    const ends = monthEndsBetween(HISTORY_START, "2026-09-30");
    expect(ends[0]).toBe("2025-03-31");
    expect(ends).toContain("2025-11-30");
    expect(ends).toContain("2026-02-28");
    expect(ends.at(-1)).toBe("2026-09-30");
    expect(ends).toHaveLength(19);
  });
});

describe("labour", () => {
  it("splits worked and holiday pay and estimates employer costs on its own line", () => {
    const l = summariseMonthEndLabour("2026-09-30", {
      people: [{ grossPay: 600, hours: 50, holidayHours: 8, holidayPay: 96 }, { grossPay: 50, hours: 4, holidayHours: 0, holidayPay: 0 }],
      totals: { hours: 54, grossPay: 650, holidayHours: 8, holidayPay: 96 },
      warnings: ["X isn't linked to anyone in the app.", "Y has 8 hours of holiday but no hourly shift"],
    }, { niRate: 0.15, niWeeklyThreshold: 96.15, pensionRate: 0.03 }, "2026-10-27");
    expect(l).toMatchObject({ from: "2026-09-25", to: "2026-09-30", pay: 650, workedPay: 554, holidayPay: 96, provisional: false });
    expect(l.warnings).toEqual(["Y has 8 hours of holiday but no hourly shift"]);
    // 6 days: threshold 82.41 each; NI = (600-82.41)*0.15 + 0; pension = 650 * 0.03
    expect(l.employer?.ni).toBeCloseTo(77.64, 2);
    expect(l.employer?.pension).toBe(19.5);
  });
  it("is provisional until its pay period ends", () => {
    const l = summariseMonthEndLabour("2026-09-30", { people: [], totals: { hours: 0, grossPay: 0, holidayHours: 0, holidayPay: 0 }, warnings: [] }, null, "2026-10-20");
    expect(l.provisional).toBe(true);
    expect(l.employer).toBeNull();
  });
  it("employer estimate is zero under the threshold", () => {
    expect(estimateEmployerCosts([50], 7, { niRate: 0.15, niWeeklyThreshold: 96.15, pensionRate: 0 }).total).toBe(0);
  });
});

describe("history", () => {
  const ends = monthEndsBetween(HISTORY_START, "2026-05-31");
  const points: HistoryPoint[] = ends.map((me, i) => ({
    monthEnd: me, notes: [],
    deferred: { incVat: 1000 + i * 100, exVat: 900 + i * 90, orders: 10 + i },
    labour: { pay: 2000 + (i % 3) * 50, hours: 100, employer: 100 + i },
    trustworthy: true,
  }));
  const rows = chainHistory(points);

  it("each month's opening is the previous month's closing, and movements chain", () => {
    expect(rows[0].isOpening).toBe(true);
    expect(rows[0].deferredIncVat).toEqual({ opening: null, closing: 1000, movement: null });
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].deferredIncVat.opening).toBe(rows[i - 1].deferredIncVat.closing);
      expect(rows[i].labourPay.opening).toBe(rows[i - 1].labourPay.closing);
      expect(rows[i].deferredIncVat.movement).toBeCloseTo(rows[i].deferredIncVat.closing! - rows[i].deferredIncVat.opening!, 2);
    }
    const sum = rows.slice(1).reduce((n, r) => n + r.deferredIncVat.movement!, 0);
    expect(sum).toBeCloseTo(rows.at(-1)!.deferredIncVat.closing! - rows[0].deferredIncVat.closing!, 2);
  });
  it("labels the year-end and 30 Nov 2025 opening balances", () => {
    expect(rows[0].label).toBe("Opening balance for the 2025/26 financial year — 31 Mar 2025");
    expect(rows.find(r => r.monthEnd === "2026-03-31")!.label).toMatch(/Opening balance for the 2026\/27 financial year/);
    expect(rows.find(r => r.monthEnd === "2025-11-30")!.label).toContain(NOV_2025_OPENING_LABEL);
    // History that starts at 30 Nov 2025 opens with the label Graeme asked for.
    expect(chainHistory(points.filter(p => p.monthEnd >= "2025-11-30"))[0].label).toBe(NOV_2025_OPENING_LABEL);
  });
  it("groups by financial year, April to March", () => {
    expect(financialYearOf("2025-03-31")).toBe("2024/25");
    expect(financialYearOf("2025-04-30")).toBe("2025/26");
    expect(financialYearOf("2026-03-31")).toBe("2025/26");
    const groups = groupByFinancialYear(rows);
    expect(groups.map(g => g.year)).toEqual(["2025/26", "2026/27"]);
    const [y1, y2] = groups;
    expect(y1.rows).toHaveLength(12);
    expect(y1.complete).toBe(true);
    // Opening = 31 Mar 2025, closing = 31 Mar 2026.
    expect(y1.deferredIncVat.opening).toBe(rows[0].deferredIncVat.closing);
    expect(y1.deferredIncVat.closing).toBe(rows.find(r => r.monthEnd === "2026-03-31")!.deferredIncVat.closing);
    expect(y1.deferredIncVat.movement).toBeCloseTo(y1.rows.reduce((n, r) => n + r.deferredIncVat.movement!, 0), 2);
    // The next year opens where the last closed.
    expect(y2.deferredIncVat.opening).toBe(y1.deferredIncVat.closing);
    expect(y2.complete).toBe(false);
  });
  it("CSV has the opening balance, every month and a year total per year", () => {
    const csv = historyCsv(rows);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(1 + rows.length + 2);
    expect(lines[1]).toContain("Opening balance for the 2025/26 financial year");
    expect(csv).toContain("Year total 2025/26 (Apr 2025 – Mar 2026)");
    expect(csv).toContain("Year total 2026/27 (Apr 2026 – Mar 2027) - year not finished");
  });
  it("a month that failed shows no movement either side, not a wrong one", () => {
    const broken = chainHistory([points[0], { ...points[1], deferred: null, error: "Shopify down" }, points[2]]);
    expect(broken[1].deferredIncVat.movement).toBeNull();
    expect(broken[2].deferredIncVat.opening).toBeNull();
    expect(broken[2].deferredIncVat.movement).toBeNull();
  });
});

describe("dispatchTrust", () => {
  it("trusts ≥ 97% real records with under 1% unknown", () => {
    expect(dispatchTrust({ shopify: 970, app: 0, apc: 0, estimate: 30, not_yet: 5, unknown: 0, nothing_to_send: 2 }).trustworthy).toBe(true);
    expect(dispatchTrust({ shopify: 960, app: 0, apc: 0, estimate: 40, not_yet: 0, unknown: 0, nothing_to_send: 0 }).trustworthy).toBe(false);
    expect(dispatchTrust({ shopify: 0, app: 0, apc: 0, estimate: 0, not_yet: 0, unknown: 0, nothing_to_send: 0 }).trustworthy).toBe(false);
  });
});
