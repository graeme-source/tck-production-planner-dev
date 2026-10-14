/**
 * Team lists — the pure rules (Graeme, 2026-10-13). No database here; the
 * route loads rows and asks these functions what to show.
 *
 *   Access      (Graeme, 2026-10-14: "If I tick, you've got access.")
 *               Admins always. Anyone else — any role, viewers included —
 *               only when they are ticked on the list (member_ids). An
 *               empty list of members means admins only.
 *   Editing     rename, tasks, members, archive, import: managers and
 *               admins who can open the list. Ticking / skipping / undoing
 *               a task: everyone who can open it.
 *   Visibility  the Team lists section (dashboard, quick actions, To-dos
 *               header) shows only when the person can open at least one
 *               active list — or is an admin, who gets a way to create one.
 *   Today       an item shows when its latest occurrence (on or before
 *               today, not before its start date) is today — or is earlier,
 *               not yet done or skipped, and the item carries over. A newer
 *               occurrence always replaces an older one, so a missed weekly
 *               task shows "Overdue (from Tue)" until next Tuesday, and a
 *               daily task without carry-over simply starts again.
 *   Order       priority (P1 first), then time of day (untimed last), then
 *               the list's own order.
 *   Progress    shown = everything in today's view; done = done or
 *               skipped; overdue = carried over and still open. A task
 *               ticked early counts on its own day, never today.
 *   Tick early  (Graeme, 2026-10-14: weekly tasks "just need to be done that
 *               week") — anything in "Coming up this week" can be ticked or
 *               skipped now. The tick is stored against that occurrence's
 *               date (the due day), with who and the real time, so on the
 *               day it already shows as done. Only days the rule is due on,
 *               within the same 7-day window; every-day and weekday tasks
 *               aren't in Coming up, so they can't be ticked early.
 */
import {
  addDays, daysBetween, isDailyRhythm, isDueOn, isRecurrenceRule, lastOccurrenceOnOrBefore, type RecurrenceRule,
} from "@workspace/recurrence";

export interface ListAccessUser { id: number; role: string }

/** Open the list and tick its tasks: admins, plus whoever is ticked. */
export function canAccessList(user: ListAccessUser, list: { memberIds: number[] | null }): boolean {
  if (user.role === "admin") return true;
  return (list.memberIds ?? []).includes(user.id);
}

/** Only managers and admins may create a new list. */
export function canCreateList(user: ListAccessUser): boolean {
  return user.role === "admin" || user.role === "manager";
}

/** Change the list itself (name, tasks, who has access, archive, import):
 *  managers and admins who can open it. */
export function canEditList(user: ListAccessUser, list: { memberIds: number[] | null }): boolean {
  return canCreateList(user) && canAccessList(user, list);
}

/** Whether the Team lists section (dashboard row, quick-actions panel,
 *  To-dos header button) appears at all. `openListCount` = active lists
 *  this person can open. Admins also see it with none, to create one. */
export function teamListsVisible(user: ListAccessUser, openListCount: number): boolean {
  return openListCount > 0 || user.role === "admin";
}

/** Members for a newly created list: whoever was picked, plus the creator
 *  unless they're an admin (admins can always open it) — so a manager never
 *  creates a list they can't then open. Deduplicated. */
export function membersForNewList(user: ListAccessUser, picked: number[]): number[] {
  const ids = user.role === "admin" ? picked : [...picked, user.id];
  return [...new Set(ids)];
}

export interface DayItem {
  id: number;
  priority: number;
  timeOfDay: string | null;
  sortOrder: number;
  recurrence: unknown;
  carryOver: boolean;
  startDate: string;
  active: boolean;
}

export interface DayCompletion {
  itemId: number;
  dueDate: string;
  status: string;
  byName: string | null;
  at: string | Date;
  /** London date the tick was made on. A carried-over task closed TODAY
   *  stays in today's view (as done), so the count reads "3 of 3". */
  atDate?: string;
}

export interface DayEntry {
  itemId: number;
  /** The occurrence this row is for (today, or the missed day). */
  dueDate: string;
  overdue: boolean;
  completion: { status: "done" | "skipped"; byName: string | null; at: string } | null;
}

export interface DayProgress { total: number; done: number; overdue: number }

function ruleOf(item: DayItem): RecurrenceRule | null {
  return isRecurrenceRule(item.recurrence) ? item.recurrence : null;
}

/** Which occurrence (if any) belongs in today's view for this item. */
export function occurrenceForToday(item: DayItem, today: string, closedOn: (dueDate: string) => string | null | undefined): { dueDate: string; overdue: boolean } | null {
  if (!item.active) return null;
  const rule = ruleOf(item);
  if (!rule) return null;
  const occ = lastOccurrenceOnOrBefore(rule, today, item.startDate);
  if (!occ) return null;
  if (occ === today) return { dueDate: occ, overdue: false };
  if (!item.carryOver) return null;
  const closed = closedOn(occ);
  if (closed === undefined || closed === today) return { dueDate: occ, overdue: true };
  return null;
}

/** The (item, date) pairs whose completions the day view needs: each
 *  item's latest occurrence on or before today. */
