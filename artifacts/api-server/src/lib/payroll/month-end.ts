/**
 * Month-end adjustments for the accountant — PURE, no I/O (Objective I:
 * the monthly P&L shows what each calendar month really earned and cost).
 * Loading lives in month-end-load.ts. Graeme, 27 Oct 2026.
 *
 * Two figures, at every calendar month end:
 *
 * 1. DEFERRED INCOME. Shopify counts a sale the moment the customer pays,
 *    but the food is made and sent days later — a big last week of
 *    September is mostly October's work. Deferred income at a month end =
 *    the value of orders PAID by 23:59 London time on the last day of the
 *    month but NOT DISPATCHED by then.
 *      · "Paid" = the Shopify order's created_at (the order date Shopify's
 *        sales reports use). Orders still pending/voided/authorised are
 *        left out — no money yet.
 *      · As at the month end: an order cancelled, or refunded in full, ON
 *        OR BEFORE the cut-off is left out; a partial refund by then comes
 *        off. An order cancelled or refunded AFTER the cut-off still counts
 *        — the money was held on the day; the refund lands next month,
 *        where the release of the deferral cancels it. Those are counted
 *        separately (laterCancelled) so the accountant can see them.
 *      · Value = what the customer paid (total_price, inc VAT, delivery and
 *        discounts included) less refunds by the cut-off. Ex VAT uses the
 *        order's own tax share (almost all TCK food is zero-rated).
 *      · Orders with nothing to send (every line requires_shipping=false:
 *        gift cards, Calzone Club membership fees) are never deferred.
 *
 *    THE DISPATCH DATE — one rule, in this order (measured on live data
 *    27 Oct 2026; see resolveDispatch):
 *      1. Shopify fulfilment created_at (earliest successful one). This is
 *         the moment the box was marked sent and the customer emailed — the
 *         truth for every order, whoever fulfilled it.
 *      2. The app's own fulfil record (shopify_fulfilment_tracking, source
 *         "immediate"), written as the picker completes the order. Matches
 *         Shopify's fulfilment to within ~2 seconds (1,047 orders, Jul–Aug
 *         2026). Used when the orders mirror holds no fulfilment data.
 *      3. The live APC consignment's collection date (not cancelled, not
 *         superseded) — a date, no time. Same day as the fulfilment on
 *         1,046 of 1,047 orders.
 *      4. ESTIMATE: the delivery-date tag less one day (the tag itself for a
 *         collection) — the existing despatchDay rule. Right on 98.7% of
 *         23,970 orders that have both. Only used for an order Shopify says
 *         is fulfilled but no record above has a date; counted separately.
 *    No record at all:
 *      · not fulfilled in Shopify (as last synced) → not dispatched yet →
 *        deferred. This is right for orders paid weeks ahead of a future
 *        delivery date.
 *      · fulfilled but no date and no tag → UNKNOWN: not deferred, counted
 *        and warned about so the accountant can check them.
 *
 * 2. LABOUR. Pay periods run 25th → 24th, so shifts worked from the 25th to
 *    the last day of a month are paid in the NEXT period but belong to the
 *    earlier calendar month. Every pay period holds exactly one month end
 *    (25 Sep – 24 Oct holds 30 Sep), so its report shows that month's
 *    25th → month-end labour, with the same pay rules as the report itself
 *    (assemblePayroll: approved shifts, unpaid breaks off, holiday hours ×
 *    rate). An employer NI / pension ESTIMATE sits on its own line.
 *
 * Both are accruals that reverse the next month, so the history shows each
 * month's opening (the previous month end), closing and movement
 * (closing − opening): the deferred-income movement comes OFF that month's
 * sales; the labour movement goes ON that month's wages.
 */
import { addDaysToDateString, londonDateString, londonDayStartUtc } from "../london-time";
import { despatchDay } from "../team-efficiency-despatch";
import { payPeriodFor, type PayPeriod } from "./period";

