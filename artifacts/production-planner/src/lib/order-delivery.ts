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

/** "2026-10-22" → that calendar day at local midnight; null when blank or
 *  not a real YYYY-MM-DD date. */
export function parseISODate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/**
 * Resolve the expected delivery date for a supplier on the orders page.
 *
 * Order of truth: an operator-set date wins; then, when the card is a placed
 * order reopened for editing, THAT ORDER'S existing delivery date; then the
 * rendered card's lead time; then the supplier directory (/api/suppliers),
 * which knows every supplier whether or not it has a card right now.
 *
 * The reopened-order rule (fix-queue #194, Jane, May 2026): adding a kanban
 * or item to an order already placed for Thursday used to re-derive the date
 * from today + lead time, and resubmitting quietly moved the whole order to
 * that new day. Editing an order never moves it; only the operator changing
 * the date does.
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
  /** The reopened placed order's own expected delivery date (YYYY-MM-DD),
   *  when this supplier's card is editing one. */
  reopenedOrderDate?: string | null,
): Date {
  const override = overrides[supplierId];
  if (override) return override;

  const existing = parseISODate(reopenedOrderDate);
  if (existing) return existing;

  const card = cards.find(c => c.supplier.id === supplierId)?.supplier;
  const known = card?.leadTimeDays != null ? card : directory.get(supplierId);
  return calcExpectedDeliveryDate(known?.leadTimeDays, known?.cutoffTime);
}
