/**
 * Sales drivers — pure analysis (no DB, no network; unit-tested).
 *
 * Graeme's brief (2026-10-16): put the things that plausibly move sales —
 * delivery lead time, website changes, offers, emails, weekday — next to
 * the sales numbers, and say what the data suggests as a PROBABILITY, never
 * as a categorical claim. Objective I.
 *
 * Method notes, so every number on screen can be explained:
 * - Compare like with like. Lead time and weekday are tangled (Saturday's
 *   earliest delivery is always Tuesday), so every comparison is made
 *   within a weekday: a slow Wednesday against normal Wednesdays.
 * - "Usual wait" for a weekday is the shortest wait seen on that weekday in
 *   the data — learned, not hard-coded, so a change of delivery days just
 *   flows through.
 * - Uncertainty comes from resampling whole DAYS (a seeded bootstrap within
 *   each weekday), not from session counts. Day-to-day swings are much
 *   bigger than coin-flip noise, and treating every session as independent
 *   would make weak patterns look certain.
 * - The "probability" reported is the share of resamples in which the
 *   effect points the same way — read it as "how sure are we this isn't
 *   just noise", not as proof of cause. Other things change on the same
 *   days (ads, emails, offers), which is why the changelog sits alongside.
 */

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Weekday index (0 = Sunday) of a YYYY-MM-DD date. Dates are calendar
 *  days, so noon UTC sidesteps any timezone edge. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// ── Zapiet calendar → earliest bookable date ────────────────────────────────

export interface ZapietCalendar {
  minDate?: string;
  disabled?: unknown[];
}

export interface Availability {
  earliestDate: string | null;
  leadDays: number | null;
  nextDayAvailable: boolean | null;
}

/**
 * The first date a customer could pick on `today`, from Zapiet's calendar
 * response (an empty basket = the shop-wide picture). Zapiet's date picker
 * is pickadate-based: `disabled` holds [year, monthIndex, day] triplets for
 * specific dates and plain integers for whole weekdays, numbered 1 = Sunday
 * … 7 = Saturday. `minDate` may be YYYY-MM-DD or a full ISO timestamp.
 * Looks ahead up to 60 days; null when nothing is bookable in that window.
 */
export function earliestFromZapietCalendar(today: string, cal: ZapietCalendar, horizonDays = 60): Availability {
  const disabled = cal.disabled ?? [];
  const blockedWeekdays = new Set(
    disabled.filter((e): e is number => typeof e === "number").map(n => (n - 1 + 7) % 7),
  );
  const blockedDates = new Set(
    disabled
      .filter((e): e is unknown[] => Array.isArray(e) && e.length >= 3)
      .map(e => {
        const [y, m, d] = e as number[];
        return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }),
  );
  const min = cal.minDate ? cal.minDate.slice(0, 10) : addDays(today, 1);
  let day = min > today ? min : addDays(today, 1);
  for (let i = 0; i < horizonDays; i++) {
    if (!blockedWeekdays.has(weekdayOf(day)) && !blockedDates.has(day)) {
      const leadDays = daysBetween(today, day);
      return { earliestDate: day, leadDays, nextDayAvailable: leadDays === 1 };
    }
    day = addDays(day, 1);
  }
  return { earliestDate: null, leadDays: null, nextDayAvailable: null };
}

// ── Orders → estimated lead time for past days ──────────────────────────────

export interface OrderForLead {
  /** London calendar day the order was placed (YYYY-MM-DD). */
  day: string;
  /** London minute of day the order was placed (0–1439). */
  minuteOfDay: number;
  /** Order tags; the delivery date is a YYYY-MM-DD tag. */
  tags: string[];
}

