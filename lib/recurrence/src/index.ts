/**
 * One recurrence engine for "which days is this due?" (Graeme, 2026-10-13).
 *
 * Before this, the same rule lived twice, inline in route files: station
 * checklists (daily / weekly / specific days / every-4-weeks "periodic") and
 * Founder Focus recurring items (daily / weekdays / weekly / biweekly). Team
 * lists need all of those plus monthly, so the rule moved here and both old
 * callers delegate to it (charter rule 3: one copy).
 *
 * Every date is a London calendar date as "YYYY-MM-DD" — the caller decides
 * what "today" is in London (api-server lib/london-time.ts). The maths below
 * works on the date alone, at UTC noon, so a clock change can never move a
 * day: there is no time of day in here to shift.
 *
 * Weekdays are numbered like JavaScript's getDay(): 0 = Sunday … 6 = Saturday.
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Every rule may carry a start date (Graeme, 2026-10-15: "every 3 months
 *  starting from next Monday"): nothing is due before `from`. */
export type RecurrenceStart = { from?: string | null };

export type RecurrenceRule = RecurrenceStart & (
  /** Every day, weekends included. */
  | { kind: "daily" }
  /** Monday to Friday. */
  | { kind: "weekdays" }
  /**
   * On the chosen weekdays, every `interval` weeks. interval 1 covers
   * "every Tue" and "every Mon & Thu"; 2 is fortnightly; 4 is the
   * checklists' four-week period. For interval > 1 the week containing
   * `anchor` is an "on" week (weeks run Monday–Sunday); without an anchor
   * every week is on.
   */
  | { kind: "weekly"; days: Weekday[]; interval?: number; anchor?: string | null }
  /**
   * On day N of every month; a month without that day uses its last day.
   * With `interval` > 1 (2–12) it is every N months — quarterly is 3, six-
   * monthly 6, yearly 12 (Graeme, 2026-10-15: "every 6 months, every 4
   * months, or every 3 months" for maintenance) — and the month containing
   * `anchor` is an "on" month; without an anchor every month is on.
   */
  | { kind: "monthly"; dayOfMonth: number; interval?: number; anchor?: string | null }
  /** One day only — a one-off item, e.g. a short-delivery report put on a
   *  team list for the day it happened (Graeme, 2026-10-15). With carry-over
   *  on it stays "Overdue" until someone ticks it. */
  | { kind: "once"; date: string });

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** Monday-first, the way the kitchen's week runs — for pickers. */
export const WEEKDAYS_MONDAY_FIRST: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function noon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** Weekday of a calendar date (0 = Sunday). */
export function weekdayOf(date: string): Weekday {
  return noon(date).getUTCDay() as Weekday;
}

