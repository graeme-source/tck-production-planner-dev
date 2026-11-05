/**
 * How a normal day builds up (Graeme, 5 Nov 2026): for each Numbers figure, the
 * share that has usually come in by the end of each London hour, so £1,000 of
 * new-customer revenue by midday can be read against how the day normally goes.
 * Orders are filtered and valued by the same rules as the tiles. Pure, tested.
 */
import type { ShopifyOrder } from "../services/shopify";
import { getNetRevenue, isCountableOrder, orderHasTag, NEW_CUSTOMER_TAG, NEW_SUB_TAG, RECURRING_SUB_TAG, SUBSCRIPTION_TAGS } from "./order-revenue";
import { londonHour } from "./london-time";

type PaceOrder = Pick<ShopifyOrder, "id" | "created_at" | "cancelled_at" | "financial_status" | "total_price" | "refunds" | "tags">;

const FIGURES: Record<string, (o: PaceOrder) => number> = {
  sales: o => getNetRevenue(o),
  newCustomers: o => (orderHasTag(o, NEW_CUSTOMER_TAG) ? 1 : 0),
  newCustomerRevenue: o => (orderHasTag(o, NEW_CUSTOMER_TAG) ? getNetRevenue(o) : 0),
  recurringSubs: o => (orderHasTag(o, RECURRING_SUB_TAG) ? 1 : 0),
  newSubs: o => (orderHasTag(o, NEW_SUB_TAG) ? 1 : 0),
  subscriptionRevenue: o => (SUBSCRIPTION_TAGS.some(tag => orderHasTag(o, tag)) ? getNetRevenue(o) : 0),
};

/** Each figure's running share by the end of hour 0–23. A figure with nothing
 *  in the window is left out, so the page falls back on the clock. */
export function buildDayPace(orders: PaceOrder[]): Record<string, number[]> {
  const unique = [...new Map(orders.map(o => [o.id, o])).values()].filter(isCountableOrder);
  const out: Record<string, number[]> = {};
  for (const [kpi, value] of Object.entries(FIGURES)) {
    const hours = new Array<number>(24).fill(0);
    for (const o of unique) {
      const ms = Date.parse(o.created_at);
      if (Number.isFinite(ms)) hours[londonHour(new Date(ms))]! += value(o);
    }
    const total = hours.reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    let running = 0;
    out[kpi] = hours.map(v => { running += v; return Math.round((running / total) * 10_000) / 10_000; });
  }
  return out;
}
