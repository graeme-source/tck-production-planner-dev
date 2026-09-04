import { calcExpectedDeliveryDate } from "@workspace/business-days";

/** The delivery-relevant slice of a supplier record. */
export type SupplierDeliveryInfo = {
  leadTimeDays?: number;
  cutoffTime?: string;
};

/** A supplier card as rendered on the orders page. */
export type DeliverySupplierCard = {
  supplier: { id: number } & SupplierDeliveryInfo;
};

/**
 * Resolve the expected delivery date for a supplier on the orders page.
 *
 * Order of truth: an operator-set date wins; then the rendered card; then the
 * supplier directory (/api/suppliers), which knows every supplier whether or
 * not it has a card right now.
 *
 * The directory fallback is the point of this helper. Supplier cards come from
 * two places — the DPT calculation and the client-side kanban-only /
 * manually-added list — and packaging suppliers (Puffin, Thergis, Macfarlane)
 * only ever appear in the second: their items are in no recipe and aren't
 * stock-checked. Placing an order used to re-look-up the supplier in the
 * calculated list alone, find nothing, and fall back to a 1-day lead time, so
 * the card showed the correct 2-day date while the order was booked for next
 * day. Resolving from one function over every source stops that diverging.
 */
export function resolveDeliveryDate(
  supplierId: number,
  cards: DeliverySupplierCard[],
  directory: Map<number, SupplierDeliveryInfo>,
  overrides: Record<number, Date>,
): Date {
  const override = overrides[supplierId];
  if (override) return override;

  const card = cards.find(c => c.supplier.id === supplierId)?.supplier;
  const known = card?.leadTimeDays != null ? card : directory.get(supplierId);
  return calcExpectedDeliveryDate(known?.leadTimeDays, known?.cutoffTime);
}
