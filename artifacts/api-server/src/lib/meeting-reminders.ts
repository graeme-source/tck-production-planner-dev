/**
 * Standing morning-meeting reminders (migration 0250, Graeme 23 Oct 2026).
 * Objective E. A reminder shows on every meeting from the day it was added
 * until it's removed — like open safety issues on the Safety slide.
 *
 * Pure rules only (no DB) so they're unit-tested: routes/meeting-reminders.ts
 * loads the rows and asks these which to show.
 */

export interface ReminderDates {
  id: number;
  /** London date (YYYY-MM-DD) it was added — shows from this day on. */
  startsOn: string;
  /** London date (YYYY-MM-DD) it was removed, or null while still live. */
  removedOn: string | null;
  createdAt: Date | string;
}

/** Does this reminder belong on the meeting held on `dateIso`?
 *  Removed during the day → gone from that day's meeting too (the removal
 *  is meant to be seen at once, not tomorrow). */
export function reminderShowsOn(r: Pick<ReminderDates, "startsOn" | "removedOn">, dateIso: string): boolean {
  if (r.startsOn > dateIso) return false;
  if (r.removedOn != null && r.removedOn <= dateIso) return false;
  return true;
}

/** Oldest first, so the list reads in the order things were added and a
 *  new reminder lands at the bottom where the person adding it expects it.
 *  Ties (same timestamp) fall back to id so the order never jumps. */
export function orderReminders<T extends Pick<ReminderDates, "id" | "createdAt">>(rows: readonly T[]): T[] {
  const t = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
  return [...rows].sort((a, b) => t(a.createdAt) - t(b.createdAt) || a.id - b.id);
}

/** The reminders to show on `dateIso`, in display order. */
export function remindersForDate<T extends ReminderDates>(rows: readonly T[], dateIso: string): T[] {
  return orderReminders(rows.filter(r => reminderShowsOn(r, dateIso)));
}

/** Tidy typed text: trim, collapse runs of spaces/newlines into one space,
 *  and drop a leading list marker ("- ", "* ", "• ", "1. ") people paste
 *  in from the old per-day notes. Empty → null (nothing to save). */
export function cleanReminderText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.replace(/\s+/g, " ").trim().replace(/^(?:[-*•]|\d+[.)])(?:\s+|$)/, "").trim();
  return t.length > 0 ? t : null;
}
