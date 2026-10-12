/**
 * Review periods, probation, and the private HR "Needs attention" queue
 * (Graeme, 2026-10-12).
 *
 *   • An open ("in review") entry runs for a PERIOD: start + length (1, 2, 3,
 *     6 months or a chosen end date). Extending keeps the history
 *     ("Extended by 1 month to 12 Jan 2027").
 *   • Probation is the same idea per person: start → end, Extend, Passed,
 *     Not passed.
 *   • The queue lists what needs doing; it is computed, never stored.
 *   • Nobody is told WHAT needs doing outside the People section: each
 *     person who can write employment records gets ONE generic to-do —
 *     "Your attention is required in HR — tap here" — no names, reasons or
 *     counts. It closes itself when their queue is empty. The details only
 *     show behind the private People PIN.
 *
 * Pure; the server loads the facts and applies the shared write rule
 * (canWriteEmploymentRecord — never an item about your own record).
 */
import { addDaysIso, addMonthsIso, fmtDayIso } from "./index";

// ── Review periods ─────────────────────────────────────────────────────────

export const PERIOD_MONTHS = [1, 2, 3, 6] as const;

/** Last day of a period of `months` starting on `startIso`. */
export function periodEnd(startIso: string, months: number): string {
  return addDaysIso(addMonthsIso(startIso, months), -1);
}

/** "Extended by 1 month to 12 Jan 2027" / "Extended to 12 Jan 2027". */
export function extensionMessage(months: number | null, newEnd: string): string {
  return months ? `Extended by ${months} month${months === 1 ? "" : "s"} to ${fmtDayIso(newEnd)}` : `Extended to ${fmtDayIso(newEnd)}`;
}

/** The new end when extending: a length from the current end (or today if
 *  it has already passed), or a date the person picked. */
export function extendedEnd(currentEnd: string | null, todayIso: string, by: { months?: number | null; endDate?: string | null }):
  { ok: true; end: string } | { ok: false; error: string } {
  if (by.endDate) {
    if (currentEnd && by.endDate <= currentEnd) return { ok: false, error: "The new end date has to be after the current one." };
    if (by.endDate < todayIso) return { ok: false, error: "The new end date can't be in the past." };
    return { ok: true, end: by.endDate };
  }
  if (!by.months || by.months < 1) return { ok: false, error: "Pick how long to extend by." };
  const from = currentEnd && currentEnd >= todayIso ? addDaysIso(currentEnd, 1) : todayIso;
  return { ok: true, end: periodEnd(from, by.months) };
}

// ── The queue ──────────────────────────────────────────────────────────────

export interface AttentionSettings {
  /** Probation ending within this many days with no outcome. */
  probationDays: number;
  /** Review period ending within this many days and still open. */
  reviewDays: number;
  /** Warning expiring within this many days (FYI). */
  warningDays: number;
}

export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = { probationDays: 14, reviewDays: 7, warningDays: 14 };

export type AttentionKind = "probation_due" | "review_due" | "warning_expiring" | "meeting_write_up";

export interface AttentionItem {
  key: string;
  kind: AttentionKind;
  userId: number;
  entryId: number | null;
  /** The day it's about (period end, warning expiry, meeting day). */
  date: string;
  overdue: boolean;
  /** FYI items never keep the generic to-do open on their own. */
  fyi: boolean;
}

export interface QueueFacts {
  todayIso: string;
  settings: AttentionSettings;
  probations: Array<{ userId: number; endDate: string; outcome: "passed" | "not_passed" | null }>;
  openEntries: Array<{ id: number; userId: number; reviewEnd: string | null }>;
  /** Live (not withdrawn) warnings. */
  warnings: Array<{ entryId: number; userId: number; expiresOn: string }>;
  /** Entries with a meeting and no outcome written yet. */
  meetings: Array<{ entryId: number; userId: number; meetingDate: string; writtenUp: boolean }>;
}

