/**
 * The 2:16 order check (Graeme, 5 Nov 2026). Orders placed before 2:00 can go
 * out for tomorrow, but new orders are hidden for 15 minutes while AfterSell
 * holds them, and one placed late may never get its dispatch tag. So at 2:16
 * the app looks for anything that should be on tomorrow's run and isn't. Pure,
 * tested; the Shopify read and the stored alert are in dispatch-cutoff.ts.
 *
 * The delivery date decides what goes out (Graeme, 23 Nov 2026 — #140315): an
 * order is only "missing" when a delivery date puts it on tomorrow's run —
 * the date tag, or the day the customer booked at checkout. An order with no
 * delivery date at all (a wholesale order customer service hasn't processed
 * yet) is nobody's to pack today, so it is never flagged; it shows up here
 * once it has been given tomorrow's date.
 */
import { isDispatchTagged, isPartOfDespatchWave } from "./dispatch-tag";
import { addDaysToDateString, londonDateString, londonMinuteOfDay } from "./london-time";

const CUTOFF_ORDERS_BEFORE = 14 * 60;
const CHECK_AT = 14 * 60 + 16;
/** If Shopify can't be read by now, the packers are told to look by hand. */
const GIVE_UP_AT = 15 * 60;
const DATE_TAG = /^\d{4}-\d{2}-\d{2}$/;

export const isCheckDue = (minuteOfDay: number) => minuteOfDay >= CHECK_AT;

/** Monday to Friday: nobody's packing at the weekend to see the alert. */
export function isCheckDay(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}
export const hasGivenUp = (minuteOfDay: number) => minuteOfDay >= GIVE_UP_AT;

interface CheckOrder {
  id: number;
  name: string;
  tags?: string | null;
  created_at: string;
  customer?: { first_name?: string | null; last_name?: string | null } | null;
  note_attributes?: Array<{ name?: string | null; value?: string | null }> | null;
}

/** Held on purpose until nearer its date (subscription renewals sit as
 *  "waiting"), so never a missed order. */
const isWaiting = (tags: string | null | undefined) =>
  (tags ?? "").split(",").some(t => t.trim().toLowerCase() === "waiting");

/** Zapiet's chosen delivery day (`Delivery-Date`, YYYY/MM/DD) as YYYY-MM-DD, or null. */
export function zapietDeliveryDate(attrs: CheckOrder["note_attributes"]): string | null {
  const v = (attrs ?? []).find(a => a?.name === "Delivery-Date")?.value?.trim() ?? "";
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface MissingOrder {
  id: number;
  name: string;
  customer: string | null;
  placedAt: string;
  reason: string;
}

/** Why an order is missing from tomorrow's run. */
export const REASON_NOT_DISPATCH_TAGGED = "Not tagged for dispatch";
export const REASON_BOOKED_NOT_TAGGED = "Booked for tomorrow, no delivery date tag";

/** Unfulfilled courier orders placed before 2:00 today that won't go out for
 *  tomorrow unless someone acts: tagged for tomorrow but not for dispatch, or
 *  booked for tomorrow at checkout (Zapiet Delivery-Date) but never given
 *  their date tag. Orders held as "waiting", booked for after tomorrow, or
 *  with no delivery date at all, are left out. */
export function ordersMissingCutoff(orders: CheckOrder[], today: string): MissingOrder[] {
  const tomorrow = addDaysToDateString(today, 1);
  const missing: MissingOrder[] = [];
  for (const o of orders) {
    const placed = new Date(o.created_at);
    if (Number.isNaN(placed.getTime()) || !isPartOfDespatchWave(o.tags)) continue;
    // Booked for a later day, or held as "waiting" (a subscription renewal
    // created early for next week): not tomorrow's run, so not missing
    // (Graeme, 13 Nov 2026 — #139661, renewal for 20 Nov, flagged on 13 Nov).
    if (isWaiting(o.tags)) continue;
    const booked = zapietDeliveryDate(o.note_attributes);
    if (booked && booked > tomorrow) continue;
    const day = londonDateString(placed);
    if (day > today || (day === today && londonMinuteOfDay(placed) >= CUTOFF_ORDERS_BEFORE)) continue;
    const dateTags = (o.tags ?? "").split(",").map(t => t.trim()).filter(t => DATE_TAG.test(t));
    const reason = dateTags.includes(tomorrow) && !isDispatchTagged(o.tags) ? REASON_NOT_DISPATCH_TAGGED
      : dateTags.length === 0 && booked === tomorrow ? REASON_BOOKED_NOT_TAGGED
        : null;
    if (!reason) continue;
    const customer = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || null;
    missing.push({ id: o.id, name: o.name, customer, placedAt: o.created_at, reason });
  }
  return missing;
}

export interface CutoffAlert {
  date: string;
  orders: MissingOrder[];
  /** The check couldn't read Shopify, so someone needs to look by hand. */
  failed: boolean;
  /** Dealt with, by Check again or by dismissing it, for the rest of the day. */
  closed: boolean;
  checkedAt: string;
  /** Who pressed Dismiss, and when (20 Nov 2026 — #140013). */
  dismissedBy?: string | null;
  dismissedAt?: string | null;
}

/** After someone dismissed today's alert: who, when, and which orders it
 *  still named — shown as a quiet line so it isn't silently gone. */
export function dismissedToday(alert: CutoffAlert | null, today: string): { by: string | null; at: string; orders: MissingOrder[] } | null {
  if (!alert || alert.date !== today || !alert.closed || !alert.dismissedAt) return null;
  return { by: alert.dismissedBy ?? null, at: alert.dismissedAt, orders: alert.orders };
}

/** What the packing and wrapping screens should show today. */
export function alertToShow(alert: CutoffAlert | null, today: string): CutoffAlert | null {
  return alert && alert.date === today && !alert.closed && (alert.failed || alert.orders.length > 0) ? alert : null;
}
