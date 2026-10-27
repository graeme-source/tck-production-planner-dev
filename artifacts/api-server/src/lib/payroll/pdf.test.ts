import { describe, expect, it } from "vitest";
import { renderPayrollPdf, type PayrollPdfInput } from "./pdf";

const sample: PayrollPdfInput = {
  periodLabel: "October 2026",
  generatedAt: "26 Oct 2026, 15:00",
  people: [
    { name: "Alex Example", shifts: 20, hourlyRate: 12.5, productionHours: 140.5, productionPay: 1756.25, holidayHours: 8, holidayPay: 100, office: [{ work: "Media", hours: 12, pay: 150 }] },
    { name: "Sam Sample", shifts: 5, hourlyRate: null, productionHours: 40, productionPay: 500, holidayHours: 4, holidayPay: null, office: [] },
  ],
  totals: { hours: 204.5, grossPay: 2506.25, productionHours: 180.5, productionPay: 2256.25, officeHours: 12, officePay: 150, holidayHours: 12, holidayPay: 100 },
  sick: [{ name: "Sam Sample", date: "2026-10-03", hours: 8, contractDaysPerWeek: 4, contractHoursPerWeek: 32 }],
  joiners: [{ name: "Sam Sample", date: "2026-10-01", documents: ["Starter checklist", "P45"] }],
  leavers: [],
};

describe("renderPayrollPdf", () => {
  it("returns a non-empty PDF buffer", async () => {
    const buf = await renderPayrollPdf(sample);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 20_000);

  it("renders with every section empty", async () => {
    const buf = await renderPayrollPdf({ ...sample, people: [], sick: [], joiners: [], leavers: [], totals: { hours: 0, grossPay: 0, productionHours: 0, productionPay: 0, officeHours: 0, officePay: 0, holidayHours: 0, holidayPay: 0 } });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 20_000);
});