/** Everything that needs doing, most urgent first. */
export function attentionQueue(f: QueueFacts): AttentionItem[] {
  const t = f.todayIso;
  const within = (d: string, days: number) => d <= addDaysIso(t, days);
  const out: AttentionItem[] = [];
  for (const p of f.probations) {
    if (p.outcome) continue;
    if (within(p.endDate, f.settings.probationDays)) {
      out.push({ key: `pr-${p.userId}`, kind: "probation_due", userId: p.userId, entryId: null, date: p.endDate, overdue: p.endDate < t, fyi: false });
    }
  }
  for (const e of f.openEntries) {
    if (e.reviewEnd && within(e.reviewEnd, f.settings.reviewDays)) {
      out.push({ key: `rv-${e.id}`, kind: "review_due", userId: e.userId, entryId: e.id, date: e.reviewEnd, overdue: e.reviewEnd < t, fyi: false });
    }
  }
  for (const w of f.warnings) {
    // Expiring soon, or expired in the last week — then it drops off.
    if (within(w.expiresOn, f.settings.warningDays) && w.expiresOn >= addDaysIso(t, -7)) {
      out.push({ key: `wx-${w.entryId}`, kind: "warning_expiring", userId: w.userId, entryId: w.entryId, date: w.expiresOn, overdue: w.expiresOn < t, fyi: true });
    }
  }
  for (const m of f.meetings) {
    // Today's or tomorrow's meeting (a reminder), or one that's happened
    // with nothing written up.
    if (m.writtenUp) continue;
    if (m.meetingDate <= addDaysIso(t, 1)) {
      out.push({ key: `mt-${m.entryId}`, kind: "meeting_write_up", userId: m.userId, entryId: m.entryId, date: m.meetingDate, overdue: m.meetingDate < t, fyi: false });
    }
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(a.fyi) - Number(b.fyi) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** One viewer's queue: only people whose record they may write — so never
 *  their own (the shared rule, passed in by the server). */
export function queueForViewer(items: readonly AttentionItem[], mayWrite: (userId: number) => boolean): AttentionItem[] {
  return items.filter(i => mayWrite(i.userId));
}

/** Plain words for a card — only ever shown behind the People PIN. */
export function attentionLine(i: AttentionItem): string {
  const day = fmtDayIso(i.date);
  switch (i.kind) {
    case "probation_due": return i.overdue ? `Probation ended ${day} — no outcome recorded` : `Probation ends ${day} — decide the outcome`;
    case "review_due": return i.overdue ? `Review period ended ${day} — still open` : `Review period ends ${day}`;
    case "warning_expiring": return i.overdue ? `Warning expired ${day}` : `Warning expires ${day}`;
    case "meeting_write_up": return i.overdue ? `Meeting on ${day} not written up yet` : `Meeting ${day} — write it up afterwards`;
  }
}

// ── The one generic to-do ──────────────────────────────────────────────────

/** Fixed wording on purpose: no names, reasons or counts ever leave the
 *  People section. */
export const HR_ATTENTION_TODO_TITLE = "Your attention is required in HR — tap here";
export const HR_ATTENTION_URL = "/people/attention";

export function hrAttentionTodo(ownerId: number) {
  return {
    assigneeId: ownerId,
    createdBy: null,
    createdByName: "HR",
    title: HR_ATTENTION_TODO_TITLE,
    notes: null,
    url: HR_ATTENTION_URL,
    priority: "high" as const,
  };
}

/** Keep exactly one open generic to-do while there's something to act on
 *  (FYI items alone don't count); tick it off when there's nothing. */
export function planAttentionTodo(items: readonly AttentionItem[], openTodoIds: readonly number[]):
  { create: boolean; close: number[] } {
  const needed = items.some(i => !i.fyi);
  if (needed) return { create: openTodoIds.length === 0, close: openTodoIds.slice(1) };
  return { create: false, close: [...openTodoIds] };
}