export interface LeadEstimate {
  day: string;
  earliestDate: string;
  leadDays: number;
  sampleOrders: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Back-fill: for each day, the shortest wait any customer booked among
 * orders placed before `beforeMinute` (default 13:00, the time of the live
 * check). Customers who chose a later date for their own reasons don't
 * matter — the minimum is what was on offer, provided enough people
 * ordered. With few orders it can overstate the wait, so the sample size
 * travels with the estimate.
 */
export function estimateLeadFromOrders(orders: OrderForLead[], beforeMinute = 13 * 60): LeadEstimate[] {
  const byDay = new Map<string, { min: number; earliest: string; n: number }>();
  for (const o of orders) {
    if (o.minuteOfDay >= beforeMinute) continue;
    const dates = o.tags.map(t => t.trim()).filter(t => ISO_DAY.test(t) && t > o.day);
    if (dates.length === 0) continue;
    const delivery = dates.sort()[0];
    const lead = daysBetween(o.day, delivery);
    if (lead < 1 || lead > 60) continue;
    const cur = byDay.get(o.day);
    if (!cur) byDay.set(o.day, { min: lead, earliest: delivery, n: 1 });
    else {
      cur.n += 1;
      if (lead < cur.min) { cur.min = lead; cur.earliest = delivery; }
    }
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, earliestDate: v.earliest, leadDays: v.min, sampleOrders: v.n }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ── Day-level comparisons ───────────────────────────────────────────────────

export interface DayFacts {
  day: string;
  sessions: number | null;
  orders: number | null;
  leadDays: number | null;
}

/** Conversion for a day as a fraction (orders ÷ sessions), or null. */
export function dayConversion(d: DayFacts): number | null {
  if (!d.sessions || d.sessions < 20 || d.orders == null) return null;
  return d.orders / d.sessions;
}

/** Deterministic PRNG so the same data always gives the same answer. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Comparison {
  /** Relative change in conversion for the "exposed" days vs the rest,
   *  e.g. -0.28 = 28% lower. Null when there isn't enough data. */
  effect: number | null;
  /** 80% of resamples fell between these. */
  low: number | null;
  high: number | null;
  /** Share of resamples where conversion was LOWER on exposed days. */
  probabilityLower: number | null;
  exposedDays: number;
  comparisonDays: number;
  /** Plain conversion means for context (fractions). */
  exposedRate: number | null;
  comparisonRate: number | null;
  enoughData: boolean;
}

type Group = { exposed: number[]; rest: number[] };

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stratifiedEffect(strata: Group[]): number | null {
  let num = 0;
  let den = 0;
  for (const g of strata) {
    if (g.exposed.length === 0 || g.rest.length === 0) continue;
    const w = (g.exposed.length * g.rest.length) / (g.exposed.length + g.rest.length);
    num += w * (mean(g.exposed) - mean(g.rest));
    den += w * mean(g.rest);
  }
  return den > 0 ? num / den : null;
}

function resample(xs: number[], rnd: () => number): number[] {
  return xs.map(() => xs[Math.floor(rnd() * xs.length)]);
}

/**
 * Conversion on days where `isExposed` holds vs the other days, compared
 * within each weekday and pooled. Needs at least `minExposed` exposed days
 * that have a same-weekday comparison.
 */
export function compareConversion(
  days: DayFacts[],
  isExposed: (d: DayFacts) => boolean,
  opts: { minExposed?: number; iterations?: number; seed?: number } = {},
): Comparison {
  const minExposed = opts.minExposed ?? 3;
  const iterations = opts.iterations ?? 2000;
  const strata: Group[] = Array.from({ length: 7 }, () => ({ exposed: [], rest: [] }));
  for (const d of days) {
    const c = dayConversion(d);
    if (c == null) continue;
    (isExposed(d) ? strata[weekdayOf(d.day)].exposed : strata[weekdayOf(d.day)].rest).push(c);
  }
  // A weekday needs 2+ days on each side to say anything about spread.
  const usable = strata.filter(g => g.exposed.length >= 2 && g.rest.length >= 2);
  const exposedDays = usable.reduce((s, g) => s + g.exposed.length, 0);
  const comparisonDays = usable.reduce((s, g) => s + g.rest.length, 0);
  const allExposed = usable.flatMap(g => g.exposed);
  const allRest = usable.flatMap(g => g.rest);
  const base: Comparison = {
    effect: null, low: null, high: null, probabilityLower: null,
    exposedDays, comparisonDays,
    exposedRate: allExposed.length ? mean(allExposed) : null,
    comparisonRate: allRest.length ? mean(allRest) : null,
    enoughData: false,
  };
  if (exposedDays < minExposed || comparisonDays < minExposed) return base;
  const effect = stratifiedEffect(usable);
  if (effect == null) return base;
  const rnd = mulberry32(opts.seed ?? 20261016);
  // Resampling a handful of days understates the spread (it can only ever
  // reuse the days it has), which made pure noise look "95% sure" about
  // 15% of the time instead of ~10%. Widen by the usual n/(n-1) small-
  // sample factor, using the harmonic mean of the group sizes.
  const sizes = usable.flatMap(g => [g.exposed.length, g.rest.length]);
  const h = sizes.length / sizes.reduce((s, n) => s + 1 / n, 0);
  const widen = Math.sqrt(h / (h - 1));
  const sims: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const e = stratifiedEffect(usable.map(g => ({ exposed: resample(g.exposed, rnd), rest: resample(g.rest, rnd) })));
    if (e != null) sims.push(effect + (e - effect) * widen);
  }
  sims.sort((a, b) => a - b);
  const q = (p: number) => sims[Math.min(sims.length - 1, Math.max(0, Math.floor(p * sims.length)))];
  return {
    ...base,
    effect,
    low: q(0.1),
    high: q(0.9),
    probabilityLower: sims.filter(s => s < 0).length / sims.length,
    enoughData: true,
  };
}

