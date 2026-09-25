import { describe, expect, it } from "vitest";
import { getNetRevenue, getRefundTotal, isCountableOrder, orderHasTag, type RevenueOrder } from "./order-revenue";

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

describe("orderHasTag", () => {
  it("matches whole tags, trimmed and case-insensitively", () => {
    const o = order({ tags: "2026-09-25, New-Customer ,Subscription New Order" });
    expect(orderHasTag(o, "new-customer")).toBe(true);
    expect(orderHasTag(o, "subscription new order")).toBe(true);
    expect(orderHasTag(o, "new")).toBe(false);
  });
});
