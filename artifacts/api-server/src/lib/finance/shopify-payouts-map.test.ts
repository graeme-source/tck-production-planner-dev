import { describe, it, expect } from "vitest";
import { payoutsFromGraphQL } from "./shopify-payouts-map";

const gbp = (amount: string) => ({ amount, currencyCode: "GBP" });

const fixture = {
  shopifyPaymentsAccount: {
    defaultCurrency: "GBP",
    balance: [gbp("812.40")],
    payouts: {
      nodes: [
        { id: "gid://shopify/ShopifyPaymentsPayout/5", issuedAt: "2026-10-27T23:30:00Z", status: "SCHEDULED", transactionType: "DEPOSIT", net: gbp("1523.18") },
        { id: "gid://shopify/ShopifyPaymentsPayout/4", issuedAt: "2026-10-24T09:00:00Z", status: "IN_TRANSIT", transactionType: "DEPOSIT", net: gbp("980.00") },
        { id: "gid://shopify/ShopifyPaymentsPayout/3", issuedAt: "2026-10-22T09:00:00Z", status: "PAID", transactionType: "DEPOSIT", net: gbp("2104.55") },
        { id: "gid://shopify/ShopifyPaymentsPayout/2", issuedAt: "2026-10-21T09:00:00Z", status: "FAILED", transactionType: "DEPOSIT", net: gbp("300.10") },
        { id: "gid://shopify/ShopifyPaymentsPayout/1", issuedAt: "2026-10-20T09:00:00Z", status: "PAID", transactionType: "WITHDRAWAL", net: gbp("45.99") },
      ],
    },
  },
};

describe("payoutsFromGraphQL", () => {
  it("maps scheduled, in transit, paid and failed payouts newest first", () => {
    const r = payoutsFromGraphQL(fixture);
    expect(r.payouts.map(p => [p.status, p.net])).toEqual([
      ["SCHEDULED", 1523.18],
      ["IN_TRANSIT", 980],
      ["PAID", 2104.55],
      ["FAILED", 300.1],
      ["PAID", -45.99],
    ]);
    expect(r.balance).toBe(812.4);
    expect(r.currency).toBe("GBP");
  });

  it("uses the London date, not UTC (23:30 UTC in BST is the next day)", () => {
    const r = payoutsFromGraphQL({
      shopifyPaymentsAccount: { payouts: { nodes: [{ id: "s", issuedAt: "2026-07-14T23:30:00Z", status: "SCHEDULED", net: gbp("10") }] } },
    });
    expect(r.payouts[0].date).toBe("2026-07-15");
    // After the clocks go back (25 Oct 2026) London = UTC.
    expect(payoutsFromGraphQL(fixture).payouts[0].date).toBe("2026-10-27");
  });

  it("keeps an already-negative net as-is", () => {
    const r = payoutsFromGraphQL({
      shopifyPaymentsAccount: {
        balance: [],
        payouts: { nodes: [{ id: "x", issuedAt: "2026-10-01T10:00:00Z", status: "PAID", transactionType: "WITHDRAWAL", net: gbp("-12.50") }] },
      },
    });
    expect(r.payouts[0].net).toBe(-12.5);
  });

  it("returns null balance when Shopify gives none, and falls back to payout currency", () => {
    const r = payoutsFromGraphQL({ data: { shopifyPaymentsAccount: { balance: [], payouts: { nodes: [fixture.shopifyPaymentsAccount.payouts.nodes[2]] } } } });
    expect(r.balance).toBeNull();
    expect(r.currency).toBe("GBP");
    expect(r.payouts).toHaveLength(1);
  });

  it("prefers the default-currency balance when there are several", () => {
    const r = payoutsFromGraphQL({ shopifyPaymentsAccount: { defaultCurrency: "GBP", balance: [{ amount: "5", currencyCode: "EUR" }, gbp("10")], payouts: { nodes: [] } } });
    expect(r).toEqual({ payouts: [], balance: 10, currency: "GBP" });
  });

  it("skips malformed rows and survives junk input", () => {
    const r = payoutsFromGraphQL({
      shopifyPaymentsAccount: {
        payouts: { nodes: [{ id: "a", issuedAt: "nope", status: "PAID", net: gbp("1") }, { id: "b", issuedAt: "2026-10-01T10:00:00Z", status: "WEIRD", net: gbp("1") }, null] },
      },
    });
    expect(r.payouts).toEqual([]);
    expect(payoutsFromGraphQL(null)).toEqual({ payouts: [], balance: null, currency: null });
    expect(payoutsFromGraphQL({ shopifyPaymentsAccount: null })).toEqual({ payouts: [], balance: null, currency: null });
  });
});
