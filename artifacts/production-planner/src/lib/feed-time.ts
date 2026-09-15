/**
 * Social-feed timestamps for the improvements feed (Graeme, 2026-09-15):
 * today reads relative ("6 hours ago"), yesterday reads "Yesterday 14:32",
 * anything older reads "Wed 10 Sep, 14:32" (with the year when it isn't
 * this year). London wall-clock decides what counts as today/yesterday.
 */

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" });
const LONDON_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const LONDON_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const LONDON_DATE_YEAR = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
const LONDON_YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric" });

export function feedTimestamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";

  const diffMs = now.getTime() - then.getTime();
  const thenDay = LONDON_DAY.format(then);
  const nowDay = LONDON_DAY.format(now);

  if (thenDay === nowDay && diffMs >= 0) {
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const yesterday = LONDON_DAY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (thenDay === yesterday) return `Yesterday ${LONDON_TIME.format(then)}`;

  const sameYear = LONDON_YEAR.format(then) === LONDON_YEAR.format(now);
  return sameYear
    ? `${LONDON_DATE.format(then)}, ${LONDON_TIME.format(then)}`
    : `${LONDON_DATE_YEAR.format(then)}, ${LONDON_TIME.format(then)}`;
}
