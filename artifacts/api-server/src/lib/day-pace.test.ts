import { describe, expect, it } from "vitest";
import { buildDayPace } from "./day-pace";

const order = (id: number, at: string, total: number, tags = "") => ({
  id, created_at: at, cancelled_at: null, financial_status: "paid", total_price: String(total), refunds: [], tags,
}) as never;

describe("buildDayPace", () => {
  const curves = buildDayPace([
    order(1, "2026-11-02T09:30:00Z", 100, "new-customer"),
    order(2, "2026-11-02T14:00:00Z", 300, "new-customer"),
    order(3, "2026-11-03T14:30:00Z", 100),
  ]);

  it("says how much of a day has usually come in by each hour, in London time", () => {
    expect(curves["sales"]![8]).toBe(0);
    expect(curves["sales"]![9]).toBe(0.2);
    expect(curves["sales"]![14]).toBe(1);
    expect(curves["sales"]![23]).toBe(1);
  });

  it("keeps each figure's own pattern", () => {
    expect(curves["newCustomerRevenue"]![9]).toBe(0.25);
    expect(curves["newCustomers"]![9]).toBe(0.5);
  });

  it("leaves out a figure with nothing to go on", () => {
    expect(curves["newSubs"]).toBeUndefined();
  });

  it("counts an order once", () => {
    const one = order(1, "2026-11-02T09:30:00Z", 100);
    expect(buildDayPace([one, one])["sales"]![9]).toBe(1);
  });
});
