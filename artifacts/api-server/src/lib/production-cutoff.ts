// The 7 a.m. rule for bag/wholesale order scheduling (Graeme, 2026-08-25):
// an order can only join TODAY'S production if it arrives before 07:00 London —
// after that the kitchen is already running the day's plan, so the earliest
// production day is tomorrow. The default delivery then allows a comfortable
// two days from production: produce day 1, despatch day 2, deliver day 3
// (e.g. an order on Tuesday afternoon → produce Wed, despatch Thu, deliver Fri).

import { londonDateString, londonMinuteOfDay } from "./london-time";

/** Orders arriving at or after this London wall-clock time can no longer join
 *  today's production. */
export const SAME_DAY_PRODUCTION_CUTOFF = "07:00";

const CUTOFF_MINUTES = (() => {
  const [h, m] = SAME_DAY_PRODUCTION_CUTOFF.split(":").map(Number);
  return h * 60 + m;
})();

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Delivery days are Tue–Sat (despatch the day before, Mon–Fri). */
export function isDeliveryDay(day: string): boolean {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  return w >= 2 && w <= 6;
}

/** The earliest production day an order arriving at `now` may be planned onto:
 *  today before the 07:00 London cutoff, otherwise tomorrow. */
export function earliestProductionDay(now: Date = new Date()): string {
  const today = londonDateString(now);
  return londonMinuteOfDay(now) < CUTOFF_MINUTES ? today : addDays(today, 1);
}

/** The default delivery day to propose for an order arriving at `now`:
 *  earliest production day + 2 (produce, despatch, deliver), pushed to the
 *  next Tue–Sat delivery day when it lands on a Sun/Mon. */
export function defaultDeliveryDay(now: Date = new Date()): string {
  let d = addDays(earliestProductionDay(now), 2);
  for (let i = 0; i < 7 && !isDeliveryDay(d); i++) d = addDays(d, 1);
  return d;
}
