/**
 * Label for a pulled kanban put off with "Not today" (Graeme, 2026-11-10):
 * it stays pulled and comes back on the orders the day it's waiting until.
 * Objective C.
 */
import { londonToday } from "./station-training";

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "back tomorrow", or "back Thu" further out. Null when not waiting. */
export function kanbanWaitingLabel(waitingUntil: string | null | undefined, today: string = londonToday()): string | null {
  if (!waitingUntil || waitingUntil <= today) return null;
  if (waitingUntil === addDays(today, 1)) return "back tomorrow";
  const day = new Date(`${waitingUntil}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return `back ${day}`;
}
