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

/** The four customer-type tags the Numbers page groups orders by. */
export const CUSTOMER_TYPE_TAGS = [
  "new-customer",
  "Subscription Recurring Order",
  "Subscription New Order",
  "wholesale",
] as const;

export type CustomerTypeTag = (typeof CUSTOMER_TYPE_TAGS)[number];

/** Both subscription tags together make up "subscription revenue". */
export const SUBSCRIPTION_TAGS: readonly CustomerTypeTag[] = ["Subscription Recurring Order", "Subscription New Order"];

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

/** The order's tags, trimmed and lower-cased. */
export function orderTags(o: Pick<RevenueOrder, "tags">): string[] {
  return (o.tags ?? "").split(",").map(t => t.trim().toLowerCase());
}

/** True when the order carries `tag` (case-insensitive, whole tag only). */
export function orderHasTag(o: Pick<RevenueOrder, "tags">, tag: string): boolean {
  return orderTags(o).includes(tag.toLowerCase());
}