export function occurrencesToLoad(items: DayItem[], today: string): Array<{ itemId: number; dueDate: string }> {
  const out: Array<{ itemId: number; dueDate: string }> = [];
  for (const item of items) {
    if (!item.active) continue;
    const rule = ruleOf(item);
    if (!rule) continue;
    const occ = lastOccurrenceOnOrBefore(rule, today, item.startDate);
    if (occ) out.push({ itemId: item.id, dueDate: occ });
  }
  return out;
}

export function compareItems(a: DayItem, b: DayItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ta = a.timeOfDay ?? "99:99", tb = b.timeOfDay ?? "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.id - b.id;
}

function iso(at: string | Date): string {
  return at instanceof Date ? at.toISOString() : at;
}

export function buildDay(items: DayItem[], completions: DayCompletion[], today: string): { entries: DayEntry[]; progress: DayProgress } {
  const byKey = new Map<string, DayCompletion>();
  for (const c of completions) byKey.set(`${c.itemId}|${c.dueDate}`, c);
  const entries: DayEntry[] = [];
  for (const item of [...items].sort(compareItems)) {
    // undefined = still open; otherwise the London day it was closed (null if unknown).
    const occ = occurrenceForToday(item, today, d => {
      const c = byKey.get(`${item.id}|${d}`);
      return c ? (c.atDate ?? null) : undefined;
    });
    if (!occ) continue;
    const c = byKey.get(`${item.id}|${occ.dueDate}`);
    entries.push({
      itemId: item.id,
      dueDate: occ.dueDate,
      overdue: occ.overdue,
      completion: c ? { status: c.status === "skipped" ? "skipped" : "done", byName: c.byName, at: iso(c.at) } : null,
    });
  }
  return {
    entries,
    progress: {
      total: entries.length,
      done: entries.filter(e => e.completion).length,
      overdue: entries.filter(e => e.overdue && !e.completion).length,
    },
  };
}

/** How far ahead "Coming up this week" looks — and so how early a task can
 *  be ticked. */
export const UPCOMING_DAYS = 7;

/** Is `date` an occurrence of this item in "Coming up": after today, within
 *  `days`, on or after its start date, a day its rule is due — and not an
 *  every-day / weekday task (they would fill every day and hide the weekly
 *  ones). */
export function isUpcomingOccurrence(item: DayItem, date: string, today: string, days = UPCOMING_DAYS): boolean {
  if (!item.active) return false;
  const rule = ruleOf(item);
  if (!rule || isDailyRhythm(rule)) return false;
  const ahead = daysBetween(today, date);
  if (ahead < 1 || ahead > days) return false;
  return date >= item.startDate && isDueOn(rule, date);
}

/** The (item, date) pairs "Coming up" shows, so their early ticks can be
 *  loaded. */
export function upcomingOccurrencesToLoad(items: DayItem[], today: string, days = UPCOMING_DAYS): Array<{ itemId: number; dueDate: string }> {
  const out: Array<{ itemId: number; dueDate: string }> = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    for (const item of items) if (isUpcomingOccurrence(item, date, today, days)) out.push({ itemId: item.id, dueDate: date });
  }
  return out;
}

export interface UpcomingDay {
  date: string;
  itemIds: number[];
  /** One per item, in the same order — with its early tick, if any. */
  entries: DayEntry[];
}

/** The next `days` days after today, with the items due on each (in list
 *  order) and any early ticks — the "Coming up this week" section. Days with
 *  nothing are left out. */
export function comingUp(items: DayItem[], today: string, days = UPCOMING_DAYS, completions: DayCompletion[] = []): UpcomingDay[] {
  const byKey = new Map<string, DayCompletion>();
  for (const c of completions) byKey.set(`${c.itemId}|${c.dueDate}`, c);
  const sorted = [...items].sort(compareItems);
  const out: UpcomingDay[] = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    const due = sorted.filter(item => isUpcomingOccurrence(item, date, today, days));
    if (!due.length) continue;
    out.push({
      date,
      itemIds: due.map(item => item.id),
      entries: due.map(item => {
        const c = byKey.get(`${item.id}|${date}`);
        return {
          itemId: item.id, dueDate: date, overdue: false,
          completion: c ? { status: c.status === "skipped" ? "skipped" as const : "done" as const, byName: c.byName, at: iso(c.at) } : null,
        };
      }),
    });
  }
  return out;
}

/** May a tick (or undo) be recorded against this date? The occurrence in
 *  today's view — today's, or the carried-over one — or one in "Coming up"
 *  (ticked early). Never an older, replaced cycle, a day the rule isn't due,
 *  or further ahead than Coming up looks. */
export function canTickOccurrence(item: DayItem, dueDate: string, today: string, days = UPCOMING_DAYS): boolean {
  if (!item.active) return false;
  const rule = ruleOf(item);
  if (!rule) return false;
  if (dueDate > today) return isUpcomingOccurrence(item, dueDate, today, days);
  return lastOccurrenceOnOrBefore(rule, today, item.startDate) === dueDate;
}

/** Why a tick was refused, in words for the person. */
export function tickRefusal(dueDate: string, today: string): string {
  return dueDate > today
    ? "A task can only be ticked early on a day it's due, up to a week ahead — refresh the list"
    : "That day's task has already moved on — refresh the list";
}
