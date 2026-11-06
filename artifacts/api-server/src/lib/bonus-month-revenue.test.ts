import { describe, expect, it } from "vitest";
import { monthDays, monthRevenue } from "./bonus-month-revenue";

const order = (id: number, total: string, over: object = {}) => ({
  id, total_price: total, financial_status: "paid", cancelled_at: null, refunds: [], ...over,
}) as never;

describe("monthDays", () => {
  it("covers a whole finished month", () => {
    expect(monthDays("2026-10", "2026-11-06")).toEqual({ from: "2026-10-01", to: "2026-10-31", complete: true });
    expect(monthDays("2026-02", "2026-11-06").to).toBe("2026-02-28");
  });

  it("stops at today while the month is running", () => {
    expect(monthDays("2026-11", "2026-11-06")).toEqual({ from: "2026-11-01", to: "2026-11-06", complete: false });
  });
});

describe("monthRevenue", () => {
  it("adds up the month's sales, counting an order once", () => {
    const one = order(1, "59.10");
    expect(monthRevenue([one, one, order(2, "40.90")])).toEqual({ total: 100, orders: 2 });
  });

  it("leaves out cancelled orders", () => {
    expect(monthRevenue([order(1, "50.00"), order(2, "50.00", { cancelled_at: "2026-11-02T10:00:00Z" })]).total).toBe(50);
  });
});
