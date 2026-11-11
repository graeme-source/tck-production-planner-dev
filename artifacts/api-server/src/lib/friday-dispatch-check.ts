/**
 * Friday dispatch check (Graeme, 11 Nov 2026). Objective C.
 *
 * Friday's dispatch is Saturday's delivery, and every Friday about 5% of
 * orders can't be booked because APC refuse a Saturday to that postcode.
 * The team only found out when the label booking failed on Friday morning.
 * This runs any day before (Wednesday, say) over every order due out this
 * Friday and says which won't get a Saturday, so the customer can be offered
 * a Thursday dispatch (Friday delivery) or moved to Monday's (Tuesday
 * delivery).
 *
 * The last four Fridays on live: 15 Saturday refusals. 8 were postcodes
 * APC's own table lists with no Saturday service (red here). The other 7
 * were listed WITH Saturdays but the depot refused that week — three from
 * one depot on one day, two from another a week apart — which is what the
 * "a depot refused a Saturday recently" signal (amber) is for.
 *
 * Pure: the orders, the postcode answers (services/apc-postinfo.ts, with
 * recorded APC answers already merged) and the recent refusals are passed
 * in; nothing here reads a database, Shopify or the clock.
 */
import type { PostcodeServiceAnswer } from "../services/apc-postinfo";
import { outwardCode } from "../services/apc-postinfo";
import { addDaysToDateString } from "./london-time";
import { friendlyDate, dayNameFor } from "./order-reschedule";
import { isCancelledOrder, isCollectionOrder, isLocalDeliveryOrder } from "./dispatch-tag";

/** How far back a depot's Saturday refusal still counts as a warning. */
export const DEPOT_REFUSAL_DAYS = 21;

export type FridayStatus = "ok" | "no_saturday" | "at_risk" | "unknown";

// ── Dates ───────────────────────────────────────────────────────────────────

export function isFridayDate(date: string): boolean {
  return dayNameFor(date) === "Friday";
}

/** The Friday the check defaults to: today when today is a Friday, else
 *  the next one. */
export function comingFriday(today: string): string {
  let d = today;
  for (let i = 0; i < 7 && !isFridayDate(d); i++) d = addDaysToDateString(d, 1);
  return d;
}

export interface FridayDates {
  /** The Friday the orders go out on. */
  dispatchDate: string;
  /** Their delivery-date tag — the Saturday. */
  deliveryDate: string;
  /** Last day a customer can reply to take the Thursday dispatch. */
  replyBy: string;
  thursdayDispatch: string;
  /** The tag an order moved to Thursday's dispatch carries (the Friday). */
  thursdayDelivery: string;
  nextWeekDispatch: string;
  /** The tag an order moved to next Monday's dispatch carries (Tuesday). */
  nextWeekDelivery: string;
}

export function fridayDates(dispatchDate: string): FridayDates {
  return {
    dispatchDate,
    deliveryDate: addDaysToDateString(dispatchDate, 1),
    replyBy: addDaysToDateString(dispatchDate, -2),
    thursdayDispatch: addDaysToDateString(dispatchDate, -1),
    thursdayDelivery: dispatchDate,
    nextWeekDispatch: addDaysToDateString(dispatchDate, 3),
    nextWeekDelivery: addDaysToDateString(dispatchDate, 4),
  };
}

// ── Which orders go by APC ──────────────────────────────────────────────────

/** The order fields the check reads — a subset of ShopifyOrder. */
export interface CheckableShopifyOrder {
  id: number;
  name: string;
  tags: string;
  cancelled_at: string | null;
  fulfillment_status: string | null;
  customer: { first_name?: string | null; last_name?: string | null } | null;
  shipping_address: { name?: string | null; zip?: string | null } | null;
}

export interface FridayCheckOrder {
  orderId: number;
  orderName: string;
  customerName: string;
  postcode: string | null;
}

/** The orders on a delivery-date tag that will go by APC — the same rules
 *  as the batch preflight (routes/fulfilment.ts buildPreflight): not
 *  cancelled, not already fulfilled, not a collection, not a local (van)
 *  delivery. Unlike the preflight, the dispatch tag is NOT required: this
 *  runs days before the morning's approval. */
export function apcOrdersForCheck(orders: readonly CheckableShopifyOrder[]): FridayCheckOrder[] {
  return orders
    .filter(o =>
      !isCancelledOrder(o)
      && o.fulfillment_status !== "fulfilled"
      && !isCollectionOrder(o.tags)
      && !isLocalDeliveryOrder(o.tags),
    )
    .map(o => ({
      orderId: o.id,
      orderName: o.name,
      customerName: o.shipping_address?.name?.trim()
        || `${o.customer?.first_name ?? ""} ${o.customer?.last_name ?? ""}`.trim(),
      postcode: o.shipping_address?.zip?.trim() || null,
    }));
}

