/**
 * Trend graphs for the founder Numbers page (Objective I) — pure maths.
 *
 * Graeme asked for a line graph behind each Order Analysis tile "so I can
 * see visually what I've done over that period", hourly, daily or weekly as
 * suits the period. This module turns the SAME orders the tiles count into
 * buckets over time. The rule everything here protects:
 *
 *   the graph must reconcile with the tile above it.
 *
 *   - Money is summed in whole pence, so the buckets add up to the period
 *     total exactly — no drifting penny.
 *   - Orders are filtered and valued by lib/order-revenue.ts, the same rules
 *     the tiles use.
 *   - Ratios are weighted, never averaged: a bucket's AOV is its revenue ÷
 *     its orders, and the period AOV is total revenue ÷ total orders — NOT
 *     the mean of the bucket AOVs (one £200 wholesale order in a quiet hour
 *     would otherwise swing the whole day).
 *   - ROAS follows lib/roas.ts on the page: a bucket only gets a figure when
 *     EVERY day in it has an ad-spend figure. "—" means "we don't know",
 *     never 0%.
 *
 * Time is London time throughout. Hour buckets are real hours, so the day
 * the clocks go back has two 01:00 hours (told apart in the tooltip) and
 * the day they go forward has no 01:00 at all. Weeks start on Monday.
 */
import type { ShopifyOrder } from "../services/shopify";
import {
  getNetRevenue, isCountableOrder, orderHasTag,
  NEW_CUSTOMER_TAG, NEW_SUB_TAG, RECURRING_SUB_TAG, SUBSCRIPTION_TAGS,
} from "./order-revenue";
import { addDaysToDateString, londonDateString, londonDayStartUtc, londonHour } from "./london-time";

export type Granularity = "hour" | "day" | "week";

/** Longest period that can still be drawn day by day (a year and a bit). */
export const MAX_DAILY_DAYS = 400;
/** Longest period the endpoint accepts at all. */
export const MAX_TREND_DAYS = 800;

export interface GranularityOptions {
  /** What the graph opens on. */
  granularity: Granularity;
  /** What the Daily/Weekly toggle may offer (one entry = no toggle). */
  allowed: Granularity[];
}

/**
 * The right grain for a period of `dayCount` London days:
 *
 *   1 day            by the hour
 *   2–13 days        by the day (a week toggle would draw one or two points)
 *   14–60 days       by the day, with a Weekly toggle
 *   61+ days         by the week, with a Daily toggle up to MAX_DAILY_DAYS
 */
export function granularityOptions(dayCount: number): GranularityOptions {
  if (dayCount <= 1) return { granularity: "hour", allowed: ["hour"] };
  if (dayCount < 14) return { granularity: "day", allowed: ["day"] };
  if (dayCount <= 60) return { granularity: "day", allowed: ["day", "week"] };
  if (dayCount <= MAX_DAILY_DAYS) return { granularity: "week", allowed: ["day", "week"] };
  return { granularity: "week", allowed: ["week"] };
}

/** The requested grain when it makes sense for the period, else the default. */
export function resolveGranularity(dayCount: number, requested?: Granularity | null): Granularity {
  const opts = granularityOptions(dayCount);
  return requested && opts.allowed.includes(requested) ? requested : opts.granularity;
}

