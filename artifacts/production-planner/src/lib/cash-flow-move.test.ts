import { describe, it, expect } from "vitest";
import { explainBill, findLine, moveLine, recompute, type CfForecast, type CfLine } from "./cash-flow-move";

const line = (p: Partial<CfLine>): CfLine => ({
  source: "bill", ref: "b1", key: "bill:b1:", occurrence: "", label: "AB Fruits", amount: 500,
  date: "2026-10-27", naturalDate: "2026-10-27", late: false, ...p,
});
const day = (date: string, ins: CfLine[] = [], outs: CfLine[] = []) => ({ date, opening: 0, ins, outs, closing: 0 });

function sample(): CfForecast {
  return recompute({
    start: "2026-10-27", openingBalance: 1000, lowest: null, totalIn: 0, totalOut: 0,
    days: [
      day("2026-10-27", [], [line({ date: "2026-10-20", naturalDate: "2026-10-20", late: true, bill: {
        vendorName: "AB Fruits", txnDate: "2026-10-20", qboDueDate: "2026-10-20", termsName: null, hasTerms: false,
        basis: "qbo", naturalBasis: "qbo", ruleDate: null, ruleText: null } })]),
      day("2026-10-28", [line({ source: "payout", ref: "p1", key: "payout:p1:", label: "Shopify payout", amount: 800, date: "2026-10-28", naturalDate: "2026-10-28" })]),
      day("2026-10-29"),
    ],
  });
}

describe("cash flow drag and drop (2026-10-27)", () => {
  it("works out the running balance and lowest point", () => {
    const f = sample();
    expect(f.days.map(d => d.closing)).toEqual([500, 1300, 1300]);
    expect(f.lowest).toEqual({ date: "2026-10-27", balance: 500 });
    expect([f.totalIn, f.totalOut]).toEqual([800, 500]);
  });

  it("dragging an overdue bill to a later day moves the balance and lowest point at once", () => {
    const f = moveLine(sample(), "bill:b1:", "2026-10-29");
    expect(f.days.map(d => d.closing)).toEqual([1000, 1800, 1300]);
    expect(f.lowest).toEqual({ date: "2026-10-27", balance: 1000 });
    const moved = findLine(f, "bill:b1:")!;
    expect(moved.day).toBe("2026-10-29");
    expect(moved.line).toMatchObject({ late: false, movedFrom: "2026-10-20", date: "2026-10-29" });
    expect(moved.line.bill!.basis).toBe("override");
  });

  it("'Put back' returns it to its own date — on today, late — and clears 'moved from'", () => {
    const f = moveLine(moveLine(sample(), "bill:b1:", "2026-10-29"), "bill:b1:", null);
    const back = findLine(f, "bill:b1:")!;
    expect(back.day).toBe("2026-10-27");
    expect(back.line.late).toBe(true);
    expect(back.line.movedFrom).toBeUndefined();
    expect(back.line.bill!.basis).toBe("qbo");
  });

  it("money in moves too; past the last day it leaves the window", () => {
    const f = moveLine(sample(), "payout:p1:", "2026-11-30");
    expect(findLine(f, "payout:p1:")).toBeNull();
    expect(f.totalIn).toBe(0);
    expect(f.days.map(d => d.closing)).toEqual([500, 500, 500]);
  });

  it("explains where a bill's date came from in plain words", () => {
    const b = (p: Partial<NonNullable<CfLine["bill"]>>): CfLine => line({ bill: {
      vendorName: "AB Fruits", txnDate: "2026-10-03", qboDueDate: "2026-10-03", termsName: null, hasTerms: false,
      basis: "qbo", naturalBasis: "qbo", ruleDate: null, ruleText: null, ...p } });
    expect(explainBill(b({}))).toEqual(["Bill 3 Oct · QuickBooks due 3 Oct (no payment terms)"]);
    expect(explainBill(b({ termsName: "Net 30", qboDueDate: "2026-11-02" }))[0]).toBe("Bill 3 Oct · QuickBooks due 2 Nov (Net 30)");
    expect(explainBill(b({ basis: "rule", naturalBasis: "rule", ruleDate: "2026-11-01" }))[1]).toBe("Due 1 Nov by your AB Fruits rule; QuickBooks says 3 Oct");
    expect(explainBill(b({ qboDueDate: null, basis: "bill_date", naturalBasis: "bill_date" }))).toEqual([
      "Bill 3 Oct · no due date in QuickBooks (no payment terms)", "Placed on the bill date, 3 Oct"]);
    const moved = { ...b({ basis: "override", naturalBasis: "rule", ruleDate: "2026-11-01" }), date: "2026-11-05", movedFrom: "2026-11-01" };
    expect(explainBill(moved)[2]).toBe("You moved it to 5 Nov from 1 Nov");
    expect(explainBill(line({}))).toEqual([]);
  });

  it("an unknown line changes nothing", () => {
    const f = sample();
    expect(moveLine(f, "bill:nope:", "2026-10-28")).toBe(f);
  });
});