// ── Recent depot refusals ───────────────────────────────────────────────────

/** One past Saturday refusal (apc_booking_issues), reduced to what counts. */
export interface DepotRefusal {
  /** London day the booking failed (the Friday). */
  reportDate: string;
  depot: string;
  /** Outward code of the refused postcode. */
  outward: string;
  orderName: string;
  /** APC's table listed Saturday service for that postcode. A refusal the
   *  table already predicted says nothing new about the depot. */
  tableListedSaturday: boolean;
}

/** The refusals that warn about this depot: same depot, the table expected
 *  a Saturday there, and inside DEPOT_REFUSAL_DAYS before the dispatch day. */
export function depotWarnings(depot: string, refusals: readonly DepotRefusal[], dispatchDate: string): DepotRefusal[] {
  if (!depot) return [];
  const from = addDaysToDateString(dispatchDate, -DEPOT_REFUSAL_DAYS);
  return refusals
    .filter(r => r.depot === depot && r.tableListedSaturday && r.reportDate >= from && r.reportDate < dispatchDate)
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : a.reportDate > b.reportDate ? -1 : a.outward.localeCompare(b.outward)));
}

/** "Fri 24 Oct" */
function shortDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })
    .format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function depotWarningText(depot: string, warnings: readonly DepotRefusal[], ownOutward: string): string {
  const days = [...new Set(warnings.map(w => w.reportDate))];
  const parts = days.map(day => {
    const areas = [...new Set(warnings.filter(w => w.reportDate === day).map(w => w.outward))].sort();
    return `${shortDay(day)} (${areas.join(", ")})`;
  });
  const same = warnings.some(w => w.outward === ownOutward) ? `, ${ownOutward} among them` : "";
  const n = warnings.length;
  return `Depot ${depot} refused ${n === 1 ? "a Saturday" : `${n} Saturdays`} in the last ${DEPOT_REFUSAL_DAYS} days that APC's table says it delivers: ${parts.join("; ")}${same}.`;
}

// ── One order ───────────────────────────────────────────────────────────────

export interface Alternative {
  possible: boolean;
  /** The delivery-date tag the order moves to. */
  deliveryDate: string;
  /** "Thursday 13 November" etc — the dispatch day, for the button. */
  label: string;
  /** Why not, when it isn't possible; a caution when it is. */
  note: string | null;
}

export interface FridayCheckResult extends FridayCheckOrder {
  status: FridayStatus;
  /** One plain sentence. */
  reason: string;
  outward: string | null;
  depot: string | null;
  /** Thursday dispatch → Friday delivery. */
  thursday: Alternative;
  /** Next Monday dispatch → Tuesday delivery. */
  nextWeek: Alternative;
  /** The customer can still be offered Thursday by email (before replyBy ends). */
  canOfferThursday: boolean;
  /** The "can't do Saturday" email makes sense for this order. */
  canEmail: boolean;
  emailNote: string | null;
}

