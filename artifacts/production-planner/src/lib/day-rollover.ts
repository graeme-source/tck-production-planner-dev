/**
 * "Is this a new working day?" — the check behind the morning dashboard
 * bounce.
 *
 * People reported opening a station the next morning and landing straight on
 * YESTERDAY'S production page (Graeme, 2026-09-04). Nothing stores a "last
 * location" — the browser itself restores the URL it was on, and every
 * resume path (PIN unlock, fresh login, restored session) used to carry on
 * in place. The fix is not a midnight cron wiping state that doesn't exist:
 * it's asking, at the moment someone comes back, "was their last activity on
 * a previous London day?" — and if so, starting them on the dashboard.
 *
 * London days, not UTC: the kitchen runs on wall-clock days, and a UTC
 * boundary would roll over at 1am in summer.
 */

/** Calendar day (YYYY-MM-DD) of a timestamp in the Europe/London zone. */
export function londonDay(ts: number): string {
  // en-CA renders dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

/** True when `toTs` falls on a later London calendar day than `fromTs` —
 *  i.e. at least one London midnight has passed between the two moments.
 *  A `fromTs` of 0 (nothing recorded) is never "a previous day". */
export function crossedLondonMidnight(fromTs: number, toTs: number): boolean {
  if (!Number.isFinite(fromTs) || fromTs <= 0) return false;
  return londonDay(fromTs) !== londonDay(toTs);
}
