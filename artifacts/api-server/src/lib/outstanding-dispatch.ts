/**
 * Orders still to go out — the packing station's closing question, answered
 * from live data instead of by asking a human to go and look.
 *
 * The closing check used to read "if there are more orders to dispatch, check
 * …" every single day, whether or not there were any. A check that is usually
 * a no-op teaches people to tick without reading, which is exactly what you do
 * not want on a closing list. So the app answers it: the check only appears
 * when orders are genuinely outstanding, and names them (Graeme, 2026-09-17).
 *
 * "Outstanding" = unfulfilled orders on TOMORROW's delivery tag. Packing today
 * dispatches for tomorrow, the same dispatch-day + 1 rule the packing
 * boxes-per-hour KPI uses.
 */
import { getUnfulfilledOrdersByTag, type ShopifyOrder } from "../services/shopify";
import { londonDateString } from "./london-time";
import { deliveryTagFor } from "./outstanding-dispatch-rules";

export { deliveryTagFor, showOutstandingCheck } from "./outstanding-dispatch-rules";

/** The dynamic_data_type that marks a checklist item as "only when there is
 *  something still to send". */
export const OUTSTANDING_DISPATCH_TYPE = "outstanding_dispatch_orders";

export interface OutstandingDispatch {
  tag: string;
  count: number;
  orders: Array<{ id: number; name: string; customer: string | null; itemCount: number }>;
}

export async function getOutstandingDispatch(dispatchDateIso?: string): Promise<OutstandingDispatch> {
  const tag = deliveryTagFor(dispatchDateIso ?? londonDateString());
  const orders: ShopifyOrder[] = await getUnfulfilledOrdersByTag(tag);
  return {
    tag,
    count: orders.length,
    orders: orders.map(o => ({
      id: o.id,
      name: o.name,
      customer: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || null,
      itemCount: (o.line_items ?? []).reduce((n, li) => n + (li.quantity ?? 0), 0),
    })),
  };
}
