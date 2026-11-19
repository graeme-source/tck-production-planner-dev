/**
 * A pulled kanban as a stock count, and how long the stock will last
 * (Graeme, 19 Nov 2026: "when that kanban is pulled, you can assume the
 * amount of packs in the safety stock is what we had left… maybe minus 1
 * pack" — and on the Orders page, "if that's out of stock, I can wait.
 * I've got 2, 3 weeks' worth"). Pure, unit-tested. Objective C.
 */

/** How much is left when the kanban card is pulled, in the ingredient's own
 *  unit: the card's safety stock, less the pack they've started on. */
export function kanbanLeftQty(i: {
  kanbanQuantity: number | string | null;
  kanbanUnit: string | null;
  packWeight: number | string | null;
  palletSize?: number | null;
}): number | null {
  const q = Number(i.kanbanQuantity);
  const pw = Number(i.packWeight);
  if (!Number.isFinite(q) || q <= 0) return null;
  const pack = Number.isFinite(pw) && pw > 0 ? pw : null;
  let native: number | null;
  // Read as packs, "weight" cards too: that's how the live cards are filled
  // in and how the Orders page has always ordered them (routes/orders.ts,
  // kanban-only lines — e.g. 6 on a 450 g spice pack means 6 packs).
  switch (i.kanbanUnit) {
    case "pallet": native = pack && i.palletSize && i.palletSize > 0 ? q * i.palletSize * pack : null; break;
    default: native = pack ? q * pack : null;
  }
  if (native == null) return null;
  const left = native - (pack ?? 0);
  return Math.max(0, Math.round(left * 10000) / 10000);
}

const DAY_MS = 86_400_000;

/**
 * Average use a day, from what the app knows: recorded usage where it's
 * tracked (prep, mixing, building), otherwise deliveries — over months,
 * what comes in is what gets used. The last delivery is left out (it's
 * still on the shelf), so it's everything before it over the days between
 * the first and the last. Needs a fortnight of history; null otherwise.
 */
export function dailyUse(args: {
  receipts: Array<{ at: number; qty: number }>;
  usage: Array<{ at: number; qty: number }>;
  coverage: "tracked" | "estimated" | "untracked";
  nowMs: number;
  windowDays?: number;
}): { perDay: number; basis: "usage" | "deliveries" } | null {
  const windowDays = args.windowDays ?? 90;
  const from = args.nowMs - windowDays * DAY_MS;
  if (args.coverage !== "untracked") {
    const used = args.usage.filter(u => u.at >= from && u.at <= args.nowMs && u.qty > 0);
    if (used.length > 0) {
      const first = Math.min(...used.map(u => u.at));
      const days = (args.nowMs - first) / DAY_MS;
      const total = used.reduce((s, u) => s + u.qty, 0);
      if (days >= 14 && total > 0) return { perDay: total / days, basis: "usage" };
    }
  }
  const got = args.receipts.filter(r => r.at >= from && r.at <= args.nowMs && r.qty > 0).sort((a, b) => a.at - b.at);
  if (got.length < 2) return null;
  const days = (got[got.length - 1].at - got[0].at) / DAY_MS;
  const used = got.slice(0, -1).reduce((s, r) => s + r.qty, 0);
  if (days < 14 || used <= 0) return null;
  return { perDay: used / days, basis: "deliveries" };
}

/** Whole days the stock lasts at that rate (null when it can't be said). */
export function daysOfStockLeft(stock: number, perDay: number | null | undefined): number | null {
  if (perDay == null || !Number.isFinite(perDay) || perDay <= 0 || !Number.isFinite(stock)) return null;
  return Math.max(0, Math.floor(Math.max(0, stock) / perDay));
}

/** "About 3 weeks left" — in the words someone deciding whether to wait uses. */
export function stockLeftLabel(days: number): string {
  if (days < 1) return "Less than a day left";
  if (days === 1) return "About 1 day left";
  if (days < 14) return `About ${days} days left`;
  if (days < 60) return `About ${Math.floor(days / 7)} weeks left`;
  return `About ${Math.floor(days / 30)} months left`;
}

