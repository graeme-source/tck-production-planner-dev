/**
 * Team lists — the pure rules (Graeme, 2026-10-13). No database here; the
 * route loads rows and asks these functions what to show.
 *
 *   Access      admins always; managers when the list has no members set,
 *               or they are one of the members; viewers never.
 *   Today       an item shows when its latest occurrence (on or before
 *               today, not before its start date) is today — or is earlier,
 *               not yet done or skipped, and the item carries over. A newer
 *               occurrence always replaces an older one, so a missed weekly
 *               task shows "Overdue (from Tue)" until next Tuesday, and a
 *               daily task without carry-over simply starts again.
 *   Order       priority (P1 first), then time of day (untimed last), then
 *               the list's own order.
 *   Progress    shown = everything in today's view; done = done or
 *               skipped; overdue = carried over and still open.
 */
import {
  addDays, isDailyRhythm, isDueOn, isRecurrenceRule, lastOccurrenceOnOrBefore, type RecurrenceRule,
} from "@workspace/recurrence";

export interface ListAccessUser { id: number; role: string }

export function canAccessList(user: ListAccessUser, list: { memberIds: number[] | null }): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "manager") return false;
  const members = list.memberIds ?? [];
  return members.length === 0 || members.includes(user.id);
}

/** Only managers and admins may create a new list. */
export function canCreateList(user: ListAccessUser): boolean {
  return user.role === "admin" || user.role === "manager";
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

/** The next `days` days after today, with the items due on each (in list
 *  order) — the collapsed "Coming up" section. Every-day and weekday tasks
 *  are left out (they would fill every day and hide the weekly ones), and so
 *  are days with nothing. */
export function comingUp(items: DayItem[], today: string, days = 7): Array<{ date: string; itemIds: number[] }> {
  const sorted = [...items].filter(i => i.active && !(ruleOf(i) && isDailyRhythm(ruleOf(i)!))).sort(compareItems);
  const out: Array<{ date: string; itemIds: number[] }> = [];
  for (let i = 1; i <= days; i++) {
    const date = addDays(today, i);
    const ids = sorted.filter(item => {
      const rule = ruleOf(item);
      return rule != null && date >= item.startDate && isDueOn(rule, date);
    }).map(item => item.id);
    if (ids.length) out.push({ date, itemIds: ids });
  }
  return out;
}

/** May a tick be recorded against this date? Only the occurrence that is in
 *  today's view — today's, or the carried-over one — never a future day or an
 *  older, replaced cycle. */
export function canTickOccurrence(item: DayItem, dueDate: string, today: string): boolean {
  if (!item.active) return false;
  const rule = ruleOf(item);
  if (!rule) return false;
  return lastOccurrenceOnOrBefore(rule, today, item.startDate) === dueDate;
}
