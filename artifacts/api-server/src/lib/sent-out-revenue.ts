/**
 * Revenue SENT OUT in a calendar month — what Tommy's bonus is measured on
 * (Graeme, 30 Oct 2026: "the revenue sent out should be automatically
 * calculated based on what we packed"). PURE, no I/O; loading is in
 * sent-out-revenue-load.ts. Objective I.
 *
 * Nothing here is new revenue maths — it joins two rules the app already
 * has:
 *
 *   WHEN it went   resolveDispatch (lib/payroll/month-end.ts), the dispatch
 *                  rule the accountant's month-end deferred income uses:
 *                  Shopify's fulfilment time (the moment the picker
 *                  completed the order and the customer was emailed), else
 *                  the app's own fulfil record, else the APC collection
 *                  date, else — only for an order Shopify says is fulfilled
 *                  with no date anywhere — the delivery-date tag less a day.
 *                  The order counts in the month of that LONDON day. An
 *                  order sent in more than one parcel counts in full on its
 *                  first one.
 *   WHAT it's worth  the founder Numbers page's own rules (lib/order-revenue):
 *                  isCountableOrder (cancelled, fully refunded and voided
 *                  orders don't count) and getNetRevenue = Shopify
 *                  total_price less every successful refund. So it is:
 *                    · INC VAT, like the Numbers tiles and the monthly
 *                      minimum/stretch targets the bonus is judged against
 *                      (ex VAT is worked out alongside with the order's own
 *                      tax share; nearly all TCK food is zero-rated, so the
 *                      two are close);
 *                    · AFTER discounts (total_price is what the customer
 *                      paid) and WITH delivery charges, again as Numbers;
 *                    · net of refunds made at ANY time, including after
 *                      the month — a refund for a box that went out in
 *                      October takes it off October. The bonus is worked
 *                      out about two weeks after the month, once profit is
 *                      signed off, so those refunds are in by then.
 *   Wholesale and 8-pack orders are Shopify orders too, so they're in (an
 *   invoice-terms order still "pending" payment counts, as on Numbers).
 *   Orders with nothing to send (every line requires_shipping=false: gift
 *   cards, Calzone Club membership fees) are never "sent out", so they're
 *   left out and shown separately.
 */
import { getNetRevenue, getRefundTotal, isCountableOrder, type RevenueOrder } from "./order-revenue";
import {
  deferralOrderFromShopify, dispatchTrust, exVatOf, resolveDispatch,
  type DispatchState, type DispatchTrust, type ShopifyOrderPayload,
} from "./payroll/month-end";
import { londonDateString } from "./london-time";

export interface SentOutInput {
  /** The order exactly as Shopify's REST API gives it (the orders mirror). */
  payload: ShopifyOrderPayload;
  /** The app's fulfil record, ISO instant. */
  appFulfilledAt?: string | null;
  /** The live APC consignment's collection date, YYYY-MM-DD. */
  apcCollectionDate?: string | null;
}

export interface MoneyBucket { orders: number; incVat: number }

export interface SentOutRevenue {
  /** YYYY-MM. */
  month: string;
  /** First and last day of the month (YYYY-MM-DD). */
  monthStart: string;
  monthEnd: string;
  /** Counted up to here: the month end, or today while the month runs. */
  through: string;
  /** The month is over. */
  complete: boolean;
  /** Orders sent out in the month that count (£0 resends included). */
  orders: number;
  incVat: number;
  exVat: number;
  /** Refunds already taken off those orders. */
  refunds: number;
  /** First and last London day an order went out; null with none. */
  firstDay: string | null;
  lastDay: string | null;
  /** How each counted order's dispatch day was found. */
  bySource: Record<"shopify" | "app" | "apc" | "estimate", MoneyBucket>;
  /** Sent in the month but since cancelled or refunded in full — not counted. */
  cancelled: MoneyBucket;
  /** Paid in the month with nothing to send (gift cards, memberships) — not counted. */
  nothingToSend: MoneyBucket;
  /** Paid in the month, Shopify says sent, but no date anywhere — not counted. */
  unknown: MoneyBucket;
  trust: DispatchTrust;
  warnings: string[];
}