export function checkOrder(
  order: FridayCheckOrder,
  service: PostcodeServiceAnswer | null,
  refusals: readonly DepotRefusal[],
  dates: FridayDates,
  today: string,
): FridayCheckResult {
  const outward = order.postcode ? outwardCode(order.postcode) || null : null;
  const thursdayLabel = friendlyDate(dates.thursdayDispatch);
  const nextWeekLabel = friendlyDate(dates.nextWeekDispatch);

  if (!service) {
    const reason = !order.postcode
      ? "No postcode on the order — fix the address in Shopify."
      : `${outward || order.postcode} isn't in APC's postcode table — check the postcode is right, then ask APC.`;
    const no = (deliveryDate: string, label: string): Alternative => ({ possible: false, deliveryDate, label, note: "Postcode not in APC's table — check it first." });
    return {
      ...order, status: "unknown", reason, outward, depot: null,
      thursday: no(dates.thursdayDelivery, thursdayLabel),
      nextWeek: no(dates.nextWeekDelivery, nextWeekLabel),
      canOfferThursday: false, canEmail: false, emailNote: "Check the postcode before emailing.",
    };
  }

  const where = `${service.matchedOn}${service.depot ? ` (depot ${service.depot})` : ""}`;
  const sat = service.restrictions.saturday;
  const warnings = depotWarnings(service.depot, refusals, dates.dispatchDate);

  let status: FridayStatus;
  let reason: string;
  if (!service.saturdayDelivery) {
    status = "no_saturday";
    reason = sat?.kind === "permanent"
      ? `APC confirmed on ${sat.recordedOn} there's no Saturday delivery to ${where}.`
      : `APC's postcode table lists no Saturday delivery for ${where}.`;
  } else if (sat?.kind === "temporary") {
    status = "at_risk";
    reason = `${sat.label}${sat.expiresOn ? ` (counts until ${sat.expiresOn})` : ""} for ${where}.`;
  } else if (warnings.length > 0) {
    status = "at_risk";
    reason = depotWarningText(service.depot, warnings, service.matchedOn);
  } else {
    status = "ok";
    reason = `Saturday delivery by ${service.saturday} to ${where}.`;
  }

  // Both alternatives need a next-day weekday service (an overnight courier).
  const weekdayNote = service.restrictions.weekday?.kind === "temporary" ? `${service.restrictions.weekday.label} — check with APC first.` : null;
  const noNextDay = service.transitDays
    ? `No next-day weekday service here — ${service.transitDays} days in transit.`
    : "No next-day weekday service here.";
  const thursdayPossible = service.nextDay && today <= dates.thursdayDispatch;
  const thursday: Alternative = {
    possible: thursdayPossible,
    deliveryDate: dates.thursdayDelivery,
    label: thursdayLabel,
    note: !service.nextDay ? noNextDay : !thursdayPossible ? "Thursday's dispatch has gone." : weekdayNote,
  };
  const nextWeek: Alternative = {
    possible: service.nextDay,
    deliveryDate: dates.nextWeekDelivery,
    label: nextWeekLabel,
    note: !service.nextDay ? noNextDay : weekdayNote,
  };
  const canOfferThursday = service.nextDay && today <= dates.replyBy;

  return {
    ...order, status, reason, outward: service.matchedOn, depot: service.depot || null,
    thursday, nextWeek, canOfferThursday,
    canEmail: status !== "ok" && service.nextDay,
    emailNote: status === "ok" ? null
      : !service.nextDay ? "APC have no next-day service here on any weekday — this isn't a Saturday problem. Escalate it."
        : !canOfferThursday ? `It's past ${dayNameFor(dates.replyBy)}, so the email only offers ${nextWeekLabel}'s dispatch.`
          : null,
  };
}

// ── The whole Friday ────────────────────────────────────────────────────────

export interface FridayCheckSummary {
  total: number;
  ok: number;
  noSaturday: number;
  atRisk: number;
  unknown: number;
}

export function summarise(results: readonly FridayCheckResult[]): FridayCheckSummary {
  const n = (s: FridayStatus) => results.filter(r => r.status === s).length;
  return { total: results.length, ok: n("ok"), noSaturday: n("no_saturday"), atRisk: n("at_risk"), unknown: n("unknown") };
}

const ORDER: Record<FridayStatus, number> = { no_saturday: 0, at_risk: 1, unknown: 2, ok: 3 };

/** Every order judged, worst first, then by depot and order number. */
export function runFridayCheck(input: {
  dispatchDate: string;
  /** Dates with the next-week day already worked out from the delivery
   *  calendar (bank holidays); default: fridayDates(dispatchDate). */
  dates?: FridayDates;
  today: string;
  orders: readonly FridayCheckOrder[];
  serviceFor: (postcode: string | null) => PostcodeServiceAnswer | null;
  refusals: readonly DepotRefusal[];
}): { dates: FridayDates; results: FridayCheckResult[]; summary: FridayCheckSummary } {
  const dates = input.dates ?? fridayDates(input.dispatchDate);
  const results = input.orders
    .map(o => checkOrder(o, input.serviceFor(o.postcode), input.refusals, dates, input.today))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status]
      || (a.depot ?? "").localeCompare(b.depot ?? "", undefined, { numeric: true })
      || a.orderName.localeCompare(b.orderName, undefined, { numeric: true }));
  return { dates, results, summary: summarise(results) };
}

// ── What's been done ────────────────────────────────────────────────────────

export interface FridayAction {
  orderId: number;
  orderName: string;
  kind: "emailed" | "moved";
  detail: string | null;
  byName: string | null;
  at: string;
}

export interface OrderDoneState {
  emailedAt: string | null;
  emailedBy: string | null;
  emailedTo: string | null;
  movedAt: string | null;
  movedBy: string | null;
  /** The delivery-date tag it was moved to. */
  movedTo: string | null;
}

/** The latest email and move per order, from the append-only log. */
export function doneStateByOrder(actions: readonly FridayAction[]): Map<number, OrderDoneState> {
  const out = new Map<number, OrderDoneState>();
  const sorted = [...actions].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const a of sorted) {
    const s = out.get(a.orderId) ?? { emailedAt: null, emailedBy: null, emailedTo: null, movedAt: null, movedBy: null, movedTo: null };
    if (a.kind === "emailed") { s.emailedAt = a.at; s.emailedBy = a.byName; s.emailedTo = a.detail; }
    if (a.kind === "moved") { s.movedAt = a.at; s.movedBy = a.byName; s.movedTo = a.detail; }
    out.set(a.orderId, s);
  }
  return out;
}
