import { describe, expect, it } from "vitest";
import { orderAverages, type AveragedOrder } from "./order-averages";

const o = (revenue: number, orderProfit: number, margin: number | null, items = 6): AveragedOrder => ({
  items, revenue, shippingCharged: 0, discounts: 0, productCost: 10, boxCost: 2.5, courier: 4.72, paymentFees: 1, orderProfit, contributionMargin: margin,
});

describe("Every order — average row", () => {
  it("averages each column and the orders' margins", () => {
    const a = orderAverages([o(100, 60, 60), o(50, 20, 40, 3)]);
    expect(a.count).toBe(2);
    expect(a.values!.revenue).toBe(75);
    expect(a.values!.orderProfit).toBe(40);
    expect(a.values!.items).toBe(4.5);
    expect(a.margin).toBe(50);
  });
  it("leaves out £0 resends", () => {
    const a = orderAverages([o(100, 60, 60), o(0, -10, null)]);
    expect(a.count).toBe(1);
    expect(a.values!.revenue).toBe(100);
    expect(a.margin).toBe(60);
  });
  it("nothing to average", () => {
    expect(orderAverages([])).toEqual({ count: 0, values: null, margin: null });
  });
});
