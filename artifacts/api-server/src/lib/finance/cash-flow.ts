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
 */

export interface CfBill { id: string; vendorName: string; docNumber: string | null; dueDate: string | null; balance: number }
export interface CfPayout { id: string; date: string; status: "SCHEDULED" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELED"; net: number }
export interface CfItem {
  id: number; label: string; direction: "in" | "out"; amount: number;
  onDate: string | null; everyDays: number | null; startsOn: string | null; endsOn: string | null;
  vendorName: string | null; active: boolean;
}

export interface CfLine {
  source: "bill" | "payout" | "item";
  ref: string;
  label: string;
  amount: number;
  /** Should have happened before today and hasn't — on today, flagged. */
  late: boolean;
  /** Bill with no due date — placed on today. */
  undated?: boolean;
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

export function forecastCashFlow(args: {
  today: string;
  days: number;
  balance: number;
  balanceAsOf: string;
  bills: readonly CfBill[];
  payouts: readonly CfPayout[];
  items: readonly CfItem[];
}): CashFlowForecast {
  const { today, balance, balanceAsOf } = args;
  const start = balanceAsOf > today ? balanceAsOf : today;
  const end = addDays(start, Math.max(1, args.days) - 1);
  const ins = new Map<string, CfLine[]>();
  const outs = new Map<string, CfLine[]>();
  const put = (m: Map<string, CfLine[]>, date: string, line: CfLine) => m.set(date, [...(m.get(date) ?? []), line]);

  for (const b of args.bills) {
    if (!(b.balance > 0)) continue;
    const label = `${b.vendorName}${b.docNumber ? ` · ${b.docNumber}` : ""}`;
    if (!b.dueDate) { put(outs, start, { source: "bill", ref: b.id, label, amount: b.balance, late: false, undated: true }); continue; }
    if (b.dueDate > end) continue;
    put(outs, b.dueDate < start ? start : b.dueDate, { source: "bill", ref: b.id, label, amount: b.balance, late: b.dueDate < start });
  }

  for (const p of args.payouts) {
    if (p.status === "FAILED" || p.status === "CANCELED" || p.date > end) continue;
    // Paid before the balance was set: already in the bank figure.
    if (p.status === "PAID" && p.date < balanceAsOf) continue;
    const late = p.date < start && p.status !== "PAID";
    const when = p.date < start ? start : p.date;
    const line: CfLine = { source: "payout", ref: p.id, label: `Shopify payout${p.status === "PAID" ? " (paid)" : ""}`, amount: Math.abs(p.net), late };
    if (p.net >= 0) put(ins, when, line); else put(outs, when, { ...line, label: "Shopify payout (negative)" });
  }

  for (const it of args.items) {
    // Anything since the balance date moved the bank already-or-today.
    for (const d of itemDates(it, balanceAsOf, end)) {
      const line: CfLine = { source: "item", ref: String(it.id), label: it.vendorName ? `${it.label} · ${it.vendorName}` : it.label, amount: it.amount, late: d < start };
      put(it.direction === "in" ? ins : outs, d < start ? start : d, line);
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
