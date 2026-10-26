import { describe, it, expect } from "vitest";
import { payPeriodFor, previousPayPeriods, payPeriodLabel } from "./period";

describe("payPeriodFor — 25th of last month to 24th of this month", () => {
  it("a date before the 25th belongs to the period ending this month", () => {
    expect(payPeriodFor("2026-10-10")).toEqual({ from: "2026-09-25", to: "2026-10-24", label: "25 Sep – 24 Oct 2026" });
  });
  it("the 24th is the last day, the 25th starts the next period", () => {
    expect(payPeriodFor("2026-10-24").to).toBe("2026-10-24");
    expect(payPeriodFor("2026-10-25")).toEqual({ from: "2026-10-25", to: "2026-11-24", label: "25 Oct – 24 Nov 2026" });
  });
  it("spans New Year with both years in the label", () => {
    expect(payPeriodFor("2027-01-03")).toEqual({ from: "2026-12-25", to: "2027-01-24", label: "25 Dec 2026 – 24 Jan 2027" });
    expect(payPeriodFor("2026-12-31").from).toBe("2026-12-25");
  });
  it("handles February", () => {
    expect(payPeriodFor("2028-02-29")).toEqual({ from: "2028-02-25", to: "2028-03-24", label: "25 Feb – 24 Mar 2028" });
  });
  it("rejects a non-date", () => {
    expect(() => payPeriodFor("yesterday")).toThrow();
  });
});

describe("previousPayPeriods", () => {
  it("lists the finished periods before today's, newest first", () => {
    const p = previousPayPeriods("2026-10-26", 3);
    expect(p.map(x => [x.from, x.to])).toEqual([
      ["2026-09-25", "2026-10-24"],
      ["2026-08-25", "2026-09-24"],
      ["2026-07-25", "2026-08-24"],
    ]);
  });
  it("crosses the year boundary", () => {
    const p = previousPayPeriods("2027-01-10", 2);
    expect(p[0].label).toBe("25 Nov – 24 Dec 2026");
    expect(p[1].label).toBe("25 Oct – 24 Nov 2026");
  });
  it("n = 0 gives nothing", () => {
    expect(previousPayPeriods("2026-10-26", 0)).toEqual([]);
  });
  it("label helper", () => {
    expect(payPeriodLabel("2026-09-25", "2026-10-24")).toBe("25 Sep – 24 Oct 2026");
  });
});
