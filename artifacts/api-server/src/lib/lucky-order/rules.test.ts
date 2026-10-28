import { describe, it, expect } from "vitest";
import {
  orderNumberFromName, luckyTier, winningTier, disqualified, offerLiveAt, windowStart,
  refundNeedsApproval, subscriptionCodeFor, initialStatuses, isWebsiteOrRenewal, subscriptionDiscountInput, practiceCodeFor,
  type OfferWindow, type OrderFacts,
} from "./rules";

const on: OfferWindow = { enabled: true, startsAt: "2026-10-28T00:00:00Z", endsAt: "2026-11-04T00:00:00Z", activatedAt: "2026-10-27T12:00:00Z" };
const order = (name: string, over: Partial<OrderFacts> = {}): OrderFacts => ({
  name, createdAt: "2026-10-29T10:00:00Z", sourceName: "web", tags: [], cancelledAt: null, ...over,
});

describe("luckyTier", () => {
  it("ends in 0 wins the gift", () => expect(luckyTier(138110)).toBe("gift"));
  it("ends in 00 wins gift + refund", () => expect(luckyTier(138100)).toBe("gift_refund"));
  it("ends in 000 wins only the subscription year", () => expect(luckyTier(138000)).toBe("subscription"));
  it("anything else wins nothing", () => expect(luckyTier(138101)).toBeNull());
});

describe("orderNumberFromName", () => {
  it("reads Shopify order names", () => expect(orderNumberFromName("#138100")).toBe(138100));
  it("copes with no number", () => expect(orderNumberFromName("draft")).toBeNull());
});

describe("which orders qualify", () => {
  it("website orders and subscription renewals", () => {
    expect(isWebsiteOrRenewal("web")).toBe(true);
    expect(isWebsiteOrRenewal("subscription_contract_checkout_one")).toBe(true);
    expect(isWebsiteOrRenewal("shopify_draft_order")).toBe(false);
    expect(isWebsiteOrRenewal(null)).toBe(false);
  });

  it("a renewal can win", () => {
    expect(winningTier(order("#138100", { sourceName: "subscription_contract_checkout_one" }), on)).toBe("gift_refund");
  });

  it("wholesale never wins, and the prize doesn't roll on", () => {
    expect(disqualified(order("#138100", { tags: ["Wholesale"] }), on)).toBe("wholesale");
    expect(winningTier(order("#138100", { tags: ["wholesale"] }), on)).toBeNull();
    expect(winningTier(order("#138101"), on)).toBeNull();
  });

  it("draft / other channels and cancelled orders don't win", () => {
    expect(winningTier(order("#138110", { sourceName: "shopify_draft_order" }), on)).toBeNull();
    expect(winningTier(order("#138110", { cancelledAt: "2026-10-29T11:00:00Z" }), on)).toBeNull();
  });
});

describe("the offer window", () => {
  it("is off when switched off", () => {
    expect(offerLiveAt({ ...on, enabled: false }, new Date("2026-10-29T10:00:00Z"))).toBe(false);
  });

  it("starts at the later of the start time and when it was switched on", () => {
    expect(windowStart({ ...on, activatedAt: "2026-10-30T09:00:00Z" })).toBe("2026-10-30T09:00:00.000Z");
    expect(winningTier(order("#138110", { createdAt: "2026-10-29T10:00:00Z" }), { ...on, activatedAt: "2026-10-30T09:00:00Z" })).toBeNull();
  });

  it("orders before the start or at/after the end don't win", () => {
    expect(winningTier(order("#138110", { createdAt: "2026-10-27T23:59:59Z" }), on)).toBeNull();
    expect(winningTier(order("#138110", { createdAt: "2026-11-04T00:00:00Z" }), on)).toBeNull();
    expect(winningTier(order("#138110"), on)).toBe("gift");
  });

  it("an open-ended offer runs from when it was switched on", () => {
    const open: OfferWindow = { enabled: true, startsAt: null, endsAt: null, activatedAt: "2026-10-27T12:00:00Z" };
    expect(winningTier(order("#138110", { createdAt: "2026-12-25T10:00:00Z" }), open)).toBe("gift");
  });
});

describe("refunds and codes", () => {
  it("refunds over £100 wait for approval; £100 exactly goes through", () => {
    expect(refundNeedsApproval(100, 100)).toBe(false);
    expect(refundNeedsApproval(100.01, 100)).toBe(true);
  });

  it("the same order always gets the same code", () => {
    const a = subscriptionCodeFor("gid://shopify/Order/1", 138000, "s");
    expect(a).toBe(subscriptionCodeFor("gid://shopify/Order/1", 138000, "s"));
    expect(a).toMatch(/^LUCKYYEAR-138000-[0-9A-F]{6}$/);
    expect(a).not.toBe(subscriptionCodeFor("gid://shopify/Order/2", 138000, "s"));
  });

  it("practice mode marks every step practice; real mode pending", () => {
    expect(initialStatuses("gift_refund", true)).toEqual({ giftStatus: "practice", refundStatus: "practice", codeStatus: "n/a", emailStatus: "practice" });
    expect(initialStatuses("subscription", false)).toEqual({ giftStatus: "n/a", refundStatus: "n/a", codeStatus: "pending", emailStatus: "pending" });
  });
});

describe("the 000 subscription code's Shopify settings", () => {
  const d = subscriptionDiscountInput({ title: "t", code: "LUCKYYEAR-TEST-ABC123", customerId: "gid://shopify/Customer/1", startsAt: "2026-10-28T10:00:00Z", amount: 75, cycles: 6 });
  it("is one use, for that customer only, on subscriptions only", () => {
    expect(d.context).toEqual({ customers: { add: ["gid://shopify/Customer/1"] } });
    expect(d.usageLimit).toBe(1);
    expect(d.appliesOncePerCustomer).toBe(true);
    expect(d.customerGets.appliesOnSubscription).toBe(true);
    expect(d.customerGets.appliesOnOneTimePurchase).toBe(false);
  });
  it("takes £75 off each of the first 6 subscription orders and doesn't stack", () => {
    expect(d.customerGets.value).toEqual({ discountAmount: { amount: "75.00", appliesOnEachItem: false } });
    expect(d.recurringCycleLimit).toBe(6);
    expect(d.combinesWith).toEqual({ orderDiscounts: false, productDiscounts: false, shippingDiscounts: true });
  });
  it("practice codes are clearly tests", () => {
    expect(practiceCodeFor("a1b2c3d4")).toBe("LUCKYYEAR-TEST-A1B2C3");
  });
});
