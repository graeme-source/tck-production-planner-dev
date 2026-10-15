/**
 * Late orders — how many more calzone packs will still be ordered for a
 * delivery day between NOW and that day's despatch cut-off (Graeme, 15 Oct
 * 2026). Objective C (never run out, nothing goes out of date) and B (stock
 * driven by sales data).
 *
 * "The planner just does the maths and says 'we're going to have 1,300 packs
 * after Monday' — but between now and Monday we've got Friday, Saturday,
 * Sunday and up to 2pm Monday to sell for that despatch."
 *
 * THE METHOD (measured on 26 weeks of real orders — docs/FACTORY_FORECAST.md):
 *
 *   late packs = share still to come × typical day  + email adjustment
 *
 *   share still to come  For the same delivery WEEKDAY over the last 26 weeks:
 *                        of all the packs those days finally had, what share
 *                        arrived in the last `h` hours before their cut-off,
 *                        where `h` is the hours left right now. Weekday
 *                        matters: a Tuesday's last 96 hours span the weekend.
 *   typical day          The average final packs of the last 4 delivery days
 *                        on that weekday (the recent run-rate).
 *   email adjustment     +EMAIL_UPLIFT packs for every email due before the
 *                        cut-off beyond the number normally sent in that many
 *                        hours (the share above already includes the usual
 *                        emails, so only the extra ones add).
 *
 * The packs already ordered do NOT drive the late figure: on the backtest a
 * slow-booking day still gets the usual late rush, and scaling from the
 * packs already in made the error worse (MAE 159 vs 102 packs).
 *
 * The 80% range comes from how far the same rule missed on each past day
 * (10th–90th percentile of the misses, as a share of a typical day).
 *
 * Pure — orders in, numbers out; the API loads the orders and email dates.
 */

/** One Shopify order, reduced to what the forecast needs. Times are epoch ms. */
export interface ForecastOrder {
  createdAt: number;
  /** When it was cancelled (epoch ms), or null. A cancelled order counted as
   *  "known" until it was cancelled, and is never part of a final total. */
  cancelledAt: number | null;
  /** Delivery date YYYY-MM-DD (the first date in the order's tags). */
  deliveryDate: string;
  /** Calzone 2-packs in the order. */
  packs: number;
}

export interface LateOrderParams {
  /** Weeks of history the curve is fitted on (default 26). */
  historyWeeks: number;
  /** Past same-weekday delivery days averaged for the "typical day" (default 4). */
  recentDays: number;
  /** Delivery days with fewer final packs are ignored (closures, bank holidays). */
  minFinalPacks: number;
  /** Extra packs onto the plan's delivery days per email beyond the usual. */
  emailUpliftPacks: number;
  /** Despatch cut-off, London wall-clock "HH:MM" on the despatch day. */
  cutoffTime: string;
}

/** Measured 15 Oct 2026 (see docs/FACTORY_FORECAST.md). Each email brings
 *  ~120 extra calzone packs over the next 24 hours across ALL delivery days;
 *  the backtest's best fit for the share landing on the days a plan covers,
 *  beyond the usual number of emails, is ~20 packs per extra email. */
export const EMAIL_UPLIFT_PACKS = 20;

/** Measured emails per day over Apr–Oct 2026 (all Klaviyo email campaigns),
 *  used only when Klaviyo can't be read. */
export const FALLBACK_EMAILS_PER_DAY = 0.45;