/** Shortest wait seen per weekday — the "usual" wait that day of the week. */
export function usualLeadByWeekday(days: DayFacts[]): (number | null)[] {
  const usual: (number | null)[] = Array(7).fill(null);
  for (const d of days) {
    if (d.leadDays == null) continue;
    const w = weekdayOf(d.day);
    if (usual[w] == null || d.leadDays < (usual[w] as number)) usual[w] = d.leadDays;
  }
  return usual;
}

export interface LeadFinding {
  label: string;
  extraDays: number;
  comparison: Comparison;
}

/**
 * The lead-time questions Graeme asked: does conversion drop when the wait
 * is longer than usual for that weekday — by 1+, 3+ or ~a week of extra
 * days?
 */
export function leadTimeFindings(days: DayFacts[]): LeadFinding[] {
  const usual = usualLeadByWeekday(days);
  const extra = (d: DayFacts) => {
    const u = usual[weekdayOf(d.day)];
    return d.leadDays == null || u == null ? null : d.leadDays - u;
  };
  const withLead = days.filter(d => extra(d) != null);
  return [
    { label: "Wait longer than usual for that weekday", extraDays: 1 },
    { label: "Wait 3+ days longer than usual", extraDays: 3 },
    { label: "Wait about a week longer than usual", extraDays: 6 },
  ].map(f => ({
    ...f,
    comparison: compareConversion(withLead, d => (extra(d) as number) >= f.extraDays),
  }));
}

export interface WeekdayRow {
  weekday: string;
  days: number;
  conversion: number | null;
  /** Average wait on this weekday's usual-wait days. */
  usualLead: number | null;
}

/** Conversion by weekday, using only days with that weekday's usual wait,
 *  so a run of slow weeks doesn't masquerade as a weekday pattern. */
export function weekdayProfile(days: DayFacts[]): WeekdayRow[] {
  const usual = usualLeadByWeekday(days);
  return WEEKDAYS.map((name, w) => {
    const rates = days
      .filter(d => weekdayOf(d.day) === w && (d.leadDays == null || d.leadDays === usual[w]))
      .map(dayConversion)
      .filter((c): c is number => c != null);
    return { weekday: name, days: rates.length, conversion: rates.length ? mean(rates) : null, usualLead: usual[w] };
  });
}

/**
 * Before/after a change: `window` days either side, compared within
 * weekday. Also reports whether the average wait moved across the same
 * window, because a change landing in a busy fortnight would otherwise take
 * the blame for the wait.
 */
export function changeImpact(days: DayFacts[], changeDay: string, window = 14): Comparison & { leadShift: number | null } {
  const inWindow = days.filter(d => {
    const off = daysBetween(changeDay, d.day);
    return off >= -window && off < window && off !== 0;
  });
  const cmp = compareConversion(inWindow, d => d.day > changeDay, { minExposed: 5 });
  const leads = (pred: (d: DayFacts) => boolean) =>
    inWindow.filter(d => pred(d) && d.leadDays != null).map(d => d.leadDays as number);
  const before = leads(d => d.day < changeDay);
  const after = leads(d => d.day > changeDay);
  const leadShift = before.length && after.length ? mean(after) - mean(before) : null;
  return { ...cmp, leadShift };
}

/** Plain-English wording for a comparison — likelihood, never certainty. */
export function describeLikelihood(p: number | null): string {
  if (p == null) return "not enough data yet";
  const lower = p >= 0.5;
  const sure = lower ? p : 1 - p;
  const dir = lower ? "lower" : "higher";
  if (sure >= 0.95) return `very likely ${dir}`;
  if (sure >= 0.8) return `likely ${dir}`;
  if (sure >= 0.65) return `possibly ${dir}`;
  return "no clear difference";
}
