/**
 * When a queued 8-pack order shows on the dashboard (Graeme, 22 Nov 2026:
 * "I don't want to see this on here for the next week, every day … show this
 * on the morning that the production plan would normally be made").
 *
 * A make-day's plan is normally made two working days (Mon–Fri) before it —
 * Fri for Tue, Mon for Wed, Thu for Mon (read from live plans, Oct–Nov 2026).
 * So a queued order shows from that morning, until its bags are on a plan
 * (the server stops returning it then), and stays red once its make-day has
 * come with no plan.
 */
import { londonToday } from "./station-training";

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The working day, two working days before the make-day, its plan is normally made. */
export function planningDayFor(productionDate: string): string {
  let d = productionDate;
  let working = 0;
  while (working < 2) {
    d = addDays(d, -1);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) working++;
  }
  return d;
}

export function showQueuedOrder(
  row: { productionDate: string; overdue: boolean },
  today: string = londonToday(),
): boolean {
  return row.overdue || today >= planningDayFor(row.productionDate);
}