export const DEFAULT_LATE_ORDER_PARAMS: LateOrderParams = {
  historyWeeks: 26,
  recentDays: 4,
  minFinalPacks: 50,
  emailUpliftPacks: EMAIL_UPLIFT_PACKS,
  cutoffTime: "14:00",
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── London time, without a timezone library ──────────────────────────────
const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** London's offset from UTC (ms) at the instant `ms`. */
function londonOffsetMs(ms: number): number {
  const p: Record<string, string> = {};
  for (const part of LONDON_PARTS.formatToParts(new Date(ms))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant (epoch ms) of a London wall-clock time on a calendar day. */
export function londonWallTimeMs(date: string, hhmm: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = guess - londonOffsetMs(guess);
  // Second pass settles the hour either side of a clock change.
  utc = guess - londonOffsetMs(utc);
  return utc;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Orders for a delivery day close at the cut-off on its despatch day — the
 *  day before (APC overnight). */
export function orderCutoffMs(deliveryDate: string, cutoffTime = DEFAULT_LATE_ORDER_PARAMS.cutoffTime): number {
  return londonWallTimeMs(addDays(deliveryDate, -1), cutoffTime);
}

// ── History ──────────────────────────────────────────────────────────────
export type OrdersByDate = Map<string, ForecastOrder[]>;

export function indexOrdersByDate(orders: readonly ForecastOrder[]): OrdersByDate {
  const map: OrdersByDate = new Map();
  for (const o of orders) {
    if (!(o.packs > 0)) continue;
    const list = map.get(o.deliveryDate);
    if (list) list.push(o); else map.set(o.deliveryDate, [o]);
  }
  return map;
}

/** Packs a delivery day finally had (cancelled orders excluded). */
export function finalPacks(orders: readonly ForecastOrder[] | undefined): number {
  let n = 0;
  for (const o of orders ?? []) if (o.cancelledAt == null) n += o.packs;
  return n;
}

/** Packs that were on the books at instant `at` (an order cancelled later
 *  still counted then). */
export function knownPacksAt(orders: readonly ForecastOrder[] | undefined, at: number): number {
  let n = 0;
  for (const o of orders ?? []) {
    if (o.createdAt <= at && (o.cancelledAt == null || o.cancelledAt > at)) n += o.packs;
  }
  return n;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface LateForecastInput {
  byDate: OrdersByDate;
  deliveryDate: string;
  /** The moment of the forecast (epoch ms). */
  now: number;
  /** Emails due between now and this day's cut-off. */
  emailsInWindow: number;
  /** Emails normally sent per hour (Klaviyo, last 26 weeks). */
  typicalEmailsPerHour: number;
  params?: Partial<LateOrderParams>;
}

export interface LateForecast {
  deliveryDate: string;
  cutoffAt: number;
  hoursToCutoff: number;
  /** True once the cut-off has passed — nothing more is expected. */
  closed: boolean;
  /** Predicted packs still to be ordered for this day. */
  latePacks: number;
  /** 80% range for latePacks. */
  low: number;
  high: number;
  /** Share of a day's final packs that normally arrives in the hours left. */
  shareStillToCome: number;
  /** Average final packs of the recent same-weekday delivery days. */
  typicalDayPacks: number;
  /** Past delivery days the share was measured on. */
  samples: number;
  emailsInWindow: number;
  typicalEmails: number;
  emailAdjustment: number;
}

/**
 * Packs still to come for one delivery day, with an 80% range.
 * Too little history (fewer than 4 matching days) → 0 with a zero range:
 * the screen then shows known orders only, as before.
 */
export function forecastLateOrders(input: LateForecastInput): LateForecast {
  const p = { ...DEFAULT_LATE_ORDER_PARAMS, ...(input.params ?? {}) };
  const cutoffAt = orderCutoffMs(input.deliveryDate, p.cutoffTime);
  const hours = (cutoffAt - input.now) / HOUR;
  const base: LateForecast = {
    deliveryDate: input.deliveryDate, cutoffAt, hoursToCutoff: Math.max(0, hours), closed: hours <= 0,
    latePacks: 0, low: 0, high: 0, shareStillToCome: 0, typicalDayPacks: 0, samples: 0,
    emailsInWindow: 0, typicalEmails: 0, emailAdjustment: 0,
  };
  if (hours <= 0) return base;

  // Same-weekday delivery days whose cut-off has passed, newest last.
  const wd = weekdayOf(input.deliveryDate);
  const earliest = addDays(input.deliveryDate, -7 * p.historyWeeks);
  const history: Array<{ date: string; F: number; L: number }> = [];
  for (const [date, orders] of input.byDate) {
    if (weekdayOf(date) !== wd || date < earliest || date >= input.deliveryDate) continue;
    const cut = orderCutoffMs(date, p.cutoffTime);
    if (cut >= input.now) continue;
    const F = finalPacks(orders);
    if (F < p.minFinalPacks) continue;
    history.push({ date, F, L: F - knownPacksAt(orders, cut - hours * HOUR) });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length < 4) return base;

  const sumF = history.reduce((s, h) => s + h.F, 0);
  const share = Math.max(0, history.reduce((s, h) => s + h.L, 0) / sumF);
  const recent = history.slice(-p.recentDays);
  const typical = recent.reduce((s, h) => s + h.F, 0) / recent.length;

  const typicalEmails = input.typicalEmailsPerHour * hours;
  const emailAdjustment = p.emailUpliftPacks * (input.emailsInWindow - typicalEmails);
  const late = Math.max(0, share * typical + emailAdjustment);

  // How far the same rule missed on each past day (as a share of its typical
  // day, from the days before it), for the 80% range.
  const misses: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prior = history.slice(Math.max(0, i - p.recentDays), i);
    const typ = prior.reduce((s, h) => s + h.F, 0) / prior.length;
    if (typ > 0) misses.push((history[i].L - share * typ) / typ);
  }
  misses.sort((a, b) => a - b);
  let lowMiss = quantile(misses, 0.1), highMiss = quantile(misses, 0.9);
  if (misses.length < 6) { lowMiss = Math.min(lowMiss, -0.35 * share); highMiss = Math.max(highMiss, 0.35 * share); }

  return {
    ...base,
    latePacks: Math.round(late),
    low: Math.round(Math.max(0, late + lowMiss * typical)),
    high: Math.round(Math.max(late, late + highMiss * typical)),
    shareStillToCome: share,
    typicalDayPacks: Math.round(typical),
    samples: history.length,
    emailsInWindow: input.emailsInWindow,
    typicalEmails,
    emailAdjustment: Math.round(emailAdjustment),
  };
}

/**
 * The despatches whose known orders the plan screen already takes out of the
 * fridge before the end of the plan day — so their LATE orders come out too:
 *   today's despatch (in "end of today"), when today is a despatch day;
 *   the despatch before the plan day (dispatch1), when it's still ahead —
 *     the screen rolls it forward;
 *   the plan day's own despatch.
 * Oldest first, no repeats, none before today. Closed ones are harmless:
 * forecastLateOrders returns 0 for them.
 */
export function despatchesBeforePlanEnd(input: {
  today: string;
  planDate: string;
  /** The despatch day before the plan date (holiday-aware). */
  dispatch1: string;
  todayIsDespatchDay: boolean;
}): string[] {
  const days = new Set<string>();
  if (input.todayIsDespatchDay && input.today <= input.planDate) days.add(input.today);
  if (input.dispatch1 > input.today) days.add(input.dispatch1);
  if (input.planDate >= input.today) days.add(input.planDate);
  return [...days].sort();
}

export interface LateTotal {
  latePacks: number;
  low: number;
  high: number;
}

/** Several delivery days together: the expectations add, and so do the
 *  ranges. Days a plan covers share the same calendar hours (a quiet weekend
 *  is quiet for both), so their misses move together — adding them in
 *  quadrature covered only ~70% of real outcomes on the backtest. */
export function combineLateForecasts(list: ReadonlyArray<Pick<LateForecast, "latePacks" | "low" | "high">>): LateTotal {
  const latePacks = list.reduce((s, f) => s + f.latePacks, 0);
  const down = list.reduce((s, f) => s + (f.latePacks - f.low), 0);
  const up = list.reduce((s, f) => s + (f.high - f.latePacks), 0);
  return { latePacks, low: Math.max(0, Math.round(latePacks - down)), high: Math.round(latePacks + up) };
}

/** Each recipe's share of calzone packs ordered in the recent window (the
 *  measured best split for late orders: the last 7 days beat 28 days and the
 *  day's own known mix). Shares sum to 1; empty when nothing sold. */
export function recipeSalesShares(lines: ReadonlyArray<{ recipeId: number; packs: number; createdAt: number; cancelledAt: number | null }>, now: number, days = 7): Record<number, number> {
  const since = now - days * DAY;
  const by = new Map<number, number>();
  let total = 0;
  for (const l of lines) {
    if (l.cancelledAt != null || l.createdAt <= since || l.createdAt > now || !(l.packs > 0)) continue;
    by.set(l.recipeId, (by.get(l.recipeId) ?? 0) + l.packs);
    total += l.packs;
  }
  const out: Record<number, number> = {};
  if (total <= 0) return out;
  for (const [id, n] of by) out[id] = n / total;
  return out;
}