const pence = (n: number) => Math.round(n * 100);
const fromPence = (p: number) => p / 100;

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/** Revenue sent out in `month` (YYYY-MM), as at `today` (YYYY-MM-DD, London). */
export function sentOutRevenue(month: string, inputs: readonly SentOutInput[], today: string): SentOutRevenue {
  const monthStart = `${month}-01`;
  const monthEnd = lastDayOf(month);
  const through = today < monthEnd ? today : monthEnd;
  const inMonth = (day: string | null) => day != null && day >= monthStart && day <= monthEnd;

  const bySourceP = { shopify: [0, 0], app: [0, 0], apc: [0, 0], estimate: [0, 0] } as Record<"shopify" | "app" | "apc" | "estimate", [number, number]>;
  const cancelledP: [number, number] = [0, 0];
  const nothingP: [number, number] = [0, 0];
  const unknownP: [number, number] = [0, 0];
  const coverage: Record<DispatchState, number> = { shopify: 0, app: 0, apc: 0, estimate: 0, not_yet: 0, unknown: 0, nothing_to_send: 0 };
  let incP = 0, exP = 0, refundsP = 0, orders = 0;
  let firstDay: string | null = null, lastDay: string | null = null;
  const seen = new Set<number>();

  for (const input of inputs) {
    const p = input.payload;
    const id = Number(p.id);
    if (seen.has(id)) continue;
    seen.add(id);
    // The Numbers page's rules read the REST order directly; the mirror
    // payload IS that order (numbers may arrive as strings or numbers —
    // getNetRevenue parses either).
    const rev = p as unknown as RevenueOrder;
    const countable = isCountableOrder({ cancelled_at: p.cancelled_at ?? null, financial_status: p.financial_status ?? "" });
    const net = countable ? getNetRevenue(rev) : 0;

    const d = deferralOrderFromShopify(p, { appFulfilledAt: input.appFulfilledAt, apcCollectionDate: input.apcCollectionDate });
    const r = resolveDispatch(d);
    const paidDay = Number.isFinite(Date.parse(p.created_at)) ? londonDateString(new Date(p.created_at)) : null;

    if (r.state === "nothing_to_send") {
      if (countable && inMonth(paidDay)) { nothingP[0]++; nothingP[1] += pence(net); }
      continue;
    }
    if (r.state === "unknown") {
      if (countable && inMonth(paidDay)) { unknownP[0]++; unknownP[1] += pence(net); coverage.unknown++; }
      continue;
    }
    if (r.state === "not_yet" || !inMonth(r.day)) continue;

    if (!countable) {
      cancelledP[0]++;
      cancelledP[1] += pence(Number(p.total_price ?? 0) || 0);
      continue;
    }
    coverage[r.state]++;
    orders++;
    incP += pence(net);
    exP += pence(exVatOf(net, d));
    refundsP += pence(getRefundTotal(rev));
    const b = bySourceP[r.state as keyof typeof bySourceP];
    b[0]++; b[1] += pence(net);
    if (firstDay == null || r.day! < firstDay) firstDay = r.day;
    if (lastDay == null || r.day! > lastDay) lastDay = r.day;
  }

  const bucket = ([n, p]: [number, number]): MoneyBucket => ({ orders: n, incVat: fromPence(p) });
  const trust = dispatchTrust(coverage);
  const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const warnings: string[] = [];
  if (unknownP[0] > 0) {
    warnings.push(`${unknownP[0]} order${unknownP[0] === 1 ? "" : "s"} (${money(fromPence(unknownP[1]))}) marked sent in Shopify with no dispatch date anywhere — not counted.`);
  }
  if (bySourceP.estimate[0] > 0) {
    warnings.push(`${bySourceP.estimate[0]} order${bySourceP.estimate[0] === 1 ? "'s" : "s'"} dispatch day estimated from the delivery-date tag.`);
  }
  if (orders > 0 && !trust.trustworthy) warnings.unshift(`Not enough real dispatch records to trust this figure. ${trust.summary}`);

  return {
    month, monthStart, monthEnd, through, complete: today > monthEnd,
    orders, incVat: fromPence(incP), exVat: fromPence(exP), refunds: fromPence(refundsP),
    firstDay, lastDay,
    bySource: {
      shopify: bucket(bySourceP.shopify), app: bucket(bySourceP.app), apc: bucket(bySourceP.apc), estimate: bucket(bySourceP.estimate),
    },
    cancelled: bucket(cancelledP),
    nothingToSend: bucket(nothingP),
    unknown: bucket(unknownP),
    trust,
    warnings,
  };
}
