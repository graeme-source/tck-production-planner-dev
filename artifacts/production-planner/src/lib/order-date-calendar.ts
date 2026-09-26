// Calendar maths for the 8-pack & wholesale order dialog: lays the days
// between today and an order's delivery date out as Mon–Sun week rows, so the
// gap between Make, Despatch and Deliver is visible at a glance — especially
// across a month end (Graeme, 2026-09-26). Dates are plain YYYY-MM-DD strings,
// handled at UTC noon so no timezone can shift a day.

function toDate(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** The Monday on or before the given date. */
export function mondayOf(s: string): string {
  const dow = toDate(s).getUTCDay(); // 0 = Sun
  return addDays(s, -((dow + 6) % 7));
}

/**
 * Whole Mon–Sun weeks covering every date from `from` to `to` inclusive
 * (order-insensitive). Each week is seven YYYY-MM-DD strings.
 */
export function calendarWeeks(from: string, to: string): string[][] {
  const [start, end] = from <= to ? [from, to] : [to, from];
  const weeks: string[][] = [];
  let cursor = mondayOf(start);
  while (cursor <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}