/** Inclusive count of days from `from` to `to`; 0 when `from` is later. */
export function dayCountBetween(from: string, to: string): number {
  if (from > to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Monday of the week a London date falls in. */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysToDateString(date, dow === 0 ? -6 : 1 - dow);
}

// ── Per-bucket figures ─────────────────────────────────────────────────────

/** Everything a bucket adds up, in whole pence and whole orders. */
interface Tally {
  revenueP: number;
  orders: number;
  newCustomerRevenueP: number;
  newCustomerOrders: number;
  recurringSubOrders: number;
  newSubOrders: number;
  subscriptionRevenueP: number;
  subscriptionOrders: number;
}

const emptyTally = (): Tally => ({
  revenueP: 0, orders: 0,
  newCustomerRevenueP: 0, newCustomerOrders: 0,
  recurringSubOrders: 0, newSubOrders: 0,
  subscriptionRevenueP: 0, subscriptionOrders: 0,
});

/** The figures the page graphs, per bucket and for the whole period. */
export interface TrendFigures {
  /** Net revenue, £ — the Total Sales tile. */
  revenue: number;
  /** Countable orders — the Total Sales tile's sub-line. */
  orders: number;
  /** revenue ÷ orders; null with no orders (a gap, not £0). */
  aov: number | null;
  newCustomerRevenue: number;
  newCustomerOrders: number;
  recurringSubOrders: number;
  newSubOrders: number;
  /** Orders carrying either subscription tag, each counted once. */
  subscriptionRevenue: number;
  subscriptionOrders: number;
  /** Recorded ad spend over the bucket's days; null when none recorded. */
  adSpend: number | null;
  /** How many of the bucket's days have a spend figure, and how many it has. */
  spendDaysRecorded: number;
  spendDays: number;
  /** New-customer revenue ÷ spend as a whole %, only when every day has a
   *  spend figure and the spend is above zero. */
  roasPercent: number | null;
}

export interface TrendBucket extends TrendFigures {
  /** Stable id: the hour's UTC start, or the London date the day/week starts. */
  key: string;
  /** UTC instants the bucket covers, [start, end). */
  start: string;
  end: string;
  /** Short axis label: "14:00", "24 Sep", "22 Sep". */
  label: string;
  /** Tooltip heading: "Wed 24 Sep, 14:00–15:00", "Wednesday 24 September". */
  longLabel: string;
  /** London hour of day for hour buckets (lines up today against last week). */
  hourOfDay: number | null;
  /** Days of the PERIOD inside this bucket (weeks at either end may be short). */
  dayCount: number;
  /** Starts after "now": nothing can have happened yet — drawn as no line. */
  future: boolean;
  /** Still running at "now", or a week cut short by the period. */
  partial: boolean;
}

export interface TrendSeries {
  from: string;
  to: string;
  granularity: Granularity;
  allowed: Granularity[];
  buckets: TrendBucket[];
  /** The whole period — equals the tiles for the same from/to. */
  totals: TrendFigures;
  /** Orders we were handed that fell outside the period (should be 0 — the
   *  read is bounded to the same London days). Counted, never dropped silently. */
  outsideOrders: number;
}

export interface SpendDay {
  date: string;
  amount: number | null;
}

type TrendOrder = Pick<ShopifyOrder, "id" | "created_at" | "cancelled_at" | "financial_status" | "total_price" | "refunds" | "tags">;

const pence = (pounds: number) => Math.round(pounds * 100);
const pounds = (p: number) => p / 100;

function addOrder(t: Tally, o: TrendOrder): void {
  const p = pence(getNetRevenue(o));
  t.revenueP += p;
  t.orders += 1;
  if (orderHasTag(o, NEW_CUSTOMER_TAG)) { t.newCustomerRevenueP += p; t.newCustomerOrders += 1; }
  if (orderHasTag(o, RECURRING_SUB_TAG)) t.recurringSubOrders += 1;
  if (orderHasTag(o, NEW_SUB_TAG)) t.newSubOrders += 1;
  if (SUBSCRIPTION_TAGS.some(tag => orderHasTag(o, tag))) { t.subscriptionRevenueP += p; t.subscriptionOrders += 1; }
}

/** ROAS over a set of days — the page's windowRoas rule, as a whole %. */
export function roasPercentFor(newCustomerRevenue: number, spendDaysRecorded: number, spendDays: number, spend: number | null): number | null {
  if (spendDays === 0 || spendDaysRecorded < spendDays) return null;
  if (spend == null || spend <= 0) return null;
  return Math.round((newCustomerRevenue / spend) * 100);
}

function figures(t: Tally, days: string[], spendByDate: Map<string, number>): TrendFigures {
  let spendP = 0;
  let recorded = 0;
  for (const d of days) {
    const amount = spendByDate.get(d);
    if (amount == null) continue;
    recorded += 1;
    spendP += pence(amount);
  }
  const adSpend = recorded > 0 ? pounds(spendP) : null;
  const newCustomerRevenue = pounds(t.newCustomerRevenueP);
  return {
    revenue: pounds(t.revenueP),
    orders: t.orders,
    aov: t.orders > 0 ? t.revenueP / t.orders / 100 : null,
    newCustomerRevenue,
    newCustomerOrders: t.newCustomerOrders,
    recurringSubOrders: t.recurringSubOrders,
    newSubOrders: t.newSubOrders,
    subscriptionRevenue: pounds(t.subscriptionRevenueP),
    subscriptionOrders: t.subscriptionOrders,
    adSpend,
    spendDaysRecorded: recorded,
    spendDays: days.length,
    roasPercent: roasPercentFor(newCustomerRevenue, recorded, days.length, adSpend),
  };
}

// ── Bucket frames ──────────────────────────────────────────────────────────

interface Frame {
  key: string;
  start: Date;
  end: Date;
  label: string;
  longLabel: string;
  hourOfDay: number | null;
  /** Period days this bucket covers (for spend and ROAS; hour buckets: none). */
  days: string[];
  dayCount: number;
  shortWeek: boolean;
}

// Labels are spelled out from the date string rather than via Intl month
// names, which differ between ICU versions ("Sep" vs "Sept").
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parts = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return { day: d.getUTCDate(), month: d.getUTCMonth(), dow: d.getUTCDay() };
};
/** "24 Sep" */
const shortDay = (date: string) => { const p = parts(date); return `${p.day} ${MONTHS_SHORT[p.month]}`; };
/** "Thu 24 Sep" */
const weekdayShort = (date: string) => { const p = parts(date); return `${DAYS_SHORT[p.dow]} ${p.day} ${MONTHS_SHORT[p.month]}`; };
/** "Thursday 24 September" */
const weekdayLong = (date: string) => { const p = parts(date); return `${DAYS_LONG[p.dow]} ${p.day} ${MONTHS_LONG[p.month]}`; };

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

