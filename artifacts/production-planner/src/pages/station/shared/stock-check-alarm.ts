// ─────────────────────────────────────────────────────────────────────────────
// Prep stock-check alarm (pure — no React, no fetch).
//
// The "Stock check records for today" panel on every prep screen turns into
// a flashing red warning from 14:45 if any stock check due today is still
// unrecorded, and a solid red "Overdue" after the 15:00 deadline — but only
// on a day when there is prep to do (Graeme, 13 Oct 2026: Passata and Tomato
// Puree were still outstanding at 2:45 and nobody noticed).
//
// The warning start and deadline come from the prep stock-check timed
// reminder (Settings → Production → Timed reminders) when one exists, so
// there is one place to change them; otherwise the defaults below.
// ─────────────────────────────────────────────────────────────────────────────

import { isPrepStation } from "./reminder-conditions";

/** Used when no prep stock-check timed reminder is configured. */
export const DEFAULT_STOCK_CHECK_WARN_FROM = "14:45";
export const DEFAULT_STOCK_CHECK_DEADLINE = "15:00";

export interface StockCheckAlarmWindow {
  /** London wall clock "HH:MM" — the panel turns flashing red from here… */
  warnFrom: string;
  /** …until here; after it the panel is solid red "Overdue". */
  deadline: string;
}

const HHMM = /^\d{2}:\d{2}$/;

export const hhmmToSeconds = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60;
};

interface ReminderLike {
  enabled?: boolean;
  stations: readonly string[];
  startTime: string;
  endTime: string;
  onlyIfStockChecksOutstanding?: boolean;
}

/** The alarm window: the prep stock-check reminder's start/end times (an
 *  enabled one first), else the defaults. */
export function stockCheckAlarmWindow(reminders: readonly ReminderLike[]): StockCheckAlarmWindow {
  const matches = reminders.filter(r =>
    !!r.onlyIfStockChecksOutstanding &&
    r.stations.some(isPrepStation) &&
    HHMM.test(r.startTime) && HHMM.test(r.endTime) &&
    hhmmToSeconds(r.startTime) < hhmmToSeconds(r.endTime),
  );
  const pick = matches.find(r => r.enabled !== false) ?? matches[0];
  return pick
    ? { warnFrom: pick.startTime, deadline: pick.endTime }
    : { warnFrom: DEFAULT_STOCK_CHECK_WARN_FROM, deadline: DEFAULT_STOCK_CHECK_DEADLINE };
}

// ── London clock ─────────────────────────────────────────────────────────────

export interface LondonClock {
  /** "YYYY-MM-DD" */
  dateStr: string;
  /** "Monday" … "Sunday" */
  dayName: string;
  /** Seconds since London midnight. */
  secondsOfDay: number;
}

/** The kitchen runs on London time whatever the iPad's own clock zone. */
export function londonClock(now: Date = new Date()): LondonClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    dayName: get("weekday"),
    secondsOfDay: (Number(get("hour")) % 24) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  };
}

// ── What's due ───────────────────────────────────────────────────────────────

export interface StockCheckDueItem {
  id: number;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
}

/** Daily checks are always due; weekly ones on their day (London). */
export const isStockCheckDueToday = (it: StockCheckDueItem, londonDayName: string): boolean =>
  it.stockCheckFrequency !== "weekly" || it.stockCheckDay === londonDayName;

/** Items due today with no record yet, in the order given. */
export function outstandingStockChecks<T extends StockCheckDueItem>(
  items: readonly T[],
  checkedIngredientIds: ReadonlySet<number>,
  londonDayName: string,
): T[] {
  return items.filter(it => isStockCheckDueToday(it, londonDayName) && !checkedIngredientIds.has(it.id));
}

// ── Prep-day gating ──────────────────────────────────────────────────────────

export interface PrepTarget {
  planDate: string | null;
  /** The day the prep happens; null = same as planDate (legacy rows). */
  prepDate: string | null;
  status: string | null;
}

interface PlanDates {
  planDate?: string | null;
  prepDate?: string | null;
  status?: string | null;
}

/** The plan a prep screen is working on: the resolved next prep plan when
 *  there is one (/next-active?for=prep), else the URL plan (?direct=1). */
export function prepTargetOf(nextPlan: PlanDates | null | undefined, urlPlan: PlanDates | null | undefined): PrepTarget | null {
  const p = nextPlan ?? urlPlan;
  if (!p) return null;
  return { planDate: p.planDate ?? null, prepDate: p.prepDate ?? null, status: p.status ?? null };
}

/** True when the plan the prep screen is working on is live and its prep
 *  happens today — same date rule as /next-active?for=prep
 *  (COALESCE(prep_date, plan_date)). Drafts aren't live: prep is locked. */
