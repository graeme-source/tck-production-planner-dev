/**
 * "Ordered today" rule for the Orders page (Fix queue #351 / #384, Graeme,
 * Nov 2026): "if we've placed an order that day, it shouldn't come back up
 * that day unless we manually choose to add it back in again by adding a
 * supplier order."
 *
 * A supplier we placed an order with today gets NO automatic card on
 * /orders/calculate today — no suggested lines, no "past its cutoff, new
 * separate order" lines, no pulled kanbans, no queued test production. The
 * team brings it back by hand ("Add supplier order", or tapping the name in
 * the page's "Ordered today" line). Tomorrow the normal maths resumes.
 *
 * Pure — the route loads the purchase orders and passes London's today.
 * Objective B.
 */

/** Statuses of an order that has really been placed with the supplier.
 *  Drafts were never sent; anything else (e.g. a future 'cancelled') isn't
 *  an order the supplier is fulfilling. */
export const PLACED_ORDER_STATUSES = ["placed", "partially_received", "received"] as const;

export interface PurchaseOrderForToday {
  id: number;
  supplierId: number;
  supplierName: string | null;
  status: string;
  /** When it was placed (or last re-sent from the Orders page). */
  placedAt: Date | null;
  /** 'planned' (raised from Orders) or 'unexpected' (logged at the door
   *  when goods arrived without an order — not an order we placed). */
  origin: string | null;
}

export interface OrderedTodaySupplier {
  supplierId: number;
  supplierName: string;
  /** The orders placed with them today, oldest first. */
  orderIds: number[];
}

/** Was this order placed with the supplier on London's `today`? */
export function placedOnDay(
  po: PurchaseOrderForToday,
  today: string,
  toLondonDate: (d: Date) => string,
): boolean {
  if (!po.placedAt) return false;
  if (!(PLACED_ORDER_STATUSES as readonly string[]).includes(po.status)) return false;
  if (po.origin === "unexpected") return false;
  return toLondonDate(po.placedAt) === today;
}

/** The suppliers ordered from today, A–Z, each with today's order numbers. */
export function suppliersOrderedToday(
  orders: readonly PurchaseOrderForToday[],
  today: string,
  toLondonDate: (d: Date) => string,
): OrderedTodaySupplier[] {
  const bySupplier = new Map<number, OrderedTodaySupplier>();
  for (const po of orders) {
    if (!placedOnDay(po, today, toLondonDate)) continue;
    const entry = bySupplier.get(po.supplierId)
      ?? { supplierId: po.supplierId, supplierName: po.supplierName ?? `Supplier #${po.supplierId}`, orderIds: [] };
    if (!entry.orderIds.includes(po.id)) entry.orderIds.push(po.id);
    bySupplier.set(po.supplierId, entry);
  }
  for (const e of bySupplier.values()) e.orderIds.sort((a, b) => a - b);
  return [...bySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}