const round2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The history starts at 31 Mar 2025 — the opening balance for the
 *  2025/26 financial year (TCK's year ends 31 March), so last year can be
 *  done properly too. Graeme first asked for 30 Nov 2025, so December 2025
 *  gets both its opening release and closing deferral; that month end keeps
 *  its own label. Each row says how trustworthy its dispatch dates are. */
export const HISTORY_START = "2025-03-31";
export const NOV_2025 = "2025-11-30";
export const NOV_2025_OPENING_LABEL = "Opening balance — 30 Nov 2025 (for the accountant to post as an opening/prior-year adjustment)";

/** Orders paid this many days before a month end are looked at. A paid
 *  order still unsent after this long is almost certainly a data problem
 *  — unless its delivery date is still to come (staleUnsent). */
export const LOOKBACK_DAYS = 92;
export const STALE_DAYS = 60;
/** The trust score looks at orders paid in this many days before the month
 *  end: older ones were nearly all sent long before it, whatever the source. */
export const TRUST_DAYS = 14;

// ── Dates ─────────────────────────────────────────────────────────────────

function ymd(date: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Not a date: "${date}"`);
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** The last day of `date`'s calendar month. */
export function lastDayOfMonth(date: string): string {
  const { y, m } = ymd(date);
  return iso(y, m + 1, 0);
}

/** The one calendar month end inside a pay period (25 Sep – 24 Oct → 30
 *  Sep). null for a range that holds none. */
export function monthEndInPeriod(from: string, to: string): string | null {
  const end = lastDayOfMonth(from);
  return end >= from && end <= to ? end : null;
}

/** The pay period that holds a month end's 25th → month-end shifts. */
export function payPeriodForMonthEnd(monthEnd: string): PayPeriod {
  return payPeriodFor(monthEnd);
}

/** The labour window: the 25th to the month end, both included. */
export function labourWindow(monthEnd: string): { from: string; to: string } {
  const { y, m } = ymd(monthEnd);
  return { from: iso(y, m, 25), to: lastDayOfMonth(monthEnd) };
}

/** "September 2026". */
export function monthLabel(monthEnd: string): string {
  const { y, m } = ymd(monthEnd);
  return `${MONTHS[m]} ${y}`;
}

/** "30 Sep 2026". */
export function shortDay(date: string): string {
  const { y, m, d } = ymd(date);
  return `${d} ${SHORT[m]} ${y}`;
}

/** Every month end from `first` to `last`, oldest first. */
export function monthEndsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let { y, m } = ymd(first);
  for (let end = iso(y, m + 1, 0); end <= last; end = iso(y, m + 1, 0)) {
    out.push(end);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

/** The latest month that has finished by `today` (its last day is before
 *  today): 27 Oct → 30 Sep; 1 Nov → 31 Oct; 31 Oct → 30 Sep. */
export function latestClosedMonthEnd(today: string): string {
  const { y, m } = ymd(today);
  return iso(y, m, 0);
}

/** Final once the pay period holding its labour has ended (every shift in
 *  it approved and paid) — then a stored result can be reused. */
export function isFinal(monthEnd: string, today: string): boolean {
  return today > payPeriodForMonthEnd(monthEnd).to;
}

/** The first instant AFTER the month end: 00:00 London on the 1st of the
 *  next month (23:00 UTC the evening before in BST). */
export function monthEndCutoff(monthEnd: string): Date {
  return londonDayStartUtc(addDaysToDateString(monthEnd, 1));
}

// ── Orders ────────────────────────────────────────────────────────────────

export type DispatchSource = "shopify" | "app" | "apc" | "estimate";
export type DispatchState = DispatchSource | "not_yet" | "unknown" | "nothing_to_send";

export interface DeferralOrder {
  id: number;
  name: string;
  /** Shopify created_at, ISO with offset. */
  paidAt: string;
  cancelledAt: string | null;
  financialStatus: string | null;
  /** Shopify's fulfillment_status as last synced (null = unfulfilled). */
  fulfillmentStatus: string | null;
  totalPrice: number;
  totalTax: number;
  refunds: Array<{ at: string; amount: number }>;
  /** false when no line needs sending (gift cards, membership fees). */
  requiresShipping: boolean;
  tags: string | null;
  /** created_at of each successful Shopify fulfilment; null = the mirror
   *  holds no fulfilment data for this order (not the same as none). */
  shopifyFulfilments: string[] | null;
  /** The app's fulfil record, ISO instant. */
  appFulfilledAt: string | null;
  /** The live APC consignment's collection date, YYYY-MM-DD. */
  apcCollectionDate: string | null;
}

export interface DispatchResolution {
  state: DispatchState;
  /** The exact moment, when the source has one. */
  at: string | null;
  /** The London day it went. */
  day: string | null;
}

const FULFILLED = new Set(["fulfilled", "partial"]);

/** When did this order leave? The order of sources is the rule documented
 *  at the top of this file. */
export function resolveDispatch(o: DeferralOrder): DispatchResolution {
  if (!o.requiresShipping) return { state: "nothing_to_send", at: null, day: null };
  const shop = (o.shopifyFulfilments ?? []).map(s => Date.parse(s)).filter(n => Number.isFinite(n));
  if (shop.length > 0) {
    const at = new Date(Math.min(...shop));
    return { state: "shopify", at: at.toISOString(), day: londonDateString(at) };
  }
  if (o.appFulfilledAt && Number.isFinite(Date.parse(o.appFulfilledAt))) {
    const at = new Date(o.appFulfilledAt);
    return { state: "app", at: at.toISOString(), day: londonDateString(at) };
  }
  if (o.apcCollectionDate) return { state: "apc", at: null, day: o.apcCollectionDate.slice(0, 10) };
  // Shopify knows of no fulfilment, or the order isn't fulfilled: not sent.
  if (o.shopifyFulfilments != null || !FULFILLED.has((o.fulfillmentStatus ?? "").toLowerCase())) {
    return { state: "not_yet", at: null, day: null };
  }
  const est = despatchDay(o.tags);
  if (est) return { state: "estimate", at: null, day: est };
  return { state: "unknown", at: null, day: null };
}

/** Sent by the end of the month end? Exact instants compare with the
 *  cut-off; date-only sources compare by day. null = can't tell. */
export function dispatchedBy(r: DispatchResolution, monthEnd: string, cutoff: Date): boolean | null {
  if (r.state === "not_yet") return false;
  if (r.state === "unknown" || r.state === "nothing_to_send") return null;
  if (r.at) return Date.parse(r.at) < cutoff.getTime();
  return r.day != null && r.day <= monthEnd;
}

const UNPAID = new Set(["pending", "voided", "authorized", "expired"]);

export interface Bucket { orders: number; incVat: number }
const bucket = (): Bucket => ({ orders: 0, incVat: 0 });
const add = (b: Bucket, v: number) => { b.orders++; b.incVat = round2(b.incVat + v); };

export interface DeferredLine {
  id: number;
  name: string;
  paidAt: string;
  /** London day it was sent; null = not sent yet. */
  dispatchedOn: string | null;
  source: DispatchState;
  incVat: number;
  exVat: number;
  laterCancelled: boolean;
}

export interface DeferredIncome {
  monthEnd: string;
  label: string;
  cutoffUtc: string;
  orders: number;
  incVat: number;
  exVat: number;
  vat: number;
  /** How each DEFERRED order's dispatch was established. */
  bySource: Record<"not_yet" | DispatchSource, Bucket>;
  /** Every order paid in the TRUST_DAYS before the month end — the ones
   *  whose dispatch dates decide the figure — by how the date was found. */
  coverage: Record<DispatchState, number>;
  /** Marked fulfilled in Shopify with no date anywhere: NOT deferred. */
  unknown: Bucket;
  /** Deferred, but cancelled or refunded after the month end. */
  laterCancelled: Bucket;
  /** Paid > STALE_DAYS before, still not sent, no future delivery date:
   *  left out as probably a data problem. */
  staleUnsent: Bucket;
  /** Gift cards / memberships paid in the month's last week: never deferred. */
  nothingToSend: Bucket;
  trust: DispatchTrust;
  lines: DeferredLine[];
  warnings: string[];
}

/** How well-founded the dispatch dates are, over the SENT orders paid in
 *  the TRUST_DAYS before the month end (not-yet-sent orders need no date). */
export interface DispatchTrust {
  sent: number;
  exact: number;
  estimated: number;
  unknown: number;
  /** exact ÷ sent, 0–100, one decimal; null when nothing was sent. */
  exactPct: number | null;
  /** ≥ 97% exact and < 1% unknown, with orders to judge by. */
  trustworthy: boolean;
  summary: string;
}

export function dispatchTrust(coverage: Record<DispatchState, number>): DispatchTrust {
  const exact = coverage.shopify + coverage.app + coverage.apc;
  const estimated = coverage.estimate;
  const unknown = coverage.unknown;
  const sent = exact + estimated + unknown;
  const pct = (n: number) => Math.round((n / sent) * 1000) / 10;
  const exactPct = sent > 0 ? pct(exact) : null;
  const trustworthy = sent > 0 && pct(exact) >= 97 && pct(unknown) < 1;
  const summary = sent === 0
    ? "No sent orders found for this month end — the dispatch dates can't be checked."
    : `Dispatch dates: ${exactPct}% from a real record (Shopify ${coverage.shopify}, app ${coverage.app}, APC ${coverage.apc})`
      + `${estimated ? `, ${estimated} estimated from the delivery date` : ""}${unknown ? `, ${unknown} unknown` : ""}`
      + ` of ${sent} sent orders.`;
  return { sent, exact, estimated, unknown, exactPct, trustworthy, summary };
}

/** Refunds (money back) by the cut-off. */
function refundedBy(o: DeferralOrder, cutoffMs: number): number {
  return o.refunds.filter(r => Date.parse(r.at) < cutoffMs).reduce((n, r) => n + r.amount, 0);
}

export function computeDeferredIncome(monthEnd: string, orders: readonly DeferralOrder[]): DeferredIncome {
  const cutoff = monthEndCutoff(monthEnd);
  const cutoffMs = cutoff.getTime();
  const lookFrom = cutoffMs - LOOKBACK_DAYS * 86_400_000;
  const staleBefore = cutoffMs - STALE_DAYS * 86_400_000;
  const weekBefore = cutoffMs - 7 * 86_400_000;
  const trustFrom = cutoffMs - TRUST_DAYS * 86_400_000;

  const bySource = { not_yet: bucket(), shopify: bucket(), app: bucket(), apc: bucket(), estimate: bucket() };
  const coverage: Record<DispatchState, number> = { shopify: 0, app: 0, apc: 0, estimate: 0, not_yet: 0, unknown: 0, nothing_to_send: 0 };
  const unknown = bucket(), laterCancelled = bucket(), staleUnsent = bucket(), nothingToSend = bucket();
  const lines: DeferredLine[] = [];
  let incVat = 0, exVat = 0;
  const seen = new Set<number>();

  for (const o of orders) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const paid = Date.parse(o.paidAt);
    if (!Number.isFinite(paid) || paid >= cutoffMs || paid < lookFrom) continue;
    if (UNPAID.has((o.financialStatus ?? "").toLowerCase())) continue;
    if (o.cancelledAt && Date.parse(o.cancelledAt) < cutoffMs) continue;
    const value = round2(o.totalPrice - refundedBy(o, cutoffMs));
    if (value <= 0.005) continue; // refunded in full by the month end

    const r = resolveDispatch(o);
    if (paid >= trustFrom) coverage[r.state]++;
    if (r.state === "nothing_to_send") { if (paid >= weekBefore) add(nothingToSend, value); continue; }
    const sent = dispatchedBy(r, monthEnd, cutoff);
    if (sent == null) { add(unknown, value); continue; }
    if (sent) continue;

    if (r.state === "not_yet" && paid < staleBefore) {
      const tag = despatchDay(o.tags);
      if (!tag || tag <= monthEnd) { add(staleUnsent, value); continue; }
    }

    const taxShare = o.totalPrice > 0 ? Math.min(1, Math.max(0, o.totalTax / o.totalPrice)) : 0;
    const ex = round2(value * (1 - taxShare));
    const later = !!o.cancelledAt || o.refunds.some(x => Date.parse(x.at) >= cutoffMs && x.amount > 0);
    if (later) add(laterCancelled, value);
    add(bySource[r.state === "not_yet" ? "not_yet" : r.state], value);
    incVat += value;
    exVat += ex;
    lines.push({
      id: o.id, name: o.name, paidAt: o.paidAt,
      dispatchedOn: r.state === "not_yet" ? null : r.day,
      source: r.state, incVat: value, exVat: ex, laterCancelled: later,
    });
  }
  lines.sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.name.localeCompare(b.name));

  const warnings: string[] = [];
  const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (unknown.orders > 0) {
    warnings.push(`${unknown.orders} order${unknown.orders === 1 ? "" : "s"} (${money(unknown.incVat)}) marked sent in Shopify with no dispatch date anywhere — not deferred; check ${unknown.orders === 1 ? "it" : "them"} in Shopify.`);
  }
  if (bySource.estimate.orders > 0) {
    warnings.push(`${bySource.estimate.orders} deferred order${bySource.estimate.orders === 1 ? "'s" : "s'"} dispatch day (${money(bySource.estimate.incVat)}) is estimated from the delivery-date tag.`);
  }
  if (staleUnsent.orders > 0) {
    warnings.push(`${staleUnsent.orders} order${staleUnsent.orders === 1 ? "" : "s"} (${money(staleUnsent.incVat)}) paid over ${STALE_DAYS} days before ${shortDay(monthEnd)} never show as sent — left out; check ${staleUnsent.orders === 1 ? "it" : "them"} in Shopify.`);
  }

  const trust = dispatchTrust(coverage);
  if (!trust.trustworthy) warnings.unshift(`Not enough real dispatch records to trust this figure. ${trust.summary}`);

  return {
    monthEnd, label: monthLabel(monthEnd), cutoffUtc: cutoff.toISOString(),
    orders: lines.length, incVat: round2(incVat), exVat: round2(exVat), vat: round2(incVat - exVat),
    bySource, coverage, unknown, laterCancelled, staleUnsent, nothingToSend, trust, lines, warnings,
  };
}

// ── Shopify payload → DeferralOrder ──────────────────────────────────────

/** The parts of a Shopify REST order this needs. */
export interface ShopifyOrderPayload {
  id: number | string;
  name?: string | null;
  created_at: string;
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  total_price?: string | number | null;
  total_tax?: string | number | null;
  tags?: string | null;
  line_items?: Array<{ requires_shipping?: boolean | null; tax_lines?: Array<{ price?: string | number | null }> | null }> | null;
  refunds?: Array<{ created_at?: string | null; processed_at?: string | null; transactions?: Array<{ kind?: string | null; status?: string | null; amount?: string | number | null }> | null }> | null;
  fulfillments?: Array<{ created_at?: string | null; status?: string | null }> | null;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function deferralOrderFromShopify(
  p: ShopifyOrderPayload,
  extra: { appFulfilledAt?: string | null; apcCollectionDate?: string | null } = {},
): DeferralOrder {
  const lines = p.line_items ?? [];
  // total_tax isn't in older mirror rows; the line tax is the same thing
  // here (no VAT on delivery measured: £0.00 over 2,023 July orders).
  const tax = p.total_tax != null ? num(p.total_tax)
    : lines.reduce((n, li) => n + (li.tax_lines ?? []).reduce((m, t) => m + num(t.price), 0), 0);
  return {
    id: Number(p.id),
    name: p.name ?? String(p.id),
    paidAt: p.created_at,
    cancelledAt: p.cancelled_at ?? null,
    financialStatus: p.financial_status ?? null,
    fulfillmentStatus: p.fulfillment_status ?? null,
    totalPrice: num(p.total_price),
    totalTax: tax,
    refunds: (p.refunds ?? []).map(r => ({
      at: r.processed_at ?? r.created_at ?? "",
      amount: (r.transactions ?? []).filter(t => (t.kind ?? "") === "refund" && (t.status ?? "") === "success").reduce((n, t) => n + num(t.amount), 0),
    })).filter(r => r.at),
    // A line with requires_shipping unset counts as needing sending.
    requiresShipping: lines.length === 0 || lines.some(li => li.requires_shipping !== false),
    tags: p.tags ?? null,
    shopifyFulfilments: p.fulfillments == null ? null
      : p.fulfillments.filter(f => (f.status ?? "success") === "success" && f.created_at).map(f => f.created_at!),
    appFulfilledAt: extra.appFulfilledAt ?? null,
    apcCollectionDate: extra.apcCollectionDate ?? null,
  };
}

// ── Labour ────────────────────────────────────────────────────────────────

export interface EmployerCostSettings {
  /** e.g. 0.15 */
  niRate: number;
  /** Per person per week, e.g. 96.15 */
  niWeeklyThreshold: number;
  /** e.g. 0.03 */
  pensionRate: number;
}

export interface EmployerEstimate { ni: number; pension: number; total: number; note: string }

/** Employer NI and pension on a few days' pay — an ESTIMATE: NI per person
 *  above the weekly threshold pro-rated to the days, at the settings' rate,
 *  with no Employment Allowance taken off; pension at the flat rate on all
 *  pay (no qualifying-earnings band, no opt-outs). */
export function estimateEmployerCosts(payByPerson: readonly number[], days: number, s: EmployerCostSettings): EmployerEstimate {
  const threshold = s.niWeeklyThreshold * days / 7;
  const ni = payByPerson.reduce((n, p) => n + Math.max(0, p - threshold) * s.niRate, 0);
  const pension = payByPerson.reduce((n, p) => n + Math.max(0, p) * s.pensionRate, 0);
  return {
    ni: round2(ni), pension: round2(pension), total: round2(ni + pension),
    note: `Estimate: employer NI at ${round2(s.niRate * 100)}% above £${s.niWeeklyThreshold.toFixed(2)} a week per person (pro-rata, before any Employment Allowance) + pension at ${round2(s.pensionRate * 100)}% of pay.`,
  };
}

export interface MonthEndLabour {
  monthEnd: string;
  from: string;
  to: string;
  people: number;
  /** Worked (production + office) + holiday. */
  hours: number;
  pay: number;
  workedHours: number;
  workedPay: number;
  holidayHours: number;
  holidayPay: number;
  /** People with holiday in the window but no hourly rate there to price it. */
  holidayByHand: number;
  employer: EmployerEstimate | null;
  /** The pay period isn't over, so more shifts may still be approved. */
  provisional: boolean;
  warnings: string[];
}

/** The figures assemblePayroll gives for the 25th → month-end window. */
export interface LabourWindowTotals {
  people: Array<{ grossPay: number; hours: number; holidayHours: number; holidayPay: number | null }>;
  totals: { hours: number; grossPay: number; holidayHours: number; holidayPay: number };
  warnings: string[];
}

export function summariseMonthEndLabour(
  monthEnd: string, data: LabourWindowTotals, settings: EmployerCostSettings | null, today: string,
): MonthEndLabour {
  const w = labourWindow(monthEnd);
  const days = Math.round((Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000) + 1;
  const holidayByHand = data.people.filter(p => p.holidayHours > 0 && p.holidayPay == null).length;
  const provisional = !isFinal(monthEnd, today);
  const warnings = data.warnings.filter(x => /holiday|rate changed|salaried|wage type/i.test(x));
  if (provisional) warnings.unshift(`The pay period ${payPeriodForMonthEnd(monthEnd).label} isn't over yet — more shifts may still be approved in Planday.`);
  return {
    monthEnd, from: w.from, to: w.to,
    people: data.people.length,
    hours: round2(data.totals.hours), pay: round2(data.totals.grossPay),
    workedHours: round2(data.totals.hours - data.totals.holidayHours),
    workedPay: round2(data.totals.grossPay - data.totals.holidayPay),
    holidayHours: round2(data.totals.holidayHours), holidayPay: round2(data.totals.holidayPay),
    holidayByHand,
    employer: settings ? estimateEmployerCosts(data.people.map(p => p.grossPay), days, settings) : null,
    provisional,
    warnings,
  };
}

// ── History ──────────────────────────────────────────────────────────────

export interface HistoryPoint {
  monthEnd: string;
  deferred: { incVat: number; exVat: number; orders: number } | null;
  labour: { pay: number; hours: number; employer: number | null } | null;
  /** false when the dispatch dates behind the deferral are too thin. */
  trustworthy?: boolean | null;
  /** Anything the accountant should know about this month end. */
  notes: string[];
  error?: string | null;
}

export interface Movement { opening: number | null; closing: number | null; movement: number | null }

export interface HistoryRow {
  monthEnd: string;
  label: string;
  /** TCK's financial year (April → March) the month belongs to: "2025/26". */
  financialYear: string;
  /** The first row: the opening balance, not a month of its own. */
  isOpening: boolean;
  deferredIncVat: Movement;
  deferredExVat: Movement;
  deferredOrders: number | null;
  labourPay: Movement;
  labourHours: number | null;
  labourEmployer: Movement;
  trustworthy: boolean | null;
  notes: string[];
  error: string | null;
}

const mv = (opening: number | null, closing: number | null): Movement => ({
  opening, closing, movement: opening != null && closing != null ? round2(closing - opening) : null,
});

/** TCK's financial year ends 31 March: Apr 2025 – Mar 2026 is "2025/26". */
export function financialYearOf(monthEnd: string): string {
  const { y, m } = ymd(monthEnd);
  const start = m >= 3 ? y : y - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The financial year that starts the day after a 31 March. */
const yearAfter = (marchEnd: string) => financialYearOf(addDaysToDateString(marchEnd, 1));
const isYearEnd = (monthEnd: string) => monthEnd.slice(5) === "03-31";

export function historyRowLabel(monthEnd: string, isOpening: boolean): string {
  if (isOpening) {
    if (monthEnd === NOV_2025) return NOV_2025_OPENING_LABEL;
    if (isYearEnd(monthEnd)) return `Opening balance for the ${yearAfter(monthEnd)} financial year — ${shortDay(monthEnd)}`;
    return `Opening balance — ${shortDay(monthEnd)}`;
  }
  if (isYearEnd(monthEnd)) return `${monthLabel(monthEnd)} — closing is the Opening balance for the ${yearAfter(monthEnd)} financial year`;
  if (monthEnd === NOV_2025) return `${monthLabel(monthEnd)} — closing is the ${NOV_2025_OPENING_LABEL}`;
  return monthLabel(monthEnd);
}

/** Each month's opening is the previous month end's closing; the movement
 *  is closing − opening. The first point is the opening balance. */
export function chainHistory(points: readonly HistoryPoint[]): HistoryRow[] {
  const sorted = [...points].sort((a, b) => a.monthEnd.localeCompare(b.monthEnd));
  return sorted.map((p, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const isOpening = i === 0;
    const pick = <T,>(x: T | null | undefined) => (isOpening ? null : x ?? null);
    return {
      monthEnd: p.monthEnd,
      label: historyRowLabel(p.monthEnd, isOpening),
      financialYear: financialYearOf(p.monthEnd),
      isOpening,
      deferredIncVat: mv(pick(prev?.deferred?.incVat), p.deferred?.incVat ?? null),
      deferredExVat: mv(pick(prev?.deferred?.exVat), p.deferred?.exVat ?? null),
      deferredOrders: p.deferred?.orders ?? null,
      labourPay: mv(pick(prev?.labour?.pay), p.labour?.pay ?? null),
      labourHours: p.labour?.hours ?? null,
      labourEmployer: mv(pick(prev?.labour?.employer), p.labour?.employer ?? null),
      trustworthy: p.trustworthy ?? null,
      notes: p.notes,
      error: p.error ?? null,
    };
  });
}

export interface FinancialYearGroup {
  /** "2025/26" */
  year: string;
  /** "Apr 2025 – Mar 2026" */
  span: string;
  /** The year's month ends in the history so far (its 31 March included). */
  rows: HistoryRow[];
  /** false while the year's 31 March isn't in the history yet. */
  complete: boolean;
  /** Opening = the month end before the year's first month (the prior 31
   *  March for a whole year); closing = its last month end so far;
   *  movement = closing − opening = the sum of the months' movements. */
  deferredIncVat: Movement;
  deferredExVat: Movement;
  labourPay: Movement;
  labourEmployer: Movement;
}

/** The months grouped by financial year (April → March). The history's
 *  opening-balance row opens the year after it; it isn't a year itself. */
export function groupByFinancialYear(rows: readonly HistoryRow[]): FinancialYearGroup[] {
  const groups: FinancialYearGroup[] = [];
  for (const r of rows) {
    if (r.isOpening) continue;
    let g = groups.find(x => x.year === r.financialYear);
    if (!g) {
      const start = Number(r.financialYear.slice(0, 4));
      g = {
        year: r.financialYear, span: `Apr ${start} – Mar ${start + 1}`, rows: [], complete: false,
        deferredIncVat: mv(null, null), deferredExVat: mv(null, null), labourPay: mv(null, null), labourEmployer: mv(null, null),
      };
      groups.push(g);
    }
    g.rows.push(r);
  }
  for (const g of groups) {
    const first = g.rows[0];
    const last = g.rows[g.rows.length - 1];
    g.complete = isYearEnd(last.monthEnd);
    g.deferredIncVat = mv(first.deferredIncVat.opening, last.deferredIncVat.closing);
    g.deferredExVat = mv(first.deferredExVat.opening, last.deferredExVat.closing);
    g.labourPay = mv(first.labourPay.opening, last.labourPay.closing);
    g.labourEmployer = mv(first.labourEmployer.opening, last.labourEmployer.closing);
  }
  return groups;
}

const csvCell = (v: string | number | null) => {
  if (v == null) return "";
  const s = typeof v === "number" ? v.toFixed(2) : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The history as a CSV grouped by financial year: the opening balance,
 *  then each year's months and a "Year total" line (opening, closing,
 *  movement). */
export function historyCsv(rows: readonly HistoryRow[]): string {
  const head = [
    "Financial year", "Month end", "Line",
    "Deferred income opening (inc VAT)", "Deferred income closing (inc VAT)", "Deferred income movement (closing - opening; take off this month's sales)",
    "Deferred income opening (ex VAT)", "Deferred income closing (ex VAT)", "Deferred income movement (ex VAT)", "Deferred orders",
    "Labour accrual opening (25th to month end, gross pay)", "Labour accrual closing (gross pay)", "Labour accrual movement (closing - opening; add to this month's wages)", "Labour accrual hours",
    "Employer NI + pension estimate opening", "Employer NI + pension estimate closing", "Employer NI + pension estimate movement",
    "Dispatch dates trustworthy", "Notes",
  ];
  const out = [head.map(csvCell).join(",")];
  const line = (r: HistoryRow) => out.push([
    r.financialYear, r.monthEnd, r.label,
    r.deferredIncVat.opening, r.deferredIncVat.closing, r.deferredIncVat.movement,
    r.deferredExVat.opening, r.deferredExVat.closing, r.deferredExVat.movement, r.deferredOrders == null ? null : String(r.deferredOrders),
    r.labourPay.opening, r.labourPay.closing, r.labourPay.movement, r.labourHours,
    r.labourEmployer.opening, r.labourEmployer.closing, r.labourEmployer.movement,
    r.trustworthy == null ? null : r.trustworthy ? "yes" : "NO - check",
    [...r.notes, ...(r.error ? [r.error] : [])].join(" "),
  ].map(csvCell).join(","));
  const opening = rows.find(r => r.isOpening);
  if (opening) line(opening);
  for (const g of groupByFinancialYear(rows)) {
    for (const r of g.rows) line(r);
    out.push([
      g.year, "", `Year total ${g.year} (${g.span})${g.complete ? "" : " - year not finished"}`,
      g.deferredIncVat.opening, g.deferredIncVat.closing, g.deferredIncVat.movement,
      g.deferredExVat.opening, g.deferredExVat.closing, g.deferredExVat.movement, null,
      g.labourPay.opening, g.labourPay.closing, g.labourPay.movement, null,
      g.labourEmployer.opening, g.labourEmployer.closing, g.labourEmployer.movement,
      null, null,
    ].map(csvCell).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

/** The month's deferred orders, one per row — for the accountant to tick. */
export function deferredLinesCsv(d: DeferredIncome): string {
  const SOURCE: Record<DispatchState, string> = {
    shopify: "Shopify fulfilment", app: "App fulfil record", apc: "APC collection date", estimate: "Estimated from delivery date",
    not_yet: "Not sent yet", unknown: "Unknown", nothing_to_send: "Nothing to send",
  };
  const out = [["Order", "Paid (London)", "Dispatched (London day)", "How we know", "Inc VAT", "Ex VAT", "Cancelled or refunded after month end"].map(csvCell).join(",")];
  for (const l of d.lines) {
    const paid = new Date(l.paidAt);
    out.push([
      l.name,
      `${londonDateString(paid)} ${paid.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}`,
      l.dispatchedOn ?? "not yet",
      SOURCE[l.source], l.incVat, l.exVat, l.laterCancelled ? "yes" : "",
    ].map(csvCell).join(","));
  }
  return out.join("\r\n") + "\r\n";
}
