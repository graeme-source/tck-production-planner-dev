// Server runs in UTC on Railway, but the kitchen lives in London. Anywhere the
// code asks "what's today?" or "what's the start of today?" needs to answer in
// London time, not the server's timezone — otherwise the answer rolls over an
// hour before UK midnight in BST (and at UK midnight in GMT, when a late-night
// operator could already be on the next day's plan).
//
// These helpers wrap the standard idioms. Timestamps that record *when* an
// event happened (insert `updatedAt: new Date()`, etc.) stay as UTC instants —
// they don't need a timezone.

const LONDON_TZ = "Europe/London";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: LONDON_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  weekday: "long",
});

/** Today's date in London, formatted YYYY-MM-DD. */
export function londonDateString(date: Date = new Date()): string {
  return DATE_FORMATTER.format(date);
}

/** Today's weekday name in London, e.g. "Tuesday". */
export function londonWeekdayName(date: Date = new Date()): string {
  return WEEKDAY_FORMATTER.format(date);
}

const HOUR_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  hour: "2-digit",
  hourCycle: "h23",
});

/** Hour-of-day (0-23) of the given instant, in London time. */
export function londonHour(date: Date = new Date()): number {
  return Number.parseInt(HOUR_FORMATTER.format(date), 10);
}

const HOUR_MINUTE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Minutes since London midnight (0-1439) of the given instant. */
export function londonMinuteOfDay(date: Date = new Date()): number {
  const [h, m] = HOUR_MINUTE_FORMATTER.format(date).split(":");
  return Number.parseInt(h, 10) * 60 + Number.parseInt(m, 10);
}

/** UTC instant equal to 00:00:00 London on the given date. */
export function londonStartOfDay(date: Date = new Date()): Date {
  return londonDayBoundary(date, 0);
}

/** UTC instant equal to 23:59:59.999 London on the given date. */
export function londonEndOfDay(date: Date = new Date()): Date {
  const end = londonDayBoundary(date, 1);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return end;
}

function londonDayBoundary(date: Date, dayOffset: number): Date {
  const dateStr = londonDateString(date);
  // The same wall-clock date in London is either UTC or UTC+1 (BST). Probe
  // 12:00 UTC on that date, ask London what time it thinks that is, then back
  // out the offset to find true London-midnight.
  const probe = new Date(`${dateStr}T12:00:00Z`);
  const londonHourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TZ,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(probe);
  const londonHour = Number.parseInt(londonHourPart, 10);
  // londonHour is 12 in GMT or 13 in BST → offset = londonHour - 12
  const offsetHours = londonHour - 12;
  const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
  utcMidnight.setUTCHours(utcMidnight.getUTCHours() - offsetHours + dayOffset * 24);
  return utcMidnight;
}

/** Add whole calendar days to a YYYY-MM-DD string (date-only, so a clock
 *  change can't nudge it). */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${date}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * UTC instant of 00:00 London on a YYYY-MM-DD date.
 *
 * London midnight is either 00:00 UTC (GMT) or 23:00 UTC the evening before
 * (BST). This asks London directly which one it is, AT midnight — unlike
 * londonStartOfDay above, which reads the offset at midday and so is an hour
 * out on the two clock-change Sundays (the clocks change at 1-2am, after
 * that day's midnight).
 */
export function londonDayStartUtc(date: string): Date {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(utcMidnight.getTime())) throw new Error(`Not a date: ${date}`);
  const bstMidnight = new Date(utcMidnight.getTime() - 3_600_000);
  if (londonDateString(bstMidnight) === date && londonHour(bstMidnight) === 0) return bstMidnight;
  return utcMidnight;
}

/**
 * The instants covering London days `from`..`to` inclusive, as [start, end).
 * In summer that's 23:00 UTC the evening before to 23:00 UTC on `to`; in
 * winter midnight to midnight UTC. A span across a clock change is simply
 * an hour shorter or longer — both ends are real London midnights.
 */
export function londonDaysWindowUtc(from: string, to: string): { start: Date; end: Date } {
  return { start: londonDayStartUtc(from), end: londonDayStartUtc(addDaysToDateString(to, 1)) };
}
