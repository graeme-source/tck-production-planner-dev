/**
 * Hiding orders that are too young to act on.
 *
 * AfterSell holds a new order for up to 15 minutes while the customer decides
 * on post-purchase offers. During that window the order is doubly unsafe to
 * touch: Shopify has its fulfilment on hold, AND the upsell can still ADD
 * ITEMS — so even a hold-status check wouldn't stop a packer boxing the
 * pre-upsell contents, or a consignment being booked at the pre-upsell
 * weight.
 *
 * Rather than querying hold status per order (an extra fulfillment-orders
 * call per row, and blind to the contents problem), we use age: an order
 * received more than 15 minutes ago has, by definition, come off hold and
 * stopped changing (Graeme, 2026-08-21).
 *
 * Applied to the picking list, the scan queue and batch booking. Deliberately
 * NOT applied to stock predictions (lib/remaining-fulfilment.ts): a
 * fifteen-minute-old order's packs still leave the fridge today, so hiding it
 * there would overstate the Factory Number.
 */

/** How long AfterSell can hold an order. */
export const ORDER_SETTLE_MINUTES = 15;

/** True once an order is old enough that AfterSell can no longer be holding
 *  or amending it. Unparseable dates count as settled — hiding an order
 *  forever because of a bad timestamp is the worse failure. */
export function isSettledOrder(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!createdAt) return true;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return true;
  return now.getTime() - created >= ORDER_SETTLE_MINUTES * 60_000;
}

/** The settled subset of a list of orders. */
export function settledOrders<T extends { created_at?: string | null }>(
  orders: T[],
  now: Date = new Date(),
): T[] {
  return orders.filter(o => isSettledOrder(o.created_at, now));
}
