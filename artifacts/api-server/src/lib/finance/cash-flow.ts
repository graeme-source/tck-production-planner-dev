/**
 * The cash-flow forecast (Graeme, 2026-10-26) — pure, tested. A running
 * bank balance, day by day:
 *
 *   start   the bank balance as set by hand, on the day it was true
 *   + in    Shopify payouts on their payout date (scheduled / in transit;
 *           paid ones on or after the balance date are already counted if
 *           the balance was set after them — see below), and hand-added money in
 *   − out   QuickBooks bills on their due date, and hand-added money out
 *           (one-off, or every N days — "the Capital card gets £5,000 every
 *           4 days")
 *
 * Things that should already have happened but haven't (an overdue bill, a
 * payout from before today not yet paid) land on today and are flagged, so
 * the forecast never quietly drops money that's still owed or owing.
 *
 * Days before today aren't forecast: the balance is "as of" a date, and
 * anything dated between that date and yesterday is applied on today (it
 * moved the bank since the balance was set).
 *
 * Which day a line sits on (2026-10-27, "drag things around ... set rules"):
 * a hand move (override) beats the supplier's payment rule, which beats
 * QuickBooks' due date, which beats the bill date. See cash-flow-rules.ts.
 */
import { describeRule, resolveBillDate, rulesByVendor, vendorKey, type DateBasis, type SupplierRule } from "./cash-flow-rules";

