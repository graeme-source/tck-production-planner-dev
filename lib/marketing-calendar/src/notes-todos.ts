/**
 * Notes and to-dos on the marketing calendar (Graeme, 2026-10-01) — the pure
 * rules, shared by the server and the page (tested in notes-todos.test.ts).
 *
 * NOTES: "I want to be able to add an idea or a note to any given day." A
 * note is a marketing calendar event of type "note" — one day, a short title
 * and optional longer text — so it gets the events' who-added / who-edited
 * stamps, history and soft delete for free. A note is NOT a phase: it must
 * never take emails, count as "something on", or be a backdrop band, so
 * everything that files emails into phases first drops notes
 * (filingEvents()).
 *
 * TO-DOS: each person sees their OWN to-dos (due or scheduled) on the
 * calendar. The one exception is the founder, who may switch on the to-dos
 * of other people who can see this calendar ("maybe I can turn on his to-do
 * so I can see everything he's doing"). Nobody else may ever see another
 * person's to-dos here — decideTodoViewers() is the rule, enforced by the
 * server.
 */

/** The stored event_type of a note. */
export const NOTE_EVENT_TYPE = "note";

export function isNoteEvent(e: { type?: string | null; eventType?: string | null }): boolean {
  return (e.type ?? e.eventType) === NOTE_EVENT_TYPE;
}

/** The events that can hold emails / count as cover — everything but notes. */
export function filingEvents<T extends { type?: string | null; eventType?: string | null }>(events: readonly T[]): T[] {
  return events.filter(e => !isNoteEvent(e));
}

/** A note is one day: its end is its start. */
export function noteDatesValid(d: { startDate: string; endDate: string }): boolean {
  return d.startDate === d.endDate;
}

// ── Whose to-dos may this viewer see? ───────────────────────────────────────

export type TodoViewerDecision =
  | { ok: true; userIds: number[] }
  | { ok: false; reason: string };

/**
 * THE RULE for the calendar's to-dos:
 *  - the viewer always gets their own;
 *  - asking for anyone else's is refused, UNLESS the viewer is the founder
 *    and that person is one of the calendar's people (has Sales & Marketing).
 * Anything not allowed refuses the whole request (fail closed) rather than
 * silently dropping it, so a bug can't look like "they have no to-dos".
 */
export function decideTodoViewers(input: {
  viewerId: number;
  viewerIsFounder: boolean;
  /** Other people's ids the viewer asked to see (may include the viewer). */
  requestedIds: readonly number[];
  /** People who can see the marketing calendar (founder.sales holders). */
  calendarPeopleIds: readonly number[];
}): TodoViewerDecision {
  const { viewerId, viewerIsFounder, requestedIds, calendarPeopleIds } = input;
  const others = [...new Set(requestedIds.filter(id => id !== viewerId))];
  if (others.length > 0 && !viewerIsFounder) {
    return { ok: false, reason: "You can only see your own to-dos here." };
  }
  const allowed = new Set(calendarPeopleIds);
  const notAllowed = others.filter(id => !allowed.has(id));
  if (notAllowed.length > 0) {
    return { ok: false, reason: "Only the to-dos of people who use the marketing calendar can be shown." };
  }
  return { ok: true, userIds: [viewerId, ...others] };
}

/** Parse "3,9" from a query string into ids; junk is ignored. */
export function parseIdList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))];
}

// ── Which day does a to-do sit on? ──────────────────────────────────────────

export interface TodoDates {
  /** Plain calendar days (YYYY-MM-DD). The to-do columns are SQL DATEs — a
   *  London calendar day already — so no timezone shifting happens here. */
  dueDate: string | null;
  scheduledFor: string | null;
}

/**
 * The day a to-do shows on: its due day when it has one (the commitment),
 * otherwise the day it's scheduled for. No date → not on the calendar.
 */
export function todoCalendarDay(t: TodoDates): { date: string; kind: "due" | "scheduled" } | null {
  if (t.dueDate) return { date: t.dueDate.slice(0, 10), kind: "due" };
  if (t.scheduledFor) return { date: t.scheduledFor.slice(0, 10), kind: "scheduled" };
  return null;
}

/** The to-dos that land inside [from, to], each with its day. */
export function todosInRange<T extends TodoDates>(todos: readonly T[], from: string, to: string): Array<T & { date: string; dateKind: "due" | "scheduled" }> {
  const out: Array<T & { date: string; dateKind: "due" | "scheduled" }> = [];
  for (const t of todos) {
    const d = todoCalendarDay(t);
    if (!d || d.date < from || d.date > to) continue;
    out.push({ ...t, date: d.date, dateKind: d.kind });
  }
  return out;
}

/** Initials for another person's chip ("Tommy Noithip" → "TN"). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
