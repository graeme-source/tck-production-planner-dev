/**
 * Station checklist schedules, expressed in the shared recurrence engine
 * (lib/recurrence). The rules are unchanged from the inline copy that used
 * to live in routes/checklists.ts — this file only translates the stored
 * columns into a RecurrenceRule:
 *
 *   daily          → every day
 *   weekly         → the stored days, Monday if none are stored
 *   specific_days  → the stored days; none stored = never
 *   periodic       → the stored days (Monday if none) every 4 weeks, the
 *                    anchor's week being an "on" week; no anchor = the
 *                    creation week; neither = always on (as before)
 *   anything else  → every day
 */
import { isDueOn, weekdayFromName, type RecurrenceRule, type Weekday } from "@workspace/recurrence";

export interface ChecklistScheduleFields {
  schedule: string;
  scheduleDays: string | null;
  scheduleAnchorDate?: string | null;
  createdAt?: Date | null;
}

function storedDays(json: string | null, fallback: Weekday[]): Weekday[] {
  if (!json) return fallback;
  let names: unknown;
  try { names = JSON.parse(json); } catch { return fallback; }
  if (!Array.isArray(names)) return fallback;
  return names
    .map(n => (typeof n === "string" ? weekdayFromName(n) : null))
    .filter((d): d is Weekday => d !== null);
}

export function checklistRule(t: ChecklistScheduleFields): RecurrenceRule {
  switch (t.schedule) {
    case "weekly":
      return { kind: "weekly", days: storedDays(t.scheduleDays, [1]) };
    case "specific_days":
      return { kind: "weekly", days: storedDays(t.scheduleDays, []) };
    case "periodic":
      return {
        kind: "weekly",
        days: storedDays(t.scheduleDays, [1]),
        interval: 4,
        anchor: t.scheduleAnchorDate ?? (t.createdAt ? t.createdAt.toISOString().slice(0, 10) : null),
      };
    default:
      return { kind: "daily" };
  }
}

/** Is this checklist template due on the given London date? */
export function templateMatchesDay(t: ChecklistScheduleFields, date: string): boolean {
  return isDueOn(checklistRule(t), date);
}