export interface CfBill {
  id: string; vendorName: string; docNumber: string | null;
  /** QuickBooks' DueDate — null when the Bill has none. */
  dueDate: string | null;
  balance: number;
  /** The bill date (QBO TxnDate). */
  txnDate?: string | null;
  termsName?: string | null;
  termsId?: string | null;
}
export interface CfPayout { id: string; date: string; status: "SCHEDULED" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELED"; net: number }
export interface CfItem {
  id: number; label: string; direction: "in" | "out"; amount: number;
  onDate: string | null; everyDays: number | null; startsOn: string | null; endsOn: string | null;
  vendorName: string | null; active: boolean;
}
/** A line moved by hand to `plannedDate` (2026-10-27). `occurrence` is the
 *  hand-added item's original date ("" for bills and payouts). */
export interface CfOverride { source: "bill" | "payout" | "item"; ref: string; occurrence: string; plannedDate: string }

export interface CfLine {
  source: "bill" | "payout" | "item";
  ref: string;
  /** source:ref:occurrence — what an override is keyed by. */
  key: string;
  occurrence: string;
  label: string;
  amount: number;
  /** The day it really falls on (may be before today — then it's shown on today, late). */
  date: string | null;
  /** Where it would sit without a hand move. */
  naturalDate: string | null;
  /** Set when moved by hand: the date it was moved from. */
  movedFrom?: string;
  /** Should have happened before today and hasn't — on today, flagged. */
  late: boolean;
  /** Bill with no due date in QuickBooks. */
  undated?: boolean;
  /** Bills: where the date came from, for the page to explain. */
  bill?: {
    vendorName: string;
    txnDate: string | null;
    qboDueDate: string | null;
    termsName: string | null;
    hasTerms: boolean;
    basis: DateBasis;
    naturalBasis: Exclude<DateBasis, "override">;
    ruleDate: string | null;
    ruleText: string | null;
  };
}

export interface CfDay { date: string; opening: number; ins: CfLine[]; outs: CfLine[]; closing: number }

export interface CashFlowForecast {
  start: string;
  openingBalance: number;
  days: CfDay[];
  lowest: { date: string; balance: number } | null;
  totalIn: number;
  totalOut: number;
}

const DAY = 86_400_000;
export function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Dates a hand-added item falls on, from..to inclusive. */
export function itemDates(item: CfItem, from: string, to: string): string[] {
  if (!item.active) return [];
  if (item.onDate) return item.onDate >= from && item.onDate <= to ? [item.onDate] : [];
  if (!item.everyDays || !item.startsOn) return [];
  const out: string[] = [];
  const end = item.endsOn && item.endsOn < to ? item.endsOn : to;
  for (let d = item.startsOn; d <= end; d = addDays(d, item.everyDays)) {
    if (d >= from) out.push(d);
    if (out.length > 400) break;
  }
  return out;
}

export const overrideKey = (source: CfLine["source"], ref: string, occurrence = "") => `${source}:${ref}:${occurrence}`;

export function forecastCashFlow(args: {
  today: string;
  days: number;
  balance: number;
  balanceAsOf: string;
  bills: readonly CfBill[];
  payouts: readonly CfPayout[];
  items: readonly CfItem[];
  /** Supplier payment rules — replace QuickBooks' due date (2026-10-27). */
  rules?: readonly SupplierRule[];
  /** Hand moves — beat rules and QuickBooks (2026-10-27). */
  overrides?: readonly CfOverride[];
}): CashFlowForecast {
  const { today, balance, balanceAsOf } = args;
  const start = balanceAsOf > today ? balanceAsOf : today;
  const end = addDays(start, Math.max(1, args.days) - 1);
  const ins = new Map<string, CfLine[]>();
  const outs = new Map<string, CfLine[]>();
  const put = (m: Map<string, CfLine[]>, date: string, line: CfLine) => m.set(date, [...(m.get(date) ?? []), line]);
  const ruleMap = rulesByVendor(args.rules ?? []);
  const moved = new Map<string, string>();
  for (const o of args.overrides ?? []) moved.set(overrideKey(o.source, o.ref, o.occurrence), o.plannedDate);

  for (const b of args.bills) {
    if (!(b.balance > 0)) continue;
    const label = `${b.vendorName}${b.docNumber ? ` · ${b.docNumber}` : ""}`;
    const key = overrideKey("bill", b.id);
    const rule = ruleMap.get(vendorKey(b.vendorName))?.rule ?? null;
    const r = resolveBillDate({ txnDate: b.txnDate ?? null, qboDueDate: b.dueDate, rule, override: moved.get(key) ?? null });
    const bill: NonNullable<CfLine["bill"]> = {
      vendorName: b.vendorName, txnDate: b.txnDate ?? null, qboDueDate: b.dueDate, termsName: b.termsName ?? null,
      hasTerms: !!(b.termsId || b.termsName), basis: r.basis, naturalBasis: r.naturalBasis, ruleDate: r.ruleDate,
      ruleText: rule && r.ruleDate ? describeRule(rule) : null,
    };
    const base = {
      source: "bill" as const, ref: b.id, key, occurrence: "", label, amount: b.balance, naturalDate: r.natural, bill,
      ...(b.dueDate ? {} : { undated: true }),
    };
    if (!r.date) { put(outs, start, { ...base, date: null, late: false, undated: true }); continue; }
    if (r.date > end) continue;
    put(outs, r.date < start ? start : r.date, {
      ...base, date: r.date, late: r.date < start,
      ...(r.basis === "override" && r.natural && r.natural !== r.date ? { movedFrom: r.natural } : {}),
    });
  }

  for (const p of args.payouts) {
    if (p.status === "FAILED" || p.status === "CANCELED") continue;
    // Paid before the balance was set: already in the bank figure.
    if (p.status === "PAID" && p.date < balanceAsOf) continue;
    const key = overrideKey("payout", p.id);
    const planned = moved.get(key);
    const date = planned ?? p.date;
    if (date > end) continue;
    const late = date < start && p.status !== "PAID";
    const when = date < start ? start : date;
    const line: CfLine = {
      source: "payout", ref: p.id, key, occurrence: "", label: `Shopify payout${p.status === "PAID" ? " (paid)" : ""}`, amount: Math.abs(p.net),
      date, naturalDate: p.date, late, ...(planned && planned !== p.date ? { movedFrom: p.date } : {}),
    };
    if (p.net >= 0) put(ins, when, line); else put(outs, when, { ...line, label: "Shopify payout (negative)" });
  }

  // A moved occurrence may come from beyond the window: look that far ahead.
  const furthest = new Map<string, string>();
  for (const o of args.overrides ?? []) {
    if (o.source !== "item" || !o.occurrence) continue;
    if (o.occurrence > (furthest.get(o.ref) ?? end)) furthest.set(o.ref, o.occurrence);
  }
  for (const it of args.items) {
    // Anything since the balance date moved the bank already-or-today.
    for (const d of itemDates(it, balanceAsOf, furthest.get(String(it.id)) ?? end)) {
      const key = overrideKey("item", String(it.id), d);
      const planned = moved.get(key);
      const date = planned ?? d;
      if (date > end) continue;
      const line: CfLine = {
        source: "item", ref: String(it.id), key, occurrence: d, label: it.vendorName ? `${it.label} · ${it.vendorName}` : it.label, amount: it.amount,
        date, naturalDate: d, late: date < start, ...(planned && planned !== d ? { movedFrom: d } : {}),
      };
      put(it.direction === "in" ? ins : outs, date < start ? start : date, line);
    }
  }

  const days: CfDay[] = [];
  let running = balance;
  let lowest: { date: string; balance: number } | null = null;
  let totalIn = 0, totalOut = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const i = ins.get(d) ?? [], o = outs.get(d) ?? [];
    const sumIn = i.reduce((s, l) => s + l.amount, 0), sumOut = o.reduce((s, l) => s + l.amount, 0);
    const opening = round2(running);
    running = running + sumIn - sumOut;
    totalIn += sumIn; totalOut += sumOut;
    const day: CfDay = { date: d, opening, ins: i, outs: o, closing: round2(running) };
    days.push(day);
    if (!lowest || day.closing < lowest.balance) lowest = { date: d, balance: day.closing };
  }
  return { start, openingBalance: round2(balance), days, lowest, totalIn: round2(totalIn), totalOut: round2(totalOut) };
}

/** An upstream error as one short readable line — Shopify's token errors
 *  arrive as a whole HTML page, which the chip on the page used to show in
 *  full (2026-10-26). */
export function shortError(e: string | null | undefined): string | null {
  if (!e) return null;
  const why = e.match(/Oauth error [^<\n]+/i)?.[0];
  const text = (why ?? e.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/**
 * Hand moves that no longer point at anything (2026-10-27): a bill that's
 * been paid drops out of QuickBooks' open bills, and a payout that's been
 * paid, failed or cancelled is done — their moves are dropped. Only called
 * with lists that loaded cleanly, so an outage never wipes anyone's plan.
 * Hand-added items are left alone (they're switched off, not deleted).
 */
export function staleOverrides(
  overrides: readonly CfOverride[],
  sources: { bills?: readonly { id: string }[] | null; payouts?: readonly { id: string; status: CfPayout["status"] }[] | null },
): CfOverride[] {
  const open = sources.bills ? new Set(sources.bills.map(b => b.id)) : null;
  const live = sources.payouts ? new Set(sources.payouts.filter(p => p.status === "SCHEDULED" || p.status === "IN_TRANSIT").map(p => p.id)) : null;
  return overrides.filter(o =>
    (o.source === "bill" && open !== null && !open.has(o.ref)) ||
    (o.source === "payout" && live !== null && !live.has(o.ref)));
}