function hourFrames(from: string, to: string): Frame[] {
  const start = londonDayStartUtc(from).getTime();
  const end = londonDayStartUtc(addDaysToDateString(to, 1)).getTime();
  const frames: Frame[] = [];
  for (let t = start; t < end; t += 3_600_000) {
    const s = new Date(t);
    const h = londonHour(s);
    frames.push({
      key: s.toISOString(),
      start: s,
      end: new Date(t + 3_600_000),
      label: hh(h),
      longLabel: `${weekdayShort(londonDateString(s))}, ${hh(h)}–${hh((h + 1) % 24)}`,
      hourOfDay: h,
      days: [],
      dayCount: 0,
      shortWeek: false,
    });
  }
  // The day the clocks go back has two 01:00s — say which is which. The
  // first is still summer time (BST), the second is GMT.
  const byLabel = new Map<string, Frame[]>();
  for (const f of frames) byLabel.set(f.longLabel, [...(byLabel.get(f.longLabel) ?? []), f]);
  for (const group of byLabel.values()) {
    if (group.length < 2) continue;
    group.forEach((f, i) => { f.longLabel += i === 0 ? " (BST)" : " (GMT)"; });
  }
  return frames;
}

function dayFrames(from: string, to: string): Frame[] {
  const frames: Frame[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) {
    frames.push({
      key: d,
      start: londonDayStartUtc(d),
      end: londonDayStartUtc(addDaysToDateString(d, 1)),
      label: shortDay(d),
      longLabel: weekdayLong(d),
      hourOfDay: null,
      days: [d],
      dayCount: 1,
      shortWeek: false,
    });
  }
  return frames;
}

