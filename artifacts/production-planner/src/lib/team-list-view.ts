/**
 * Team lists — the small pure pieces of the screens (tested): which preset
 * button a rule belongs to, the rule a preset makes, and the wording of an
 * overdue badge or a "done by" line. Day maths comes from lib/recurrence.
 */
import {
  addDays, daysBetween, isDailyRhythm, weekdayOf, WEEKDAY_SHORT, type RecurrenceRule, type Weekday,
} from "@workspace/recurrence";
import type { SortSpec, TaskSortFields } from "./task-sort";

export type Preset = "daily" | "weekdays" | "days" | "weekly" | "every_n" | "monthly";

export const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: "daily", label: "Every day" },
  { key: "weekdays", label: "Weekdays" },
  { key: "days", label: "Pick days" },
  { key: "weekly", label: "Weekly" },
  { key: "every_n", label: "Every 2+ weeks" },
  { key: "monthly", label: "Monthly" },
];

export function presetOf(rule: RecurrenceRule): Preset {
  switch (rule.kind) {
    case "daily": return "daily";
    case "weekdays": return "weekdays";
    case "monthly": return "monthly";
    case "weekly":
      if ((rule.interval ?? 1) > 1) return "every_n";
      return rule.days.length === 1 ? "weekly" : "days";
  }
}

/** The first date on or after `today` that falls on `day` — the anchor for
 *  an every-N-weeks rule, so its first occurrence is the next one. */
export function nextOn(day: Weekday, today: string): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === day) return d;
  }
  return today;
}

/** The rule a preset button makes, keeping what it can from the current
 *  rule (its days, its day of the month). */
export function ruleForPreset(preset: Preset, current: RecurrenceRule, today: string): RecurrenceRule {
  const currentDays: Weekday[] = current.kind === "weekly" && current.days.length ? current.days : [weekdayOf(today)];
  switch (preset) {
    case "daily": return { kind: "daily" };
    case "weekdays": return { kind: "weekdays" };
    case "days": return { kind: "weekly", days: currentDays };
    case "weekly": return { kind: "weekly", days: [currentDays[0]] };
    case "every_n": {
      if (current.kind === "weekly" && (current.interval ?? 1) > 1) return current;
      const day = currentDays[0];
      return { kind: "weekly", days: [day], interval: 2, anchor: nextOn(day, today) };
    }
    case "monthly": return current.kind === "monthly" ? current : { kind: "monthly", dayOfMonth: Number(today.slice(8, 10)) };
  }
}

/** Default for the "carry over if missed" switch when the rhythm changes. */
export function defaultCarryOver(rule: RecurrenceRule): boolean {
  return !isDailyRhythm(rule);
}

/** "Overdue (from Tue)", or "(from 3 Oct)" once it's over a week old. */
export function overdueLabel(dueDate: string, today: string): string {
  const ago = daysBetween(dueDate, today);
  if (ago === 1) return "Overdue (from yesterday)";
  if (ago <= 6) return `Overdue (from ${WEEKDAY_SHORT[weekdayOf(dueDate)]})`;
  const d = new Date(`${dueDate}T12:00:00Z`);
  return `Overdue (from ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })})`;
}

/** "Lorna · 08:12" (London time), with the day when it wasn't today. */
export function doneByLabel(byName: string | null, at: string, today: string): string {
  const when = new Date(at);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
  const time = when.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  const dayPart = day === today ? time : `${WEEKDAY_SHORT[weekdayOf(day)]} ${time}`;
  return `${byName ?? "Someone"} · ${dayPart}`;
}

/** "Thursday 15 Oct" for the Coming up headings. */
export function dayHeading(date: string, today: string): string {
  if (daysBetween(today, date) === 1) return "Tomorrow";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Team lists open on "Time, then Priority" (Graeme, 2026-10-13: the 3:00
 *  red before the 4:00 red, then on through the day). */
export const TEAM_LIST_DEFAULT_SORT: SortSpec = { primary: "time", secondary: "priority" };

/** One task's sort fields. An overdue entry's time carries its due day too,
 *  so the Overdue section runs oldest first. */
export function teamTaskSortFields(
  item: { title: string; priority: number; timeOfDay: string | null; sortOrder: number },
  entry?: { dueDate: string; overdue: boolean },
): TaskSortFields {
  const time = entry?.overdue ? `${entry.dueDate} ${item.timeOfDay ?? "99:99"}` : item.timeOfDay;
  return { priority: item.priority, time, overdue: entry?.overdue ?? false, order: item.sortOrder, title: item.title };
}

/** "Who can use this list" search (Graeme, 2026-10-14): every active person
 *  is listed; the box narrows by any part of the name, ignoring case. People
 *  already ticked stay in view so an untick is never hidden by a search. */
export function filterListPeople<T extends { id: number; name: string }>(
  people: readonly T[], query: string, ticked: ReadonlySet<number>,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...people];
  return people.filter(p => ticked.has(p.id) || p.name.toLowerCase().includes(q));
}

/** The line under "Who can use this list". */
export function membersSummary(tickedCount: number): string {
  if (tickedCount === 0) return "Nobody ticked — only admins can open it.";
  return `${tickedCount} ${tickedCount === 1 ? "person" : "people"} ticked, plus admins.`;
}
