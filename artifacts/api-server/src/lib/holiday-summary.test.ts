import { describe, it, expect } from "vitest";
import {
  currentHolidayAccounts, balanceAmount, summariseHoliday, summariseEmployment,
  type PdAccount, type PdTransaction,
} from "./holiday-summary";

const TODAY = "2026-09-25";
const hours = (value: number) => ({ value, unit: { type: "Hours" } });
const entry = (date: string, v: number): PdTransaction => ({ type: "Entry", date, costs: [hours(v)] });

// Shapes as TCK's Planday returned them on 2026-09-25 (values trimmed).
const accounts: PdAccount[] = [
  { id: 253731, name: "Standard Hourly Accrual", status: "Active", validityPeriod: { start: "2026-01-01", end: "2026-12-31" } },
  { id: 239252, name: "Standard Hourly Accrual", status: "Inactive", validityPeriod: { start: "2025-01-01", end: "2025-12-31" } },
];

describe("currentHolidayAccounts", () => {
  it("keeps the Active account covering today, drops past years", () => {
    expect(currentHolidayAccounts(accounts, TODAY).map(a => a.id)).toEqual([253731]);
  });
  it("never treats a sickness account as holiday", () => {
    const withSick = [...accounts, { id: 1, name: "Sick Leave", status: "Active", validityPeriod: { start: "2026-01-01", end: "2026-12-31" } }];
    expect(currentHolidayAccounts(withSick, TODAY).map(a => a.id)).toEqual([253731]);
  });
  it("falls back to any Active holiday account when none covers today", () => {
    const stale = [{ ...accounts[0], validityPeriod: { start: "2025-01-01", end: "2025-12-31" } }];
    expect(currentHolidayAccounts(stale, TODAY)).toHaveLength(1);
  });
});

describe("balanceAmount", () => {
  it("reads value + unit, null when missing", () => {
    expect(balanceAmount({ data: { balance: [hours(30.18)] } })).toEqual({ value: 30.18, unit: "Hours" });
    expect(balanceAmount({ data: { balance: [] } })).toBeNull();
    expect(balanceAmount(null)).toBeNull();
  });
});

describe("summariseHoliday", () => {
  const summary = summariseHoliday([{
    account: accounts[0],
    balanceNow: { data: { balance: [hours(30.1824083)] } },
    balanceYearEnd: { data: { balance: [hours(-2.8175916)] } },
    transactions: [
      entry("2026-01-01", -8.25), entry("2026-04-03", -8.25), entry("2026-08-31", -8.25),
      entry("2026-11-06", -8.25), entry("2026-11-08", -7.4431),
    ],
  }], TODAY)!;

  it("splits taken (to date) from booked (future)", () => {
    expect(summary.takenThisYear).toBe(24.75);
    expect(summary.upcoming).toEqual([{ date: "2026-11-06", amount: 8.25 }, { date: "2026-11-08", amount: 7.44 }]);
    expect(summary.upcomingTotal).toBe(15.69);
  });

  it("carries today's balance and the year-end balance after booked holiday", () => {
    expect(summary).toMatchObject({ balanceNow: 30.18, balanceAfterBooked: -2.82, unit: "Hours" });
    expect(summary).toMatchObject({ yearStart: "2026-01-01", yearEnd: "2026-12-31", accountNames: ["Standard Hourly Accrual"] });
  });

  it("ignores positive adjustments as 'taken'", () => {
    const s = summariseHoliday([{ account: accounts[0], balanceNow: null, balanceYearEnd: null, transactions: [entry("2026-02-01", 10)] }], TODAY)!;
    expect(s.takenThisYear).toBe(0);
    expect(s.balanceNow).toBeNull();
  });

  it("no current account → null", () => {
    expect(summariseHoliday([], TODAY)).toBeNull();
  });
});

describe("summariseEmployment", () => {
  const types = [{ id: 2362, name: "Full time employees" }, { id: 4855, name: "Zero Hour Employee" }];
  const rules = [{ id: 2179, name: "16.5 Hours per week", description: "" }, { id: 2180, name: "24.75 Hours per week", description: "(3 standard 9 hour shifts)" }];

  it("names the employee type and contract rule", () => {
    expect(summariseEmployment({ hiredFrom: "2022-03-23", employeeTypeId: 2362, contractRulesRuleId: 2179 }, types, rules))
      .toEqual({ hiredFrom: "2022-03-23", employeeType: "Full time employees", contractRule: "16.5 Hours per week", contractRuleNote: null });
    expect(summariseEmployment({ contractRulesRuleId: 2180 }, types, rules).contractRuleNote).toBe("(3 standard 9 hour shifts)");
  });

  it("no rule assigned → null (9 staff had none on 2026-09-23)", () => {
    expect(summariseEmployment({ employeeTypeId: 4855 }, types, rules)).toMatchObject({ contractRule: null, employeeType: "Zero Hour Employee" });
  });

  it("a rule id the lookup doesn't know still says one is set", () => {
    expect(summariseEmployment({ contractRulesRuleId: 9999 }, types, rules).contractRule).toBe("Set in Planday");
  });
});
