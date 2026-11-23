/**
 * Orders with no delivery date — the managers' dashboard warning (Graeme,
 * 23 Nov 2026). Pure, tested (undated-orders-rules.test.ts); the Shopify
 * read and writes are in undated-orders.ts. Objectives F and G.
 *
 * The delivery-date tag decides what goes out. Website orders get theirs a
 * few minutes after they're placed, and subscription renewals held for later
 * carry "waiting" instead. So an unfulfilled order that is more than ten
 * minutes old with neither is one whose date wasn't added properly: it will
 * never reach a packing list unless someone acts. A manager either gives it
 * a delivery date here (the date tag is written to Shopify for them) or
 * marks it as fine (a test order, say), which takes it off the list for good.
 *
 * Wholesale and 8-pack orders are left out: they wait on the dashboard's
 * own wholesale list until someone processes them, which adds their date.
 */
import { zapietDeliveryDate, isWaiting } from "./dispatch-cutoff-rules";
import { isEightPackLine } from "./eight-pack-bags";
import { isDeliveryDay } from "./production-cutoff";
import { addDaysToDateString } from "./london-time";
import { firstDateTag, hasWholesaleTag } from "./wholesale-order-tags";

/** The date tag takes a few minutes to arrive, so younger orders are left alone. */
export const MIN_AGE_MINUTES = 10;
/** How long a "marked as fine" is remembered — well past the scan window. */
export const DISMISSED_KEEP_DAYS = 60;

export interface UndatedCheckOrder {
  id: number;
  name: string;
  tags?: string | null;
  created_at: string;
  note?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }> | null;
  line_items?: Array<{ title?: string | null; variant_title?: string | null; quantity?: number | null }> | null;
}

export interface UndatedOrder {
  id: number;
  name: string;
  customer: string | null;
  placedAt: string;
  /** The day the customer booked at checkout (Zapiet), if they did. */
  bookedDate: string | null;
  note: string | null;
  items: Array<{ title: string; variant: string | null; quantity: number }>;
}

/** Unfulfilled orders that should have a delivery date by now and don't,
 *  oldest first. `dismissed` holds the ids a manager marked as fine. */
export function undatedOrders(orders: UndatedCheckOrder[], now: Date, dismissed: ReadonlySet<number>): UndatedOrder[] {
  const oldEnough = now.getTime() - MIN_AGE_MINUTES * 60_000;
  const out: UndatedOrder[] = [];
  for (const o of orders) {
    const placed = new Date(o.created_at).getTime();
    if (Number.isNaN(placed) || placed > oldEnough) continue;
    if (firstDateTag(o.tags) != null || isWaiting(o.tags) || dismissed.has(o.id)) continue;
    const lines = o.line_items ?? [];
    // Nothing to send (a gift card or membership on its own): no date needed.
    if (lines.length === 0) continue;
    // Wholesale and 8-pack orders have their own list to be processed from.
    if (hasWholesaleTag(o.tags) || lines.some(isEightPackLine)) continue;
    out.push({
      id: o.id,
      name: o.name,
      customer: [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || null,
      placedAt: o.created_at,
      bookedDate: zapietDeliveryDate(o.note_attributes),
      note: o.note?.trim() || null,
      items: lines.map(li => ({ title: li.title ?? "Item", variant: li.variant_title ?? null, quantity: li.quantity ?? 1 })),
    });
  }
  return out.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}

/** The next `count` delivery days (Tue–Sat) from `earliest`, which is
 *  itself the first one that can still be despatched for. */
export function deliveryDayOptions(earliest: string, count: number): string[] {
  const out: string[] = [];
  let d = earliest;
  for (let guard = 0; out.length < count && guard < count * 3 + 14; guard++) {
    if (isDeliveryDay(d)) out.push(d);
    d = addDaysToDateString(d, 1);
  }
  return out;
}

/** The date to offer first: the day the customer booked, or one read from
 *  the order note, when it can still be delivered; otherwise the earliest. */
export function suggestedDeliveryDate(bookedDate: string | null, noteDate: string | null, options: readonly string[]): string | null {
  if (bookedDate && options.includes(bookedDate)) return bookedDate;
  if (noteDate && options.includes(noteDate)) return noteDate;
  return options[0] ?? null;
}

/** The order's tags with the delivery date added, or null when it already
 *  has a date tag (someone dated it in Shopify in the meantime). */
export function tagsWithDeliveryDate(currentTags: string | null | undefined, deliveryDate: string): string | null {
  if (firstDateTag(currentTags) != null) return null;
  const tags = (currentTags ?? "").split(",").map(t => t.trim()).filter(Boolean);
  return [...tags, deliveryDate].join(", ");
}

export interface DismissedOrder {
  id: number;
  name: string;
  by: string | null;
  at: string;
}

/** Add one "marked as fine", dropping any older than DISMISSED_KEEP_DAYS. */
export function withDismissed(list: readonly DismissedOrder[], entry: DismissedOrder, now: Date): DismissedOrder[] {
  const cutoff = now.getTime() - DISMISSED_KEEP_DAYS * 24 * 60 * 60_000;
  const kept = list.filter(d => d.id !== entry.id && new Date(d.at).getTime() >= cutoff);
  return [...kept, entry];
}
