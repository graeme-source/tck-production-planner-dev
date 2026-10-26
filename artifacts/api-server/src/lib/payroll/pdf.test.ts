import { describe, expect, it } from "vitest";
import { renderPayrollPdf, type PayrollPdfInput } from "./pdf";

const sample: PayrollPdfInput = {
  periodLabel: "October 2026",
  generatedAt: "26 Oct 2026, 15:00",
  people: [
    { name: "Alex Example", hours: 152.5, shifts: 20, hourlyRate: 12.5, grossPay: 1906.25 },
    { name: "Sam Sample", hours: 40, shifts: 5, hourlyRate: null, grossPay: 500 },
  ],
  totals: { hours: 192.5, grossPay: 2406.25 },
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
    const buf = await renderPayrollPdf({ ...sample, people: [], sick: [], joiners: [], leavers: [], totals: { hours: 0, grossPay: 0 } });
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 20_000);
});
