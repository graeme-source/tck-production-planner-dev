import { describe, it, expect } from "vitest";
import { payHistory } from "./pay-rate-history";

const h = (date: string, rate: number, type = "HourlyRate") => ({ date, rate, type });

describe("payHistory", () => {
  it("finds the last pay rise: the first day the current rate was paid after another", () => {
    const r = payHistory([h("2025-03-01", 11.44), h("2025-04-02", 12.21), h("2025-04-03", 12.21), h("2026-04-01", 12.75), h("2026-11-20", 12.75)]);
    expect(r).toEqual({
      currentRate: 12.75, lastChangeOn: "2026-04-01", previousRate: 12.21,
      changes: [{ date: "2025-04-02", from: 11.44, to: 12.21 }, { date: "2026-04-01", from: 12.21, to: 12.75 }],
    });
  });
  it("no rise when they've only ever been on one rate", () => {
    expect(payHistory([h("2025-05-01", 13), h("2026-11-01", 13)])).toMatchObject({ currentRate: 13, lastChangeOn: null, previousRate: null });
  });
  it("two groups on two rates alternating isn't a pay rise", () => {
    const r = payHistory([h("2026-01-01", 12.21), h("2026-01-02", 13.5), h("2026-01-03", 12.21), h("2026-01-04", 13.5)]);
    expect(r.lastChangeOn).toBe("2026-01-02");
    expect(r.changes).toHaveLength(1);
  });
  it("ignores salaried and zero-rate shifts, and copes with nothing", () => {
    expect(payHistory([h("2026-01-01", 0), h("2026-01-02", 30000, "MonthlySalary")]).currentRate).toBeNull();
    expect(payHistory([]).currentRate).toBeNull();
  });
});
