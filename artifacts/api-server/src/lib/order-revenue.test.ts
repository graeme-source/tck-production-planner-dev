import { describe, expect, it } from "vitest";
import {
  averageOrderValue, getNetRevenue, getRefundTotal, isCountableOrder, isPaidOrder, orderHasTag, type RevenueOrder,
} from "./order-revenue";

function order(over: Partial<RevenueOrder> = {}): RevenueOrder {
  return { cancelled_at: null, financial_status: "paid", total_price: "40.00", refunds: [], tags: "", ...over };
}

describe("isCountableOrder", () => {
  it("counts paid and partially refunded orders", () => {
    expect(isCountableOrder(order())).toBe(true);
    expect(isCountableOrder(order({ financial_status: "partially_refunded" }))).toBe(true);
  });
  it("drops cancelled, refunded and voided orders", () => {
    expect(isCountableOrder(order({ cancelled_at: "2026-09-24T10:00:00+01:00" }))).toBe(false);
    expect(isCountableOrder(order({ financial_status: "refunded" }))).toBe(false);
    expect(isCountableOrder(order({ financial_status: "voided" }))).toBe(false);
  });
});

describe("getNetRevenue", () => {
  it("subtracts only successful refund transactions", () => {
    const o = order({
      total_price: "50.00",
      refunds: [{
        id: 1,
        created_at: "2026-09-24T10:00:00+01:00",
        transactions: [
          { amount: "5.50", kind: "refund", status: "success" },
          { amount: "9.99", kind: "refund", status: "failure" },
          { amount: "3.00", kind: "sale", status: "success" },
        ],
      }],
    });
    expect(getRefundTotal(o)).toBeCloseTo(5.5);
    expect(getNetRevenue(o)).toBeCloseTo(44.5);
  });
  it("treats a missing price as zero", () => {
    expect(getNetRevenue(order({ total_price: "" }))).toBe(0);
  });
});

describe("AOV leaves out £0 orders (regression: £0 resend #135073 made an hour's AOV £0)", () => {
  const resend = order({ total_price: "0.00", tags: "2026-09-19, dispatch, resend, Small Box" });
  const paid = [order({ total_price: "45.00" }), order({ total_price: "55.00" })];

  it("a £0 resend still counts as an order, but not as a paid one", () => {
    expect(isCountableOrder(resend)).toBe(true);
    expect(isPaidOrder(resend)).toBe(false);
    expect(paid.every(isPaidOrder)).toBe(true);
  });

  it("an order refunded down to £0 isn't paid either", () => {
    const refundedToZero = order({
      total_price: "30.00",
      financial_status: "partially_refunded",
      refunds: [{ id: 1, created_at: "2026-09-19T10:00:00+01:00", transactions: [{ amount: "30.00", kind: "refund", status: "success" }] }],
    });
    expect(isPaidOrder(refundedToZero)).toBe(false);
  });

  it("AOV = revenue ÷ paid orders: £100 over two paid orders plus a resend is £50, not £33.33", () => {
    const all = [...paid, resend];
    const revenue = all.reduce((s, o) => s + getNetRevenue(o), 0);
    expect(averageOrderValue(revenue, all.filter(isPaidOrder).length)).toBe(50);
  });

  it("an hour whose only order is a £0 resend has no AOV, not £0", () => {
    expect(averageOrderValue(getNetRevenue(resend), [resend].filter(isPaidOrder).length)).toBeNull();
  });
});

describe("orderHasTag", () => {
  it("matches whole tags, trimmed and case-insensitively", () => {
    const o = order({ tags: "2026-09-25, New-Customer ,Subscription New Order" });
    expect(orderHasTag(o, "new-customer")).toBe(true);
    expect(orderHasTag(o, "subscription new order")).toBe(true);
    expect(orderHasTag(o, "new")).toBe(false);
  });
});
