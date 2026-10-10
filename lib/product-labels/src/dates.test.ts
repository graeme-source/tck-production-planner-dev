import { describe, it, expect } from "vitest";
import { addDays, addMonths, addPeriod, dayOfYear, formatLabelDate, julianBatchCode, labelDates } from "./dates";
import { DEFAULT_TEMPLATE } from "./template";

describe("Julian batch code (YYDDD)", () => {
  it("26147 is day 147 of 2026", () => {
    expect(julianBatchCode("2026-05-27")).toBe("26147");
  });
  it("pads the day to three digits", () => {
    expect(julianBatchCode("2026-01-01")).toBe("26001");
    expect(julianBatchCode("2026-02-09")).toBe("26040");
  });
  it("counts 29 Feb in a leap year, so 31 Dec is day 366", () => {
    expect(dayOfYear("2028-03-01")).toBe(61);
    expect(julianBatchCode("2028-12-31")).toBe("28366");
    expect(julianBatchCode("2026-12-31")).toBe("26365");
  });
  it("matches Graeme's example label 26283 = 10 Oct 2026", () => {
    expect(julianBatchCode("2026-10-10")).toBe("26283");
  });
});

describe("use-by calendar maths", () => {
  it("adds days across a month and year end", () => {
    expect(addDays("2026-10-10", 13)).toBe("2026-10-23");
    expect(addDays("2026-12-25", 13)).toBe("2027-01-07");
  });
  it("adds days across the clock change without slipping a day", () => {
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });
  it("31 Jan + 1 month = 28 Feb, or 29 Feb in a leap year", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
  it("clamps to 30-day months and keeps ordinary days", () => {
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-10-10", 6)).toBe("2027-04-10");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
  it("29 Feb + 1 year = 28 Feb; + 4 years = 29 Feb", () => {
    expect(addPeriod("2028-02-29", { amount: 1, unit: "years" })).toBe("2029-02-28");
    expect(addPeriod("2028-02-29", { amount: 4, unit: "years" })).toBe("2032-02-29");
  });
  it("weeks are 7 days", () => {
    expect(addPeriod("2026-10-10", { amount: 2, unit: "weeks" })).toBe("2026-10-24");
  });
  it("prints dd/mm/yy", () => {
    expect(formatLabelDate("2026-02-05")).toBe("05/02/26");
  });
});

describe("Graeme's rules (2026-10-10): use-by counts from the PRINT date, batch is the production day", () => {
  const on = (amount: number) => labelDates({
    printDate: "2026-10-10", productionDate: "2026-10-10",
    chilled: { amount, unit: "days" }, frozen: null, batchBasis: DEFAULT_TEMPLATE.batchBasis,
  });
  it("1 day = tomorrow", () => {
    expect(on(1).chilledUseBy).toBe("2026-10-11");
  });
  it("2 days = the day after tomorrow", () => {
    expect(on(2).chilledUseBy).toBe("2026-10-12");
  });
  it("the default batch number is the production day", () => {
    expect(DEFAULT_TEMPLATE.batchBasis).toBe("production-day");
    const d = labelDates({ printDate: "2026-10-11", productionDate: "2026-10-10", chilled: { amount: 1, unit: "days" }, frozen: null, batchBasis: DEFAULT_TEMPLATE.batchBasis });
    expect(d.batchCode).toBe("26283"); // 10 Oct, not the 11th
    expect(d.chilledUseBy).toBe("2026-10-12"); // still counted from printing
  });
});

describe("labelDates", () => {
  const base = { printDate: "2026-10-10", productionDate: "2026-10-09", chilled: { amount: 13, unit: "days" as const }, frozen: { amount: 6, unit: "months" as const } };
  it("counts use-by from the print date", () => {
    const d = labelDates({ ...base, batchBasis: "production-day" });
    expect(d.chilledUseBy).toBe("2026-10-23");
    expect(d.frozenUseBy).toBe("2027-04-10");
  });
  it("takes the batch from the production day by default, or the print day", () => {
    expect(labelDates({ ...base, batchBasis: "production-day" }).batchCode).toBe("26282");
    expect(labelDates({ ...base, batchBasis: "print-day" }).batchCode).toBe("26283");
  });
  it("leaves a line off when there's no period", () => {
    expect(labelDates({ ...base, frozen: null, batchBasis: "print-day" }).frozenUseBy).toBeNull();
  });
});
