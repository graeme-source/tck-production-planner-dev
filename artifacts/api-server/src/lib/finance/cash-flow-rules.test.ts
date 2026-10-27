import { describe, it, expect } from "vitest";
import { describeRule, diagnoseBills, resolveBillDate, ruleDueDate, ruleFromRow, rulesByVendor, vendorKey } from "./cash-flow-rules";

describe("supplier payment rules (2026-10-27)", () => {
  it("matches suppliers ignoring case, spaces and dots", () => {
    expect(vendorKey("A.B. Fruits")).toBe(vendorKey("ab fruits"));
    expect(vendorKey("  AB  Fruits ")).toBe("abfruits");
    expect(vendorKey(null)).toBe("");
  });

  it("N days after the bill date, across a month and a year end", () => {
    expect(ruleDueDate({ kind: "days_after", days: 30 }, "2026-10-03")).toBe("2026-11-02");
    expect(ruleDueDate({ kind: "days_after", days: 14 }, "2026-12-25")).toBe("2027-01-08");
    expect(ruleDueDate({ kind: "days_after", days: 0 }, "2026-10-03")).toBe("2026-10-03");
  });

  it("day D of the month after the bill, including December → January", () => {
    expect(ruleDueDate({ kind: "next_month_day", day: 1 }, "2026-10-03")).toBe("2026-11-01");
    expect(ruleDueDate({ kind: "next_month_day", day: 1 }, "2026-10-31")).toBe("2026-11-01");
    expect(ruleDueDate({ kind: "next_month_day", day: 15 }, "2026-12-20")).toBe("2027-01-15");
  });

  it("day 31 (or 30) clamps to the end of a short month, leap years included", () => {
    expect(ruleDueDate({ kind: "next_month_day", day: 31 }, "2027-01-10")).toBe("2027-02-28");
    expect(ruleDueDate({ kind: "next_month_day", day: 31 }, "2028-01-10")).toBe("2028-02-29");
    expect(ruleDueDate({ kind: "next_month_day", day: 30 }, "2024-01-31")).toBe("2024-02-29");
    expect(ruleDueDate({ kind: "next_month_day", day: 31 }, "2026-03-05")).toBe("2026-04-30");
    expect(ruleDueDate({ kind: "next_month_day", day: 31 }, "2026-11-05")).toBe("2026-12-31");
  });

  it("cut-off: up to the 15th paid on the 1st of next month, later ones the month after", () => {
    const r = { kind: "next_month_day_cutoff", day: 1, cutoff: 15 } as const;
    expect(ruleDueDate(r, "2026-10-01")).toBe("2026-11-01");
    expect(ruleDueDate(r, "2026-10-15")).toBe("2026-11-01");
    expect(ruleDueDate(r, "2026-10-16")).toBe("2026-12-01");
    expect(ruleDueDate(r, "2026-11-30")).toBe("2027-01-01");   // two months on, over the year end
    expect(ruleDueDate(r, "2026-12-16")).toBe("2027-02-01");
    expect(ruleDueDate({ kind: "next_month_day_cutoff", day: 31, cutoff: 20 }, "2027-12-25")).toBe("2028-02-29");
  });

  it("'use QuickBooks' gives no date of its own", () => {
    expect(ruleDueDate({ kind: "qbo" }, "2026-10-03")).toBeNull();
  });

  it("override beats rule beats QuickBooks beats bill date", () => {
    const rule = { kind: "next_month_day", day: 1 } as const;
    expect(resolveBillDate({ txnDate: "2026-10-03", qboDueDate: "2026-10-03", rule, override: "2026-11-10" }))
      .toEqual({ natural: "2026-11-01", naturalBasis: "rule", date: "2026-11-10", basis: "override", ruleDate: "2026-11-01" });
    expect(resolveBillDate({ txnDate: "2026-10-03", qboDueDate: "2026-10-03", rule, override: null }))
      .toMatchObject({ date: "2026-11-01", basis: "rule" });
    expect(resolveBillDate({ txnDate: "2026-10-03", qboDueDate: "2026-10-20", rule: { kind: "qbo" }, override: null }))
      .toMatchObject({ date: "2026-10-20", basis: "qbo", ruleDate: null });
    expect(resolveBillDate({ txnDate: "2026-10-03", qboDueDate: null, rule: null, override: null }))
      .toMatchObject({ date: "2026-10-03", basis: "bill_date" });
    expect(resolveBillDate({ txnDate: null, qboDueDate: null, rule, override: null }))
      .toMatchObject({ date: null, basis: "none" });
  });

  it("stored rows become rules; incomplete rows don't", () => {
    expect(ruleFromRow({ kind: "next_month_day_cutoff", days: null, day_of_month: 1, cutoff_day: 15 })).toEqual({ kind: "next_month_day_cutoff", day: 1, cutoff: 15 });
    expect(ruleFromRow({ kind: "days_after", days: null, day_of_month: null, cutoff_day: null })).toBeNull();
    expect(ruleFromRow({ kind: "nonsense", days: 3, day_of_month: 1, cutoff_day: 1 })).toBeNull();
  });

  it("the last rule for a supplier wins", () => {
    const m = rulesByVendor([
      { vendorName: "AB Fruits", rule: { kind: "days_after", days: 7 } },
      { vendorName: "a.b. fruits", rule: { kind: "next_month_day", day: 1 } },
    ]);
    expect(m.get("abfruits")?.rule).toEqual({ kind: "next_month_day", day: 1 });
  });

  it("describes rules in plain words", () => {
    expect(describeRule({ kind: "days_after", days: 30 })).toBe("30 days after the bill date");
    expect(describeRule({ kind: "next_month_day", day: 1 })).toBe("on the 1st of the month after the bill");
    expect(describeRule({ kind: "next_month_day", day: 31 })).toBe("on the last day of the month after the bill");
    expect(describeRule({ kind: "next_month_day_cutoff", day: 1, cutoff: 15 })).toBe("bills up to the 15th paid on the 1st of the next month; later ones the month after");
    expect(describeRule({ kind: "next_month_day", day: 22 })).toContain("22nd");
    expect(describeRule({ kind: "next_month_day", day: 13 })).toContain("13th");
  });
});

describe("why so much looks overdue (2026-10-27)", () => {
  it("counts bills due on their bill date, with no due date or no terms, once each", () => {
    const d = diagnoseBills([
      { vendorName: "AB Fruits", txnDate: "2026-10-03", dueDate: "2026-10-03", termsId: null, balance: 100 },   // same + no terms
      { vendorName: "AB Fruits", txnDate: "2026-10-05", dueDate: null, termsId: null, balance: 50 },            // no due + no terms
      { vendorName: "Brakes", txnDate: "2026-10-01", dueDate: "2026-10-31", termsId: "3", balance: 900 },       // fine
      { vendorName: "Bako", txnDate: "2026-10-02", dueDate: "2026-10-02", termsId: "1", balance: 20 },          // same date
      { vendorName: "Paid", txnDate: "2026-10-02", dueDate: "2026-10-02", termsId: null, balance: 0 },          // ignored
    ], [{ vendorName: "bako", rule: { kind: "days_after", days: 30 } }]);
    expect(d).toMatchObject({ total: 4, suspect: 3, suspectAmount: 170, dueIsBillDate: 2, noDueDate: 1, noTerms: 2, ruled: 1 });
    // Bako already has a rule, so only AB Fruits is suggested.
    expect(d.suppliers).toEqual([{ vendorName: "AB Fruits", bills: 2, amount: 150 }]);
  });
});
