/**
 * "Not today" for a pulled kanban (Graeme, 2026-11-10). Objective C.
 *
 * Tape from Macfarlane mustn't go on its own order (its own delivery
 * charge), so the team waits until boxes are due too. Pressing Not today
 * keeps the kanban PULLED but moves the day it's queued for to tomorrow, so
 * it drops off today's orders and comes back every day until it's ordered.
 * Moving the date (rather than a separate flag) also keeps it inside the
 * Orders page's 7-day catch-up window however many days it waits.
 */
import { addDaysToDateString } from "./london-time";

/** The day a kanban put off today comes back: tomorrow (London). */
export function kanbanSnoozeTarget(today: string): string {
  return addDaysToDateString(today, 1);
}

/** Only a kanban that's pulled and showing today (queued for today or a
 *  missed earlier day) can be put off. */
export function canSnoozeKanban(row: { status: string; orderDayTarget: string | null }, today: string): boolean {
  return row.status === "pulled" && row.orderDayTarget != null && row.orderDayTarget <= today;
}

/** The day a pulled kanban next shows on Orders, when that's after today —
 *  null when it's on today's orders or isn't pulled. */
export function kanbanWaitingUntil(row: { status: string; orderDayTarget: string | null } | undefined, today: string): string | null {
  if (!row || row.status !== "pulled" || row.orderDayTarget == null) return null;
  return row.orderDayTarget > today ? row.orderDayTarget : null;
}