/** The date `n` days after (or before, if negative) `date`. */
export function addDays(date: string, n: number): string {
  return new Date(noon(date).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / DAY_MS);
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Whole calendar months from the month of `a` to the month of `b`. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The months an every-N-months rule falls in, from its anchor: [0, 6] → "Jan & Jul". */
export function monthsOfYear(interval: number, anchor: string): number[] {
  const start = Number(anchor.slice(5, 7)) - 1;
  const out: number[] = [];
  for (let i = 0; i < 12; i += interval) out.push((start + i) % 12);
  return out.sort((x, y) => x - y);
}

/** Is the rule due on this London date? */
export function isDueOn(rule: RecurrenceRule, date: string): boolean {
  if (rule.from && isIsoDate(rule.from) && date < rule.from) return false;
  const wd = weekdayOf(date);
  switch (rule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return wd >= 1 && wd <= 5;
    case "weekly": {
      if (!rule.days.includes(wd)) return false;
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      if (interval === 1 || !rule.anchor || !isIsoDate(rule.anchor)) return true;
      const weeks = Math.round(daysBetween(mondayOf(rule.anchor), mondayOf(date)) / 7);
      return ((weeks % interval) + interval) % interval === 0;
    }
    case "monthly": {
      const [y, m, d] = date.split("-").map(Number);
      const want = Math.min(Math.max(1, Math.floor(rule.dayOfMonth)), daysInMonth(y, m));
      if (d !== want) return false;
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      if (interval === 1 || !rule.anchor || !isIsoDate(rule.anchor)) return true;
      return ((monthsBetween(rule.anchor, date) % interval) + interval) % interval === 0;
    }
    case "once":
      return date === rule.date;
    default:
      return false;
  }
}

/** Longest gap between two occurrences of any rule this module accepts
 *  (52-week or 12-month interval), plus slack. Searches stop here so a rule
 *  that never fires (weekly with no days) can't loop forever. */
const SEARCH_LIMIT_DAYS = 7 * 54;

/** The latest date on or before `date` that the rule is due, no earlier
 *  than `notBefore` (e.g. the day the item was created). Null if none. */
export function lastOccurrenceOnOrBefore(rule: RecurrenceRule, date: string, notBefore?: string | null): string | null {
  for (let i = 0; i <= SEARCH_LIMIT_DAYS; i++) {
    const d = addDays(date, -i);
    if (notBefore && d < notBefore) return null;
    if (isDueOn(rule, d)) return d;
  }
  return null;
}

/** The first date strictly after `date` that the rule is due. */
export function nextOccurrenceAfter(rule: RecurrenceRule, date: string): string | null {
  for (let i = 1; i <= SEARCH_LIMIT_DAYS; i++) {
    const d = addDays(date, i);
    if (isDueOn(rule, d)) return d;
  }
  return null;
}

/** Due dates in [from, to], inclusive. */
export function occurrencesBetween(rule: RecurrenceRule, from: string, to: string): string[] {
  const out: string[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span && i <= SEARCH_LIMIT_DAYS; i++) {
    const d = addDays(from, i);
    if (isDueOn(rule, d)) out.push(d);
  }
  return out;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

function dayList(days: Weekday[]): string {
  const sorted = WEEKDAYS_MONDAY_FIRST.filter(d => days.includes(d)).map(d => WEEKDAY_SHORT[d]);
  if (sorted.length <= 1) return sorted.join("");
  return `${sorted.slice(0, -1).join(", ")} & ${sorted[sorted.length - 1]}`;
}

/** Plain-English summary: "Every day", "Weekdays", "Every Mon & Thu",
 *  "Every 2 weeks on Fri", "Monthly on the 15th". */
export function describeRule(rule: RecurrenceRule): string {
  const base = describeRuleBase(rule);
  if (!rule.from || !isIsoDate(rule.from) || rule.kind === "once") return base;
  const d = noon(rule.from);
  return `${base}, starting ${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

function describeRuleBase(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case "daily": return "Every day";
    case "weekdays": return "Weekdays (Mon–Fri)";
    case "weekly": {
      if (rule.days.length === 0) return "No days chosen";
      const days = rule.days.length === 7 ? "every day" : dayList(rule.days);
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      return interval === 1 ? `Every ${days}` : `Every ${interval} weeks on ${days}`;
    }
    case "monthly": {
      const day = ordinal(Math.max(1, Math.floor(rule.dayOfMonth)));
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      if (interval === 1) return `Monthly on the ${day}`;
      const lead = interval === 12 ? "Yearly" : `Every ${interval} months`;
      if (!rule.anchor || !isIsoDate(rule.anchor)) return `${lead} on the ${day}`;
      const months = monthsOfYear(interval, rule.anchor).map(i => MONTH_SHORT[i]);
      const list = months.length <= 1 ? months.join("") : `${months.slice(0, -1).join(", ")} & ${months[months.length - 1]}`;
      return `${lead} on the ${day} — ${list}`;
    }
    case "once": {
      if (!isIsoDate(rule.date)) return "Once";
      const d = noon(rule.date);
      return `Once, on ${WEEKDAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
    }
    default: return "Unknown";
  }
}

/** One canonical shape per rule — days sorted and de-duplicated, interval
 *  only when it's more than 1, anchor only when it matters — so two rules
 *  that mean the same compare equal however they were built or stored
 *  (Postgres jsonb reorders keys). */
export function normaliseRule(rule: RecurrenceRule): RecurrenceRule {
  const base = normaliseRuleBase(rule);
  return rule.from && isIsoDate(rule.from) && rule.kind !== "once" ? { ...base, from: rule.from } : base;
}

function normaliseRuleBase(rule: RecurrenceRule): RecurrenceRule {
  switch (rule.kind) {
    case "weekly": {
      const days = [...new Set(rule.days)].sort((a, b) => a - b) as Weekday[];
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      return interval > 1
        ? { kind: "weekly", days, interval, anchor: rule.anchor ?? null }
        : { kind: "weekly", days };
    }
    case "monthly": {
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      return interval > 1
        ? { kind: "monthly", dayOfMonth: Math.floor(rule.dayOfMonth), interval, anchor: rule.anchor ?? null }
        : { kind: "monthly", dayOfMonth: Math.floor(rule.dayOfMonth) };
    }
    case "once": return { kind: "once", date: rule.date };
    default: return { kind: rule.kind };
  }
}

export function sameRule(a: RecurrenceRule, b: RecurrenceRule): boolean {
  return JSON.stringify(normaliseRule(a)) === JSON.stringify(normaliseRule(b));
}

/** Every day or every weekday — a rhythm where tomorrow's occurrence comes
 *  round before a missed one is worth chasing. Team lists use it for the
 *  "carry over if missed" default (off for these, on for the rest). */
export function isDailyRhythm(rule: RecurrenceRule): boolean {
  return rule.kind === "daily" || rule.kind === "weekdays";
}

/** Is this a rule the engine understands? (For validating stored JSON.) */
export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.from !== undefined && r.from !== null && !isIsoDate(r.from)) return false;
  switch (r.kind) {
    case "daily":
    case "weekdays":
      return true;
    case "weekly":
      return Array.isArray(r.days)
        && r.days.every(d => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
        && (r.interval === undefined || (Number.isInteger(r.interval) && (r.interval as number) >= 1 && (r.interval as number) <= 52))
        && (r.anchor === undefined || r.anchor === null || isIsoDate(r.anchor));
    case "monthly":
      return Number.isInteger(r.dayOfMonth) && (r.dayOfMonth as number) >= 1 && (r.dayOfMonth as number) <= 31
        && (r.interval === undefined || (Number.isInteger(r.interval) && (r.interval as number) >= 1 && (r.interval as number) <= 12))
        && (r.anchor === undefined || r.anchor === null || isIsoDate(r.anchor));
    case "once":
      return isIsoDate(r.date);
    default:
      return false;
  }
}

/** Short-form weekday names ("monday") as the checklists store them. */
const LOWER_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export function weekdayFromName(name: string): Weekday | null {
  const i = LOWER_NAMES.indexOf(name.trim().toLowerCase());
  return i < 0 ? null : (i as Weekday);
}

export * from "./phrase";
export * from "./smart-add";
