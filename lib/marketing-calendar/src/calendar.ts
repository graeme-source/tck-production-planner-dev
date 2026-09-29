/**
 * Marketing calendar maths — pure, no React, no fetch (tested in
 * marketing-calendar.test.ts).
 *
 * Dates are ISO calendar days ("2026-10-16") throughout. They are turned into
 * Date objects at UTC noon only to count days, so a clock change or the
 * browser's timezone can never shift an event by a day.
 */

export interface CalendarSpan {
  id: number;
  startDate: string;
  endDate: string;
}

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  return new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday (UK weeks start on Monday). */
export function mondayIndex(iso: string): number {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -mondayIndex(iso));
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function daysInMonth(iso: string): number {
  return daysBetween(monthStart(iso), addMonths(iso, 1));
}

/**
 * The weeks shown for a month: Monday-start rows covering the whole month
 * (so the first row may begin in the previous month and the last row end in
 * the next). Each week is 7 ISO dates.
 */
export function monthGridWeeks(anyDayInMonth: string): string[][] {
  const first = monthStart(anyDayInMonth);
  const last = addDays(addMonths(first, 1), -1);
  const weeks: string[][] = [];
  for (let wk = startOfWeek(first); wk <= last; wk = addDays(wk, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(wk, i)));
  }
  return weeks;
}

export function overlaps(e: CalendarSpan, from: string, to: string): boolean {
  return e.endDate >= from && e.startDate <= to;
}

/**
 * Put events in lanes (rows) so no two events that share a day share a lane.
 * Earlier starts first; on a tie the longer event goes first so it sits on
 * top and the short ones tuck in beneath. Returns lane per event id.
 */
export function assignLanes<T extends CalendarSpan>(events: T[]): Map<number, number> {
  const sorted = [...events].sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
    || daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate)
    || a.id - b.id);
  const laneEnds: string[] = []; // last occupied day per lane
  const lanes = new Map<number, number>();
  for (const e of sorted) {
    let lane = laneEnds.findIndex(end => end < e.startDate);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.endDate); }
    else laneEnds[lane] = e.endDate;
    lanes.set(e.id, lane);
  }
  return lanes;
}

export interface WeekSegment<T extends CalendarSpan> {
  event: T;
  /** 0–6 columns within the week, inclusive. */
  startCol: number;
  endCol: number;
  lane: number;
  /** The event carries on from the previous week / into the next one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * The bar pieces for one week row of the month grid. A multi-week event is
 * cut at the week edges, so it wraps onto the next row like a paper
 * calendar. Lanes are worked out per week so a row is only as tall as it
 * needs to be.
 */
export function layoutWeek<T extends CalendarSpan>(week: string[], events: T[]): { segments: WeekSegment<T>[]; laneCount: number } {
  const from = week[0];
  const to = week[week.length - 1];
  const inWeek = events.filter(e => overlaps(e, from, to));
  const clipped = inWeek.map(e => ({
    ...e,
    startDate: e.startDate < from ? from : e.startDate,
    endDate: e.endDate > to ? to : e.endDate,
  }));
  const lanes = assignLanes(clipped);
  const segments = inWeek.map(e => {
    const s = e.startDate < from ? from : e.startDate;
    const en = e.endDate > to ? to : e.endDate;
    return {
      event: e,
      startCol: daysBetween(from, s),
      endCol: daysBetween(from, en),
      lane: lanes.get(e.id) ?? 0,
      continuesBefore: e.startDate < from,
      continuesAfter: e.endDate > to,
    };
  });
  const laneCount = segments.reduce((m, s) => Math.max(m, s.lane + 1), 0);
  return { segments, laneCount };
}

export type DragMode = "move" | "resize-start" | "resize-end";

/**
 * Where an event lands after a drag of `deltaDays`. Move shifts both ends;
 * a resize moves one end and never lets the event go shorter than one day
 * (the end can't pass the start, or vice versa).
 */
export function applyDrag(span: { startDate: string; endDate: string }, mode: DragMode, deltaDays: number): { startDate: string; endDate: string } {
  if (mode === "move") {
    return { startDate: addDays(span.startDate, deltaDays), endDate: addDays(span.endDate, deltaDays) };
  }
  if (mode === "resize-end") {
    const end = addDays(span.endDate, deltaDays);
    return { startDate: span.startDate, endDate: end < span.startDate ? span.startDate : end };
  }
  const start = addDays(span.startDate, deltaDays);
  return { startDate: start > span.endDate ? span.endDate : start, endDate: span.endDate };
}

/** Pixel drag on a timeline → whole days (nearest day). */
export function pixelsToDays(dx: number, dayWidth: number): number {
  if (dayWidth <= 0) return 0;
  const d = Math.round(dx / dayWidth);
  return d === 0 ? 0 : d; // avoid -0
}

export type TimelineZoom = "weeks" | "months";

/** Pixels per day at each zoom level. */
export const DAY_WIDTH: Record<TimelineZoom, number> = { weeks: 36, months: 10 };

/**
 * The timeline's visible range: from the Monday on/before `anchor`'s month
 * start, for `months` months, ending on a Sunday.
 */
export function timelineRange(anchor: string, months: number): { from: string; to: string; days: number } {
  const from = startOfWeek(monthStart(anchor));
  const end = addDays(addMonths(monthStart(anchor), months), -1);
  const to = addDays(startOfWeek(end), 6);
  return { from, to, days: daysBetween(from, to) + 1 };
}

/** "16–29 Oct", "28 Oct – 3 Nov", "18 Oct", "28 Dec 2026 – 3 Jan 2027". */
export function formatRange(start: string, end: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (start === end) return `${sd} ${MONTHS[sm - 1]}`;
  if (sy !== ey) return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
  if (sm === em) return `${sd}–${ed} ${MONTHS[sm - 1]}`;
  return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]}`;
}
