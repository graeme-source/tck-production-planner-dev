/**
 * The first delivery day after a Saturday that couldn't be delivered —
 * where the Friday dispatch check moves an order by default (Graeme, 11 Nov
 * 2026). Normally Tuesday (Monday's dispatch); after a bank-holiday Monday
 * or Tuesday it's the next day that both has a dispatch the day before and
 * is open on the checkout's delivery calendar (Zapiet — its blackout dates
 * are where holidays live), never a weekend. Objective C. Pure; tested.
 */
import { addDaysToDateString } from "./london-time";

export interface DeliveryCalendar {
  /** 0 = Sunday … 6 = Saturday — weekdays Zapiet never delivers on. */
  disabledWeekdays: ReadonlySet<number>;
  /** Dates Zapiet has blacked out (YYYY-MM-DD). */
  blockedDates: ReadonlySet<string>;
  /** Our own closures — bank holidays, shutdowns (app setting non_dispatch_dates). */
  nonDispatchDates: ReadonlySet<string>;
  /** Zapiet's allow-list mode: ONLY these dates are open (blockedDates unused). */
  allowedDates?: ReadonlySet<string> | null;
}

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

/** Zapiet's `disabled` list, read the way the website assistant reads it
 *  (cs-agent date-change.ts): plain numbers are weekdays counted 1 = Sunday …
 *  7 = Saturday (pickadate) — returned 0 = Sunday … 6 = Saturday; [year,
 *  monthIndex, day] are dates; a `true` means allow-list mode, where the
 *  dates listed are the OPEN ones. */
export function parseZapietDisabled(disabled: unknown[] | undefined): { weekdays: Set<number>; dates: Set<string>; allowList: boolean } {
  const weekdays = new Set<number>();
  const dates = new Set<string>();
  let allowList = false;
  for (const e of disabled ?? []) {
    if (e === true) allowList = true;
    else if (typeof e === "number" && Number.isInteger(e) && e >= 1 && e <= 7) weekdays.add(e - 1);
    else if (Array.isArray(e) && e.length >= 3 && e.every(n => typeof n === "number")) {
      const [y, m, d] = e as number[];
      dates.add(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  }
  return { weekdays, dates, allowList };
}

/** Delivery date (and its dispatch day) for an order taken off this Saturday. */
export function firstDeliveryAfterWeekend(saturday: string, cal: DeliveryCalendar, searchDays = 21): { delivery: string; dispatch: string } | null {
  for (let i = 1; i <= searchDays; i++) {
    const delivery = addDaysToDateString(saturday, i);
    const dispatch = addDaysToDateString(delivery, -1);
    const wd = weekday(delivery);
    const dispatchWd = weekday(dispatch);
    if (wd === 0 || wd === 6) continue;                       // no weekend deliveries
    if (dispatchWd === 0 || dispatchWd === 6) continue;       // no weekend dispatch (so no Monday delivery)
    if (cal.disabledWeekdays.has(wd)) continue;
    if (cal.allowedDates ? !cal.allowedDates.has(delivery) : cal.blockedDates.has(delivery)) continue;
    if (cal.nonDispatchDates.has(delivery) || cal.nonDispatchDates.has(dispatch)) continue;
    return { delivery, dispatch };
  }
  return null;
}
