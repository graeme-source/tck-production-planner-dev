import { describe, expect, it } from "vitest";
import { sentOutRevenue, type SentOutInput } from "./sent-out-revenue";
import type { ShopifyOrderPayload } from "./payroll/month-end";

let nextId = 1;
const order = (p: Partial<ShopifyOrderPayload> & { created_at: string }, extra: Omit<SentOutInput, "payload"> = {}): SentOutInput => ({
  payload: {
    id: nextId++, name: "#1", cancelled_at: null, financial_status: "paid", fulfillment_status: "fulfilled",
    total_price: "50.00", total_tax: "0.00", tags: "", line_items: [{ requires_shipping: true }], refunds: [], fulfillments: [],
    ...p,
  },
  ...extra,
});
const shipped = (at: string, p: Partial<ShopifyOrderPayload> = {}) =>
  order({ created_at: "2026-09-20T10:00:00+01:00", fulfillments: [{ created_at: at, status: "success" }], ...p });
const sep = (...o: SentOutInput[]) => sentOutRevenue("2026-09", o, "2026-10-15");

describe("revenue sent out — which month an order counts in", () => {
  it("counts an order in the month it was packed, not the month it was paid", () => {
    const r = sep(
      shipped("2026-09-02T09:00:00+01:00", { created_at: "2026-08-28T10:00:00+01:00", total_price: "40.00" }),
      shipped("2026-10-01T09:00:00+01:00", { created_at: "2026-09-29T10:00:00+01:00", total_price: "70.00" }),
    );
    expect(r.orders).toBe(1);
    expect(r.incVat).toBe(40);
    expect(r.firstDay).toBe("2026-09-02");
  });

  it("uses the London day: 23:30 UTC on 30 Sep is 1 Oct in summer time", () => {
    expect(sep(shipped("2026-09-30T23:30:00Z")).orders).toBe(0);
    expect(sep(shipped("2026-09-30T22:30:00Z")).orders).toBe(1);
  });

  it("falls back to the app's fulfil record, then the APC collection date", () => {
    const r = sep(
      order({ created_at: "2026-09-10T10:00:00+01:00", fulfillments: null }, { appFulfilledAt: "2026-09-11T07:00:00Z" }),
      order({ created_at: "2026-09-10T10:00:00+01:00", fulfillments: null }, { apcCollectionDate: "2026-09-12" }),
    );
    expect(r.orders).toBe(2);
    expect(r.bySource.app.orders).toBe(1);
    expect(r.bySource.apc.orders).toBe(1);
  });

  it("estimates from the delivery-date tag only for a fulfilled order with no date anywhere", () => {
    const r = sep(order({ created_at: "2026-09-10T10:00:00+01:00", fulfillments: null, tags: "2026-09-16" }));
    expect(r.orders).toBe(1);
    expect(r.bySource.estimate.orders).toBe(1);
    expect(r.lastDay).toBe("2026-09-15");
  });

  it("doesn't count an order not sent yet", () => {
    expect(sep(order({ created_at: "2026-09-29T10:00:00+01:00", fulfillment_status: null, fulfillments: [] })).orders).toBe(0);
  });
});

describe("revenue sent out — what an order is worth", () => {
  it("takes refunds off, whenever they were made", () => {
    const r = sep(shipped("2026-09-15T09:00:00+01:00", {
      total_price: "60.00", financial_status: "partially_refunded",
      refunds: [{ created_at: "2026-10-03T09:00:00+01:00", transactions: [{ kind: "refund", status: "success", amount: "12.50" }] }],
    }));
    expect(r.incVat).toBe(47.5);
    expect(r.refunds).toBe(12.5);
  });

  it("leaves out sent orders since cancelled or refunded in full, and says so", () => {
    const r = sep(
      shipped("2026-09-15T09:00:00+01:00", { cancelled_at: "2026-09-16T09:00:00+01:00" }),
      shipped("2026-09-15T09:00:00+01:00", { financial_status: "refunded" }),
    );
    expect(r.orders).toBe(0);
    expect(r.incVat).toBe(0);
    expect(r.cancelled.orders).toBe(2);
  });

  it("counts wholesale orders on payment terms (still pending) and £0 resends", () => {
    const r = sep(
      shipped("2026-09-15T09:00:00+01:00", { financial_status: "pending", total_price: "420.00", tags: "wholesale" }),
      shipped("2026-09-15T09:00:00+01:00", { total_price: "0.00", tags: "resend" }),
    );
    expect(r.orders).toBe(2);
    expect(r.incVat).toBe(420);
  });

  it("never counts gift cards or memberships — nothing is sent", () => {
    const r = sep(order({ created_at: "2026-09-10T10:00:00+01:00", line_items: [{ requires_shipping: false }], total_price: "25.00" }));
    expect(r.orders).toBe(0);
    expect(r.nothingToSend).toEqual({ orders: 1, incVat: 25 });
  });

  it("works out ex VAT from the order's own tax", () => {
    const r = sep(shipped("2026-09-15T09:00:00+01:00", { total_price: "120.00", total_tax: "20.00" }));
    expect(r.incVat).toBe(120);
    expect(r.exVat).toBe(100);
  });

  it("adds up in pence and counts each order once", () => {
    const a = shipped("2026-09-15T09:00:00+01:00", { total_price: "0.10" });
    const r = sep(a, a, shipped("2026-09-15T09:00:00+01:00", { total_price: "0.20" }));
    expect(r.orders).toBe(2);
    expect(r.incVat).toBe(0.3);
  });
});

describe("revenue sent out — the month itself", () => {
  it("runs to today while the month is open", () => {
    const r = sentOutRevenue("2026-10", [], "2026-10-30");
    expect(r.through).toBe("2026-10-30");
    expect(r.complete).toBe(false);
    expect(sentOutRevenue("2026-09", [], "2026-10-30").complete).toBe(true);
  });
});
