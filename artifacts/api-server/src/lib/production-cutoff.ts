// The cutoff rules for bag/wholesale order scheduling (Graeme, 2026-08-25):
//
//  - 07:00 London: an order can only join TODAY'S production if it arrives
//    before this — after that the kitchen is already running the day's plan,
//    so the earliest production day is tomorrow. The default delivery then
//    allows a comfortable two days from production: produce day 1, despatch
//    day 2, deliver day 3 (e.g. Tuesday afternoon → produce Wed, deliver Fri).
//
//  - 14:00 London: the last despatch of the day. An order processed after
//    this cannot go out today, so its earliest despatch is tomorrow and its
//    earliest delivery the day after (e.g. Tuesday afternoon → despatch Wed,
//    deliver Thu). This is the binding rule for wholesale 2-pack-only orders,
//    which need no production of their own.

import { londonDateString, londonMinuteOfDay } from "./london-time";

/** Orders arriving at or after this London wall-clock time can no longer join
 *  today's production. */
export const SAME_DAY_PRODUCTION_CUTOFF = "07:00";

/** Orders processed at or after this London wall-clock time can no longer be
 *  despatched today. */
export const DESPATCH_CUTOFF = "14:00";

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
const PRODUCTION_CUTOFF_MINUTES = minutesOf(SAME_DAY_PRODUCTION_CUTOFF);
const DESPATCH_CUTOFF_MINUTES = minutesOf(DESPATCH_CUTOFF);

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
  return londonMinuteOfDay(now) < PRODUCTION_CUTOFF_MINUTES ? today : addDays(today, 1);
}

/** The earliest day an order processed at `now` can be despatched: today
 *  before the 14:00 London cutoff, otherwise tomorrow. */
export function earliestDespatchDay(now: Date = new Date()): string {
  const today = londonDateString(now);
  return londonMinuteOfDay(now) < DESPATCH_CUTOFF_MINUTES ? today : addDays(today, 1);
}

/** The earliest delivery day for an order that needs no production of its own
 *  (wholesale 2-pack-only): the first Tue–Sat delivery day whose despatch day
 *  (delivery − 1) is on or after the earliest despatch day. */
export function earliestTagOnlyDeliveryDay(now: Date = new Date()): string {
  let d = addDays(earliestDespatchDay(now), 1);
  for (let i = 0; i < 7 && !isDeliveryDay(d); i++) d = addDays(d, 1);
  return d;
}

/** The default delivery day to propose for an order arriving at `now`:
 *  earliest production day + 2 (produce, despatch, deliver), pushed to the
 *  next Tue–Sat delivery day when it lands on a Sun/Mon. */
export function defaultDeliveryDay(now: Date = new Date()): string {
  let d = addDays(earliestProductionDay(now), 2);
  for (let i = 0; i < 7 && !isDeliveryDay(d); i++) d = addDays(d, 1);
  return d;
}
