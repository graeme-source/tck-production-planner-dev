import { describe, expect, it } from "vitest";
import {
  averageOrderValue, getNetRevenue, getRefundTotal, isCountableOrder, isPaidOrder, newVsReturningTotals, orderHasTag, type RevenueOrder,
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

describe("newVsReturningTotals — the At a Glance 'New customers today' split", () => {
  const partRefund = (total: string, refund: string, tags: string) => order({
    total_price: total,
    financial_status: "partially_refunded",
    tags,
    refunds: [{ id: 1, created_at: "2026-10-21T10:00:00+01:00", transactions: [{ amount: refund, kind: "refund", status: "success" }] }],
  });
  const day = [
    order({ total_price: "40.00", tags: "2026-10-22, NEW-CUSTOMER" }),           // new (tag in caps)
    partRefund("50.00", "10.00", " new-customer , Small Box"),                  // new, £40 net
    order({ total_price: "30.10", tags: "Subscription Recurring Order" }),     // returning
    order({ total_price: "0.00", tags: "resend" }),                             // returning, £0
    order({ total_price: "99.00", tags: "new-customer", cancelled_at: "2026-10-21T11:00:00+01:00" }), // out
    order({ total_price: "25.00", tags: "new-customer", financial_status: "refunded" }),              // out
    order({ total_price: "12.00", tags: "new-customer-ish" }),                  // not the tag
  ];
  const t = newVsReturningTotals(day);

  it("leaves out cancelled and fully refunded orders, and takes partial refunds off", () => {
    expect(t.orders).toBe(5);
    expect(t.revenue).toBe(122.1);
    expect(t.newCustomerOrders).toBe(2);
    expect(t.newCustomerRevenue).toBe(80);
  });

  it("new + returning add up exactly to the day's totals (Today's Sales reconciles)", () => {
    expect(t.returningOrders).toBe(3);
    expect(t.returningRevenue).toBeCloseTo(42.1, 10);
    expect(t.newCustomerOrders + t.returningOrders).toBe(t.orders);
    expect(Math.round((t.newCustomerRevenue + t.returningRevenue) * 100)).toBe(Math.round(t.revenue * 100));
  });

  it("matches the tag case-insensitively and as a whole tag only", () => {
    expect(newVsReturningTotals([order({ tags: "New-Customer" })]).newCustomerOrders).toBe(1);
    expect(newVsReturningTotals([order({ tags: "new-customer-ish" })]).newCustomerOrders).toBe(0);
  });

  it("gives shares of revenue and of orders", () => {
    expect(t.newRevenueSharePercent).toBeCloseTo((80 / 122.1) * 100, 6);
    expect(t.newOrderSharePercent).toBe(40);
  });

  it("an empty day has no shares, not 0%", () => {
    const empty = newVsReturningTotals([]);
    expect(empty).toMatchObject({ orders: 0, revenue: 0, newCustomerOrders: 0, newRevenueSharePercent: null, newOrderSharePercent: null });
  });
});
