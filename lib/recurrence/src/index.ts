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

export type RecurrenceRule =
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
  /** On day N of every month; a month without that day uses its last day. */
  | { kind: "monthly"; dayOfMonth: number };

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

/** Is the rule due on this London date? */
export function isDueOn(rule: RecurrenceRule, date: string): boolean {
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
      return d === want;
    }
    default:
      return false;
  }
}

/** Longest gap between two occurrences of any rule this module accepts
 *  (52-week interval), plus slack. Searches stop here so a rule that never
 *  fires (weekly with no days) can't loop forever. */
const SEARCH_LIMIT_DAYS = 7 * 53;

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
  switch (rule.kind) {
    case "daily": return "Every day";
    case "weekdays": return "Weekdays (Mon–Fri)";
    case "weekly": {
      if (rule.days.length === 0) return "No days chosen";
      const days = rule.days.length === 7 ? "every day" : dayList(rule.days);
      const interval = Math.max(1, Math.floor(rule.interval ?? 1));
      return interval === 1 ? `Every ${days}` : `Every ${interval} weeks on ${days}`;
    }
    case "monthly": return `Monthly on the ${ordinal(Math.max(1, Math.floor(rule.dayOfMonth)))}`;
    default: return "Unknown";
  }
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
      return Number.isInteger(r.dayOfMonth) && (r.dayOfMonth as number) >= 1 && (r.dayOfMonth as number) <= 31;
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
