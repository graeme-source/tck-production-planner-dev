/**
 * Is a performance review due? — the People list's "Last review" column and
 * the record's review card (Graeme, 25 Nov 2026): "add a column that shows
 * their last recorded review, and if we don't have one, just put 'no
 * record'. Mark them as overdue if it's more than 6 months… If they don't
 * have one, you can also say 'possibly overdue'… so I can see an overview of
 * who has and hasn't had a review in the last 6 months." And: "set, for each
 * person, that they don't have reviews" — directors, owners, contractors.
 *
 * The LAST REVIEW is the most recent review on their record — an entry
 * classed Performance appraisal or Probation review (primary or ticked;
 * REVIEW_LABELS). Nothing else counts, held or not (Graeme, 26 Nov 2026:
 * "only look for reviews, not meetings … catch-up meetings … disciplinaries
 * … can happen ad hoc, and we don't want to not review someone because
 * they've had a meeting 3 weeks ago about something else") — dated by its meeting date (else the
 * entry date — never when it was typed), on or before today, not cancelled,
 * whatever its share status. Or a date set by hand ("Mark last review",
 * no write-up), when that's later (lastReviewOf). Found on the server
 * (api-server lib/last-appraisals.ts); this file only classifies it.
 *
 * The rule, in order:
 *   1. set to "No review required"      → not_required  (muted, never flagged)
 *   2. no review on record               → no_record     ("No record" · Possibly overdue)
 *   3. last review before the cut-off    → overdue       (Overdue)
 *   4. otherwise                         → up_to_date    (Up to date)
 * The cut-off is the same calendar day 6 months back from today's London
 * date, clamped to month end (31 Aug → 28/29 Feb). A review ON the cut-off
 * day is exactly 6 months old — still up to date; the day before is overdue.
 *
 * Pure: shared by the API and the app (Objective H).
 */
import { addMonthsIso, fmtDayIso } from "./index";

/** The classification that counts as a performance review. */
export const PERFORMANCE_APPRAISAL_LABEL = "Performance appraisal";

/** The classifications that count as someone's last review: the six-monthly
 *  performance review, and the probation review. */
export const REVIEW_LABELS: readonly string[] = [PERFORMANCE_APPRAISAL_LABEL, "Probation review"];

/** How long a review lasts before the next is due. */
export const REVIEW_DUE_MONTHS = 6;

export const REVIEW_DUE_STATES = ["up_to_date", "overdue", "no_record", "not_required"] as const;
export type ReviewDueState = (typeof REVIEW_DUE_STATES)[number];

/** Pill colours: green calm, red overdue, amber possibly overdue, muted. */
export type ReviewDueTone = "green" | "red" | "amber" | "muted";

export interface ReviewDueFacts {
  /** YYYY-MM-DD of their last review, or null when there's none. */
  lastReviewDate: string | null;
  noReviewRequired: boolean;
}

export interface ReviewDue {
  state: ReviewDueState;
  /** The pill: "Up to date" · "Overdue" · "Possibly overdue" · "No review required". */
  label: string;
  tone: ReviewDueTone;
  /** The main line: "12 Mar 2026", "No record", or "No review required". */
  dateText: string;
  /** "8 months ago" — null when there's no review. */
  agoText: string | null;
  /** When the next review is (or was) due — last + 6 months; null with no review. */
  dueOn: string | null;
  /** Should the overview flag this person? Overdue and possibly overdue only. */
  flagged: boolean;
}

export const REVIEW_DUE_LABEL: Record<ReviewDueState, string> = {
  up_to_date: "Up to date",
  overdue: "Overdue",
  no_record: "Possibly overdue",
  not_required: "No review required",
};

const TONE: Record<ReviewDueState, ReviewDueTone> = {
  up_to_date: "green", overdue: "red", no_record: "amber", not_required: "muted",
};

const isoDay = (s: string) => s.slice(0, 10);

/** The oldest review date that still counts as up to date today. */
export function reviewCutoff(today: string, months: number = REVIEW_DUE_MONTHS): string {
  return addMonthsIso(isoDay(today), -months);
}

/** Whole calendar months from `from` to `to` (0 if `to` is earlier). */
export function wholeMonthsBetween(from: string, to: string): number {
  const a = isoDay(from), b = isoDay(to);
  if (b <= a) return 0;
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  let n = (by - ay) * 12 + (bm - am);
  // The month isn't complete until its same day comes round (month-end clamped).
  while (n > 0 && addMonthsIso(a, n) > b) n--;
  return n;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${isoDay(to)}T00:00:00Z`) - Date.parse(`${isoDay(from)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "8 months ago", "2 years ago". */
export function agoText(date: string, today: string): string {
  const days = daysBetween(date, today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const months = wholeMonthsBetween(date, today);
  if (months === 0) {
    if (days < 14) return `${days} days ago`;
    return `${Math.floor(days / 7)} weeks ago`;
  }
  if (months < 24) return months === 1 ? "1 month ago" : `${months} months ago`;
  return `${Math.floor(months / 12)} years ago`;
}

/** Where this person stands. `today` is London's date (YYYY-MM-DD). */
export function reviewDue(facts: ReviewDueFacts, today: string): ReviewDue {
  const last = facts.lastReviewDate ? isoDay(facts.lastReviewDate) : null;
  const state: ReviewDueState = facts.noReviewRequired ? "not_required"
    : last == null ? "no_record"
      : last < reviewCutoff(today) ? "overdue"
        : "up_to_date";
  return {
    state,
    label: REVIEW_DUE_LABEL[state],
    tone: TONE[state],
    dateText: state === "not_required" ? "No review required" : last ? fmtDayIso(last) : "No record",
    agoText: last ? agoText(last, today) : null,
    dueOn: last ? addMonthsIso(last, REVIEW_DUE_MONTHS) : null,
    flagged: state === "overdue" || state === "no_record",
  };
}

/**
 * The column's sort value — A→Z puts the most overdue first: no record at
 * the very top, then the oldest review. "No review required" (and rows with
 * nothing to show, like your own) is blank, so it sits at the bottom either
 * way.
 */
export function reviewDueSortValue(d: ReviewDue | null | undefined, lastReviewDate: string | null): string | null {
  if (!d || d.state === "not_required") return null;
  if (d.state === "no_record") return "0000-00-00";
  return lastReviewDate ? isoDay(lastReviewDate) : null;
}

/** The audit line for switching the setting. */
export function noReviewRequiredAuditDetail(on: boolean): string {
  return on ? "Set to No review required" : "Reviews required again (No review required switched off)";
}

export type LastReviewSource = "record" | "marked";

/** The later of the last review on their record and a date marked by hand
 *  (Graeme, 26 Nov 2026: "just mark that they have had a review on a
 *  certain date … by the next time we … do a proper review through the
 *  system, it will update it"). Same day: the record wins (it can be opened). */
export function lastReviewOf(
  record: { date: string; entryId: number } | null | undefined,
  markedOn: string | null | undefined,
): { date: string; entryId: number | null; source: LastReviewSource } | null {
  const marked = markedOn ? isoDay(markedOn) : null;
  if (record && (!marked || isoDay(record.date) >= marked)) return { date: isoDay(record.date), entryId: record.entryId, source: "record" };
  if (marked) return { date: marked, entryId: null, source: "marked" };
  return null;
}

/** A date someone may mark as the last review: a real day, not in the future. */
export function canMarkReviewDate(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date && date <= isoDay(today) && date >= "2000-01-01";
}