export function isPrepDayToday(target: PrepTarget | null | undefined, londonDate: string): boolean {
  if (!target || target.status !== "active") return false;
  const prepDay = target.prepDate ?? target.planDate;
  return !!prepDay && prepDay === londonDate;
}

// ── State ────────────────────────────────────────────────────────────────────

export type StockCheckAlarmState =
  /** Nothing due today — the panel hides. */
  | "none"
  /** Everything due is recorded — green. */
  | "done"
  /** Outstanding, but before the warning time (or not a prep day) — amber. */
  | "pending"
  /** Outstanding from the warning time to the deadline — flashing red. */
  | "warning"
  /** Outstanding after the deadline — solid red. */
  | "overdue";

export function stockCheckAlarmState(input: {
  dueCount: number;
  outstandingCount: number;
  prepDay: boolean;
  secondsOfDay: number;
  window: StockCheckAlarmWindow;
}): StockCheckAlarmState {
  if (input.dueCount <= 0) return "none";
  if (input.outstandingCount <= 0) return "done";
  if (!input.prepDay) return "pending";
  if (input.secondsOfDay < hhmmToSeconds(input.window.warnFrom)) return "pending";
  if (input.secondsOfDay < hhmmToSeconds(input.window.deadline)) return "warning";
  return "overdue";
}

// ── Wording ──────────────────────────────────────────────────────────────────

/** Seconds to the deadline → "12 min left" (rounded up, so 11:30 left reads
 *  "12 min left"; the last minute reads "under 1 min left"). */
export function minutesLeftText(secondsLeft: number): string {
  if (secondsLeft <= 0) return "0 min left";
  if (secondsLeft < 60) return "under 1 min left";
  return `${Math.ceil(secondsLeft / 60)} min left`;
}

/** "15:00" → "3:00", "09:30" → "9:30", "12:15" → "12:15" — how the kitchen
 *  says the time. */
export function deadlineLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The panel's headline for each state. */
export function stockCheckAlarmHeadline(input: {
  state: StockCheckAlarmState;
  dueCount: number;
  outstandingCount: number;
  secondsOfDay: number;
  window: StockCheckAlarmWindow;
}): string {
  const { state, dueCount, outstandingCount: n } = input;
  switch (state) {
    case "none":
      return "";
    case "done":
      return `All ${dueCount} stock ${plural(dueCount, "check", "checks")} recorded for today`;
    case "pending":
      return `${n} of ${dueCount} stock ${plural(dueCount, "check", "checks")} outstanding for today`;
    case "warning": {
      const left = hhmmToSeconds(input.window.deadline) - input.secondsOfDay;
      return `Stock checks due by ${deadlineLabel(input.window.deadline)} — ${n} still to record · ${minutesLeftText(left)}`;
    }
    case "overdue":
      return `Overdue — ${n} stock ${plural(n, "check", "checks")} not recorded`;
  }
}

// ── 5-minute pop-up (Fix queue #324) ─────────────────────────────────────────

/** How long before the deadline the must-dismiss pop-up appears (14:55 for
 *  the 15:00 default — it follows the deadline in the timed reminder). */
export const STOCK_CHECK_POPUP_LEAD_SECONDS = 5 * 60;

/** Show the full-screen "Stock check due in 5 minutes" pop-up? On a prep day,
 *  from five minutes before the deadline, while anything due is still
 *  unrecorded, until this person has dismissed it today. It stays up past
 *  the deadline (then worded as overdue) for anyone who hasn't seen it. */
export function shouldShowStockCheckPopup(input: {
  outstandingCount: number;
  prepDay: boolean;
  secondsOfDay: number;
  window: StockCheckAlarmWindow;
  dismissedToday: boolean;
}): boolean {
  if (input.dismissedToday || !input.prepDay || input.outstandingCount <= 0) return false;
  return input.secondsOfDay >= hhmmToSeconds(input.window.deadline) - STOCK_CHECK_POPUP_LEAD_SECONDS;
}

/** The pop-up's headline: "Stock check due in 5 minutes, 3 items still to
 *  record", or overdue once the deadline has passed. */
export function stockCheckPopupHeadline(input: {
  outstandingCount: number;
  secondsOfDay: number;
  window: StockCheckAlarmWindow;
}): string {
  const n = input.outstandingCount;
  const items = `${n} ${plural(n, "item", "items")} still to record`;
  const left = hhmmToSeconds(input.window.deadline) - input.secondsOfDay;
  if (left <= 0) return `Stock check overdue, ${items}`;
  const mins = Math.max(1, Math.ceil(left / 60));
  return `Stock check due in ${mins} ${plural(mins, "minute", "minutes")}, ${items}`;
}

/** Device storage key for "I'm aware, carry on" — once per person per day. */
export const stockCheckPopupDismissKey = (userId: number | null, londonDate: string) =>
  `stock-check-popup-dismissed:${userId ?? "anon"}:${londonDate}`;
