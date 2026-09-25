/**
 * What an order is worth on the founder Numbers page, and whether it counts.
 *
 * These rules used to live privately inside routes/shopify.ts. They moved
 * here (pure, no I/O) so the Numbers tiles and the trend graphs behind them
 * share ONE definition — a graph whose line summed to a different figure
 * than the tile above it would be worse than no graph at all.
 *
 *   counts      not cancelled, and not fully refunded or voided
 *   revenue     total_price minus successful refund transactions ("net")
 *   tags        comma-separated, matched case-insensitively and trimmed
 *
 * (routes/pnl.ts and lib/pnl-calculator.ts still carry their own copies of
 * the first two rules — a known duplicate, not consolidated here.)
 */
import type { ShopifyOrder } from "../services/shopify";

/** Just the fields these rules read, so tests can build small orders. */
export type RevenueOrder = Pick<ShopifyOrder, "cancelled_at" | "financial_status" | "total_price" | "refunds" | "tags">;

const EXCLUDED_FINANCIAL = new Set(["refunded", "voided"]);

// The Shopify tags that mark each customer type (set by the storefront and
// the subscription app — they are Shopify's words, not product names).
export const NEW_CUSTOMER_TAG = "new-customer";
export const RECURRING_SUB_TAG = "Subscription Recurring Order";
export const NEW_SUB_TAG = "Subscription New Order";
export const WHOLESALE_TAG = "wholesale";

/** The four customer-type tags the Numbers page groups orders by. */
export const CUSTOMER_TYPE_TAGS = [NEW_CUSTOMER_TAG, RECURRING_SUB_TAG, NEW_SUB_TAG, WHOLESALE_TAG] as const;

export type CustomerTypeTag = (typeof CUSTOMER_TYPE_TAGS)[number];

/** Both subscription tags together make up "subscription revenue". */
export const SUBSCRIPTION_TAGS: readonly CustomerTypeTag[] = [RECURRING_SUB_TAG, NEW_SUB_TAG];

export function isCountableOrder(o: Pick<RevenueOrder, "cancelled_at" | "financial_status">): boolean {
  if (o.cancelled_at) return false;
  if (EXCLUDED_FINANCIAL.has(o.financial_status)) return false;
  return true;
}

export function getRefundTotal(o: Pick<RevenueOrder, "refunds">): number {
  if (!o.refunds || o.refunds.length === 0) return 0;
  return o.refunds.reduce((sum, r) => {
    if (!r.transactions) return sum;
    return sum + r.transactions
      .filter(t => t.kind === "refund" && t.status === "success")
      .reduce((s, t) => s + parseFloat(t.amount || "0"), 0);
  }, 0);
}

export function getNetRevenue(o: Pick<RevenueOrder, "total_price" | "refunds">): number {
  const total = parseFloat(o.total_price || "0");
  return total - getRefundTotal(o);
}

/**
 * Did the order bring in money? Net revenue above zero (to the penny).
 *
 * £0 orders are real — resends and replacements go out at a 100% discount
 * (tag "resend"), about 70 in 90 days — so they still count as ORDERS. But
 * they aren't baskets anyone paid for, and letting them into AOV dragged it
 * down: one £0 resend alone in an hour made that hour's AOV £0 (Graeme,
 * 2026-09-25, "AOV looks a little bit unusual").
 */
export function isPaidOrder(o: Pick<RevenueOrder, "total_price" | "refunds">): boolean {
  return Math.round(getNetRevenue(o) * 100) > 0;
}

/**
 * Average order value, everywhere on the Numbers page:
 *
 *     AOV = net revenue ÷ PAID orders (isPaidOrder)
 *
 * £0 orders add nothing to revenue and are left out of the divisor. null
 * when there are no paid orders — "no baskets", never £0.
 */
export function averageOrderValue(revenue: number, paidOrders: number): number | null {
  return paidOrders > 0 ? revenue / paidOrders : null;
}

/** The order's tags, trimmed and lower-cased. */
export function orderTags(o: Pick<RevenueOrder, "tags">): string[] {
  return (o.tags ?? "").split(",").map(t => t.trim().toLowerCase());
}

/** True when the order carries `tag` (case-insensitive, whole tag only). */
export function orderHasTag(o: Pick<RevenueOrder, "tags">, tag: string): boolean {
  return orderTags(o).includes(tag.toLowerCase());
}
