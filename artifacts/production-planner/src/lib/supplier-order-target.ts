/**
 * Which order a new line for a supplier joins on the Orders page — the rules
 * behind "Add to order #N (due …)" / "Start a separate order" (fix-queue #194,
 * Jane, May 2026: "If ordering from the same supplier you can not choose for
 * items to come on 2 different days").
 *
 * A supplier can have several placed orders on one plan, each with its own
 * delivery date. The To Order view still shows at most ONE in-progress card
 * per supplier: either a new order, or one placed order reopened for editing.
 * Everything here keys placed orders by their id, never by supplier.
 */

/** The slice of a purchase order these rules read. */
export type OpenOrderLike = {
  id: number;
  supplierId: number;
  planId: number | null;
  status: string;
  expectedDeliveryDate: string | null;
};

/**
 * The supplier's placed (not yet received) orders on this plan, soonest
 * delivery first (orders with no date last, then oldest id first) — the
 * order the "Add to order #N" buttons are listed in.
 */
export function openOrdersForSupplier<T extends OpenOrderLike>(
  orders: readonly T[],
  supplierId: number,
  planId: number | null,
): T[] {
  return orders
    .filter(o => o.status === "placed" && o.supplierId === supplierId && o.planId === planId)
    .sort((a, b) => {
      const da = a.expectedDeliveryDate ?? "9999-12-31";
      const db = b.expectedDeliveryDate ?? "9999-12-31";
      return da === db ? a.id - b.id : da < db ? -1 : 1;
    });
}

export type SupplierCardState = {
  /** At least one placed order for this supplier on the plan. */
  placed: boolean;
  /** One of those orders is reopened for editing on the To Order tab. */
  reopened: boolean;
  /** The operator chose "Start a separate order" for this supplier. */
  separate: boolean;
  /** The calculation found new needs while the placed order is past the
   *  supplier's edit cutoff — they belong on a new order. */
  lockedOpenPo: boolean;
};

/**
 * Does the supplier have an in-progress card on the To Order tab? A supplier
 * with nothing placed always does (the normal single-order case, unchanged).
 * Once an order is placed the card hides — unless that order is being edited,
 * or a second, separate order is under way.
 */
export function showsPendingCard(s: SupplierCardState): boolean {
  return !s.placed || s.reopened || s.separate || s.lockedOpenPo;
}

export type OrderTarget<T> =
  /** Add straight to the supplier's in-progress card (new or reopened). */
  | { kind: "card" }
  /** Ask: add to one of these placed orders, or start a separate one. */
  | { kind: "choose"; orders: T[] };

/**
 * Where a line being added for a supplier goes. With an in-progress card, it
 * joins that card — no question asked. With no card and no placed order, it
 * starts the supplier's (first) order. With no card but placed orders, the
 * operator chooses.
 */
export function orderTargetFor<T>(hasPendingCard: boolean, openOrders: readonly T[]): OrderTarget<T> {
  if (hasPendingCard || openOrders.length === 0) return { kind: "card" };
  return { kind: "choose", orders: [...openOrders] };
}

export type PlacedOrderEditState =
  /** This exact order is open for editing on the To Order tab. */
  | "editing"
  /** Another order for the same supplier is in progress — finish it first. */
  | "supplier-busy"
  | "free";

/**
 * Per-order state for the Placed tab's "Edit order" / "New separate order"
 * buttons. Matches on the ORDER id: with two orders from one supplier,
 * editing one must not mark the other as being edited.
 */
export function placedOrderEditState(
  order: Pick<OpenOrderLike, "id" | "supplierId">,
  reopened: Readonly<Record<number, { id: number } | undefined>>,
  separateSupplierIds: ReadonlySet<number>,
): PlacedOrderEditState {
  const r = reopened[order.supplierId];
  if (r && r.id === order.id) return "editing";
  if (r || separateSupplierIds.has(order.supplierId)) return "supplier-busy";
  return "free";
}