// ── Order by when? ─────────────────────────────────────────────────────────
// (Graeme, 19 Nov 2026: "order by… order no later than… work back from the
// delivery date" using the supplier's lead time and order days — and warn
// when "Not today" would leave it too late.)

const isoDay = (iso: string) => new Date(`${iso}T12:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => { const d = isoDay(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
/** ISO weekday 1 (Mon) … 7 (Sun). */
const weekdayOf = (iso: string) => ((isoDay(iso).getUTCDay() + 6) % 7) + 1;
/** Lead time counts working days, like the Orders page's delivery date. */
function deliveredOn(orderIso: string, leadTimeDays: number): string {
  let d = orderIso;
  let left = Math.max(0, leadTimeDays);
  while (left > 0) { d = plusDays(d, 1); if (weekdayOf(d) <= 5) left--; }
  return d;
}

export type OrderUrgency = "now" | "today" | "last_chance" | "plenty";

export interface OrderByResult {
  /** The last order day whose delivery still arrives before it runs out
   *  (null = none: order now, it may already be late). */
  orderBy: string | null;
  urgency: OrderUrgency;
  /** The supplier's next order day after today. */
  nextOrderDay: string | null;
  runsOutOn: string;
}

/**
 * Works back from the day it runs out: the latest of the supplier's order
 * days (Mon–Fri when it takes orders daily) whose delivery, lead time later,
 * lands on or before that day. Today only counts before the cutoff.
 *  - "today": today is the last chance — it can't be put off.
 *  - "last_chance": putting it off today is fine, but the next order day is
 *    the last one.
 */
export function orderByDate(args: {
  today: string;
  /** London minutes past midnight now, and the supplier's "HH:MM" cutoff. */
  nowMinute: number;
  cutoff: string | null | undefined;
  leadTimeDays: number;
  /** ISO weekdays the supplier takes orders; null = every working day. */
  orderWeekdays: ReadonlySet<number> | null;
  daysLeft: number;
}): OrderByResult {
  const runsOutOn = plusDays(args.today, Math.max(0, args.daysLeft));
  const [h, m] = String(args.cutoff ?? "17:00").split(":").map(Number);
  const cutoffMinute = (Number.isFinite(h) ? h : 17) * 60 + (Number.isFinite(m) ? m : 0);
  const canOrderOn = (iso: string) => {
    const wd = weekdayOf(iso);
    const ok = args.orderWeekdays ? args.orderWeekdays.has(wd) : wd <= 5;
    return ok && (iso !== args.today || args.nowMinute < cutoffMinute);
  };
  let orderBy: string | null = null;
  let nextOrderDay: string | null = null;
  // Look a little past the run-out so "next order day" is always found.
  for (let i = 0; i <= Math.max(args.daysLeft, 0) + 14; i++) {
    const d = plusDays(args.today, i);
    if (!canOrderOn(d)) continue;
    if (i > 0 && nextOrderDay == null) nextOrderDay = d;
    if (d <= runsOutOn && deliveredOn(d, args.leadTimeDays) <= runsOutOn) orderBy = d;
  }
  const urgency: OrderUrgency = orderBy == null ? "now"
    : orderBy <= args.today ? "today"
    : orderBy === nextOrderDay ? "last_chance"
    : "plenty";
  return { orderBy, urgency, nextOrderDay, runsOutOn };
}

const WEEKDAY_NUMBER: Record<string, number> = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

/** A supplier's order days as ISO weekdays: only "weekly" suppliers with
 *  days set are limited; everyone else takes orders every working day. */
export function supplierOrderWeekdays(orderFrequency: string | null | undefined, orderDays: string | null | undefined): Set<number> | null {
  if (orderFrequency !== "weekly" || !orderDays) return null;
  const set = new Set(orderDays.split(",").map(d => WEEKDAY_NUMBER[d.trim()]).filter((n): n is number => !!n));
  return set.size > 0 ? set : null;
}
