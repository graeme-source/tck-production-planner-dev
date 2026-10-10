/**
 * Use-by dates and batch numbers for product labels (pure, tested).
 *
 * Dates are ISO calendar days ("2026-10-10") — no times, no time zones. The
 * caller decides what "today" is (the London day); everything here is plain
 * calendar arithmetic done in UTC so a BST/GMT change can never shift a day.
 */

export type PeriodUnit = "days" | "weeks" | "months" | "years";

export interface ShelfPeriod {
  amount: number;
  unit: PeriodUnit;
}

export const PERIOD_UNITS: PeriodUnit[] = ["days", "weeks", "months", "years"];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(iso: string): { y: number; m: number; d: number } {
  const match = ISO_RE.exec(iso);
  if (!match) throw new Error(`Not a calendar date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Add whole days (negative allowed). */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseIso(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days, 12));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Add calendar months. A day that doesn't exist in the target month is
 *  clamped to that month's last day — 31 Jan + 1 month = 28 Feb (29 in a
 *  leap year), never 3 March. */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseIso(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** date + a shelf-life period, calendar-correct. */
export function addPeriod(iso: string, period: ShelfPeriod): string {
  const n = Math.trunc(period.amount);
  switch (period.unit) {
    case "days": return addDays(iso, n);
    case "weeks": return addDays(iso, n * 7);
    case "months": return addMonths(iso, n);
    case "years": return addMonths(iso, n * 12);
  }
}

/** dd/mm/yy, as printed on the label. */
export function formatLabelDate(iso: string): string {
  const { y, m, d } = parseIso(iso);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
}

/** Day of the year, 1–366. */
export function dayOfYear(iso: string): number {
  const { y, m, d } = parseIso(iso);
  let n = d;
  for (let i = 1; i < m; i++) n += daysInMonth(y, i);
  return n;
}

/** 5-digit Julian batch code YYDDD — 26147 = day 147 of 2026. */
export function julianBatchCode(iso: string): string {
  const { y } = parseIso(iso);
  return `${String(y % 100).padStart(2, "0")}${String(dayOfYear(iso)).padStart(3, "0")}`;
}

/** Which day the batch number is taken from (a template setting — Graeme
 *  hasn't decided; production day is the default). */
export type BatchBasis = "production-day" | "print-day";

export function describePeriod(p: ShelfPeriod): string {
  const one = p.unit.slice(0, -1);
  return `${p.amount} ${p.amount === 1 ? one : p.unit}`;
}

export interface LabelDates {
  printDate: string;
  productionDate: string;
  /** Null when the recipe has no chilled / frozen period (that line is left off). */
  chilledUseBy: string | null;
  frozenUseBy: string | null;
  batchCode: string;
}

/** The dates on one printed label. Use-by counts from the PRINT date (as
 *  briefed); the batch number from the basis the template chooses. */
export function labelDates(input: {
  printDate: string;
  productionDate: string;
  chilled: ShelfPeriod | null;
  frozen: ShelfPeriod | null;
  batchBasis: BatchBasis;
}): LabelDates {
  return {
    printDate: input.printDate,
    productionDate: input.productionDate,
    chilledUseBy: input.chilled && input.chilled.amount > 0 ? addPeriod(input.printDate, input.chilled) : null,
    frozenUseBy: input.frozen && input.frozen.amount > 0 ? addPeriod(input.printDate, input.frozen) : null,
    batchCode: julianBatchCode(input.batchBasis === "print-day" ? input.printDate : input.productionDate),
  };
}
