import { describe, expect, it } from "vitest";
import { buildSection, historyPdf, labourWindowLabel, monthEndEmailLines, monthEndPdf, type MonthEndSummary } from "./month-end-report";
import { chainHistory, computeDeferredIncome, summariseMonthEndLabour } from "./month-end";
import { renderPayrollPdf } from "./pdf";

const deferredAt = (monthEnd: string, price: number, tax = 0) => {
  const { lines, ...d } = computeDeferredIncome(monthEnd, [{
    id: 1, name: "#1", paidAt: `${monthEnd}T20:00:00Z`, cancelledAt: null, financialStatus: "paid", fulfillmentStatus: null,
    totalPrice: price, totalTax: tax, refunds: [], requiresShipping: true, tags: null, shopifyFulfilments: [], appFulfilledAt: null, apcCollectionDate: null,
  }]);
  return { ...d, lineCount: lines.length };
};
const labourAt = (monthEnd: string, pay: number) => summariseMonthEndLabour(monthEnd, {
  people: [{ grossPay: pay, hours: 10, holidayHours: 0, holidayPay: 0 }],
  totals: { hours: 10, grossPay: pay, holidayHours: 0, holidayPay: 0 }, warnings: [],
}, { niRate: 0.15, niWeeklyThreshold: 96.15, pensionRate: 0.03 }, "2026-10-27");
const summary = (monthEnd: string, label: string, price: number, pay: number, tax = 0): MonthEndSummary => ({
  monthEnd, label, payPeriod: { from: "", to: "", label: "" },
  deferred: deferredAt(monthEnd, price, tax), deferredError: null, labour: labourAt(monthEnd, pay), labourError: null,
  final: true, computedAt: "", fromStore: false,
});

describe("month-end section for the PDF and email", () => {
  const sec = buildSection(summary("2026-09-30", "September 2026", 300, 1200), summary("2026-08-31", "August 2026", 200, 1000));

  it("works out the movement against the month end before", () => {
    expect(sec.movement).toMatchObject({ deferredIncVat: 100, labourPay: 200 });
  });
  it("reads well in the PDF", () => {
    const m = monthEndPdf(sec);
    expect(m.title).toBe("Month-end adjustments for September 2026");
    expect(m.deferred).toMatchObject({ heading: "Deferred income at 30 Sep 2026", incVat: 300, exVat: null, opening: { incVat: 200 }, movement: 100 });
    expect(m.deferred!.definition).toMatch(/23:59 on 30 Sep 2026.*sent in October/);
    expect(m.labour).toMatchObject({ heading: "Labour 25–30 Sep 2026, paid in this pay period", pay: 1200, movement: 200 });
    expect(m.labour!.employer).not.toBeNull();
  });
  it("shows ex VAT only when VAT makes a difference", () => {
    const withVat = monthEndPdf(buildSection(summary("2026-09-30", "September 2026", 120, 0, 20), null));
    expect(withVat.deferred!.exVat).toBe(100);
    expect(withVat.deferred!.opening).toBeNull();
  });
  it("adds one plain line to the email, and mentions the appendix only when attached", () => {
    expect(monthEndEmailLines(sec, false)).toEqual([
      "Month-end adjustments for September 2026: deferred income at 30 Sep 2026 £300.00 (1 orders paid but not yet dispatched); labour 25–30 Sep 2026 £1,200.00 (paid in this period, belongs to September 2026) — details in the PDF.",
    ]);
    expect(monthEndEmailLines(sec, true)).toHaveLength(2);
    expect(monthEndEmailLines(null, true)).toEqual([]);
  });
  it("labels the labour window", () => {
    expect(labourWindowLabel("2026-02-28")).toBe("25–28 Feb 2026");
  });
  it("renders a PDF with the section and the history appendix", async () => {
    const rows = chainHistory(["2026-02-28", "2026-03-31", "2026-04-30"].map((me, i) => ({
      monthEnd: me, notes: [], trustworthy: i !== 1,
      deferred: { incVat: 1000 + i * 50, exVat: 1000 + i * 50, orders: 10 }, labour: { pay: 900 + i * 10, hours: 50, employer: 20 },
    })));
    const buf = await renderPayrollPdf({
      periodLabel: "25 Sep – 24 Oct 2026", generatedAt: "now", people: [], sick: [], joiners: [], leavers: [],
      totals: { hours: 0, grossPay: 0, productionHours: 0, productionPay: 0, officeHours: 0, officePay: 0, holidayHours: 0, holidayPay: 0 },
      monthEnd: monthEndPdf(sec), history: historyPdf(rows),
    });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 20_000);
});
