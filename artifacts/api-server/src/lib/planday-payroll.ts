/**
 * Totals over Planday payroll rows — pure, no I/O (Objective I: the P&L's
 * labour line must be the pay people actually receive).
 *
 * Planday's /payroll/v1.0/payroll `salary` is (end − start) × rate: it does
 * NOT take unpaid breaks off. Unpaid breaks come back separately in
 * `breaks[]` with isPaid=false, a duration in HOURS and a NEGATIVE amount.
 * TCK does deduct them (35 min lunch + 15 min break on a full day — Graeme,
 * 2026-09-25), so a shift's pay is salary + Σ unpaid break amounts, which
 * equals paid hours × rate. Measured 2026-09-25 on 26 shifts: Σ salary was
 * 8.4% above paid hours × rate.
 *
 * Approved start/end are used as-is: Planday's approval already moves them
 * to the punch-in (if late) and punch-out (over/undertime).
 */
import { shiftPay, shiftPaidHours, type PlandayPayrollShift } from "./team-efficiency";

export interface PayrollRow extends PlandayPayrollShift {
  employeeId: number;
}

export interface PayrollTotals {
  /** Σ pay with unpaid breaks taken off. */
  grossWages: number;
  /** Σ paid hours (clock hours minus unpaid breaks). */
  totalHours: number;
  /** Pay per employee — the NI threshold applies per person. */
  wagesByEmployee: Map<number, number>;
}

export function payrollTotals(rows: PayrollRow[]): PayrollTotals {
  let grossWages = 0;
  let totalHours = 0;
  const wagesByEmployee = new Map<number, number>();
  for (const r of rows) {
    const pay = shiftPay({ ...r, breaks: r.breaks ?? [] });
    grossWages += pay;
    totalHours += shiftPaidHours({ ...r, breaks: r.breaks ?? [] });
    wagesByEmployee.set(r.employeeId, (wagesByEmployee.get(r.employeeId) ?? 0) + pay);
  }
  return { grossWages, totalHours, wagesByEmployee };
}