function weekFrames(from: string, to: string): Frame[] {
  const frames: Frame[] = [];
  for (let monday = mondayOf(from); monday <= to; monday = addDaysToDateString(monday, 7)) {
    const sunday = addDaysToDateString(monday, 6);
    const first = monday < from ? from : monday;
    const last = sunday > to ? to : sunday;
    const days: string[] = [];
    for (let d = first; d <= last; d = addDaysToDateString(d, 1)) days.push(d);
    const short = days.length < 7;
    frames.push({
      key: monday,
      start: londonDayStartUtc(first),
      end: londonDayStartUtc(addDaysToDateString(last, 1)),
      label: shortDay(monday),
      longLabel: `Week of ${weekdayShort(monday)}${short ? ` — ${days.length} of 7 days in this period` : ""}`,
      hourOfDay: null,
      days,
      dayCount: days.length,
      shortWeek: short,
    });
  }
  return frames;
}

function framesFor(granularity: Granularity, from: string, to: string): Frame[] {
  if (granularity === "hour") return hourFrames(from, to);
  if (granularity === "day") return dayFrames(from, to);
  return weekFrames(from, to);
}

/** Which bucket an order belongs to, by key; null when outside the period. */
function keyFor(granularity: Granularity, createdMs: number, from: string, to: string): string | null {
  const day = londonDateString(new Date(createdMs));
  if (day < from || day > to) return null;
  if (granularity === "hour") return new Date(Math.floor(createdMs / 3_600_000) * 3_600_000).toISOString();
  if (granularity === "day") return day;
  return mondayOf(day);
}

// ── The series ─────────────────────────────────────────────────────────────

export interface BuildTrendInput {
  from: string;
  to: string;
  /** Requested grain; ignored when it doesn't suit the period. */
  granularity?: Granularity | null;
  /** The orders the tiles count for from..to (uncounted ones are filtered here). */
  orders: TrendOrder[];
  /** Ad spend rows; days absent or null count as "not recorded". */
  spend: SpendDay[];
  /** "Now", for marking the running and future buckets. */
  now: Date;
}

export function buildTrendSeries(input: BuildTrendInput): TrendSeries {
  const { from, to, orders, spend, now } = input;
  const dayCount = dayCountBetween(from, to);
  const opts = granularityOptions(dayCount);
  const granularity = resolveGranularity(dayCount, input.granularity);

  const spendByDate = new Map<string, number>();
  for (const row of spend) {
    if (row.amount == null || !Number.isFinite(row.amount)) continue;
    if (!spendByDate.has(row.date)) spendByDate.set(row.date, row.amount);
  }

  const frames = framesFor(granularity, from, to);
  const tallies = new Map<string, Tally>(frames.map(f => [f.key, emptyTally()]));
  const total = emptyTally();
  let outsideOrders = 0;

  // Dedupe by id exactly as the Sales Summary tile does.
  const unique = [...new Map(orders.map(o => [o.id, o])).values()];
  for (const o of unique) {
    if (!isCountableOrder(o)) continue;
    const ms = Date.parse(o.created_at);
    const key = Number.isFinite(ms) ? keyFor(granularity, ms, from, to) : null;
    const tally = key != null ? tallies.get(key) : undefined;
    if (!tally) { outsideOrders += 1; continue; }
    addOrder(tally, o);
    addOrder(total, o);
  }

  const nowMs = now.getTime();
  const periodDays: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) periodDays.push(d);

  const buckets: TrendBucket[] = frames.map(f => {
    const future = f.start.getTime() > nowMs;
    const running = !future && f.end.getTime() > nowMs;
    return {
      key: f.key,
      start: f.start.toISOString(),
      end: f.end.toISOString(),
      label: f.label,
      longLabel: f.longLabel,
      hourOfDay: f.hourOfDay,
      dayCount: f.dayCount,
      future,
      partial: running || f.shortWeek,
      ...figures(tallies.get(f.key) ?? emptyTally(), f.days, spendByDate),
    };
  });

  return {
    from,
    to,
    granularity,
    allowed: opts.allowed,
    buckets,
    totals: figures(total, periodDays, spendByDate),
    outsideOrders,
  };
}
