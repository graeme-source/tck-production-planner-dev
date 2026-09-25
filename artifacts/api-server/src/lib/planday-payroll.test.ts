import { describe, it, expect } from "vitest";
import { payrollTotals, type PayrollRow } from "./planday-payroll";

// Shaped like a real approved Planday payroll row (2026-09-25 check): clocked
// 05:56–16:33 (10h37m) at £12.75, with a 20-minute and a 25-minute unpaid
// break. Planday's `salary` is the full clock time × rate; the breaks carry
// NEGATIVE amounts and durations in hours.
const RATE = 12.75;
const clockHours = 10 + 37 / 60;
const realShape: PayrollRow = {
  employeeId: 101,
  salary: clockHours * RATE,
  start: "2026-09-22T05:56:00",
  end: "2026-09-22T16:33:00",
  breaks: [
    { duration: 0.3333, amount: -0.3333 * RATE, isPaid: false },
    { duration: 0.4167, amount: -0.4167 * RATE, isPaid: false },
  ],
};

describe("payrollTotals — unpaid breaks come off pay (P&L labour regression)", () => {
  it("pays paid hours × rate, not Planday's salary", () => {
    const t = payrollTotals([realShape]);
    const paidHours = clockHours - 0.75;
    expect(t.totalHours).toBeCloseTo(paidHours, 6);
    expect(t.grossWages).toBeCloseTo(paidHours * RATE, 6);
    // The old code summed salary — 7.6% more on this shift.
    expect(t.grossWages).toBeLessThan(realShape.salary);
    expect(realShape.salary - t.grossWages).toBeCloseTo(0.75 * RATE, 6);
  });

  it("leaves paid breaks in the pay", () => {
    const paid: PayrollRow = { ...realShape, breaks: [{ duration: 0.25, amount: 0, isPaid: true }] };
    const t = payrollTotals([paid]);
    expect(t.grossWages).toBeCloseTo(realShape.salary, 6);
    expect(t.totalHours).toBeCloseTo(clockHours, 6);
  });

  it("groups break-deducted pay per employee for the NI threshold", () => {
    const other: PayrollRow = { ...realShape, employeeId: 202 };
    const t = payrollTotals([realShape, realShape, other]);
    const one = (clockHours - 0.75) * RATE;
    expect(t.wagesByEmployee.get(101)).toBeCloseTo(2 * one, 6);
    expect(t.wagesByEmployee.get(202)).toBeCloseTo(one, 6);
    expect(t.grossWages).toBeCloseTo(3 * one, 6);
  });

  it("copes with a row that has no breaks array", () => {
    const bare = { ...realShape, breaks: undefined as unknown as PayrollRow["breaks"] };
    expect(payrollTotals([bare]).grossWages).toBeCloseTo(realShape.salary, 6);
  });
});
