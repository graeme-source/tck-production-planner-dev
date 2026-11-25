/**
 * The "Average" row at the top of Order Analysis → Every order (Graeme,
 * 25 Nov 2026: "as soon as I get to the top, I can easily see the average of
 * all of the relevant columns … specifically margin … the average of the
 * last 200 orders"). Averages the orders on screen; £0 orders (resends)
 * are left out, as they're left out of the colours. Margin is the plain
 * average of each order's margin. Pure.
 */
export const AVERAGED = ["items", "revenue", "shippingCharged", "discounts", "productCost", "boxCost", "courier", "paymentFees", "orderProfit"] as const;
export type AveragedKey = (typeof AVERAGED)[number];

export interface AveragedOrder extends Record<AveragedKey, number> {
  contributionMargin: number | null;
}

export interface OrderAverages {
  /** Orders averaged (resends left out). */
  count: number;
  values: Record<AveragedKey, number> | null;
  /** Average of the orders' margins, as a %; null when none have one. */
  margin: number | null;
}

export function orderAverages(orders: readonly AveragedOrder[]): OrderAverages {
  const counted = orders.filter(o => o.revenue !== 0);
  if (counted.length === 0) return { count: 0, values: null, margin: null };
  const values = Object.fromEntries(AVERAGED.map(k => [k, counted.reduce((s, o) => s + o[k], 0) / counted.length])) as Record<AveragedKey, number>;
  const margins = counted.map(o => o.contributionMargin).filter((m): m is number => m != null && Number.isFinite(m));
  return { count: counted.length, values, margin: margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : null };
}
