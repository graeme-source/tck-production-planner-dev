/**
 * Team efficiency — pure maths for the one team KPI (Objective I, feeds E/G).
 *
 *   value credited today = (1 − despatchShare) × net value of GOOD packs that
 *                          went into the fridge/freezer today
 *                        + despatchShare × net value of packs despatched today
 *   labour cost today    = pay for productive shifts × employer on-cost multiplier
 *   R                    = value credited ÷ labour cost
 *   efficiency %         = R ÷ standard R × 100      (standard = 100%)
 *
 * Nothing here reads the database or Planday: callers pass plain numbers, so
 * the same functions serve the back-test, a nightly job and any page. Not
 * wired into the app yet (back-test 2026-09-25).
 *
 * No product, recipe or category names live here — per-category discount
 * rates and prices are passed in by the caller.
 */

// ── Planday shift pay ─────────────────────────────────────────────────────

export interface PlandayPayrollBreak {
  /** Hours (Planday sends break durations in hours). */
  duration: number;
  /** Money for the break; negative for an unpaid break. */
  amount: number;
  isPaid: boolean;
}

export interface PlandayPayrollShift {
  /** Planday's `salary` — (end − start) × rate. Unpaid breaks are NOT taken off. */
  salary: number;
  start: string;
  end: string;
  breaks: PlandayPayrollBreak[];
}

/** What the shift actually pays: Planday's salary plus the (negative) amounts
 *  of its unpaid breaks. Measured 2026-09-25: summed over 394 approved
 *  shifts this equals paid hours × rate exactly, while salary alone is 8.5%
 *  higher. */
export function shiftPay(s: PlandayPayrollShift): number {
  const unpaid = s.breaks.filter(b => !b.isPaid).reduce((n, b) => n + b.amount, 0);
  return s.salary + unpaid;
}

/** Paid hours: end − start minus unpaid breaks (break durations are in hours). */
export function shiftPaidHours(s: PlandayPayrollShift): number {
  const gross = (new Date(s.end).getTime() - new Date(s.start).getTime()) / 3_600_000;
  const unpaid = s.breaks.filter(b => !b.isPaid).reduce((n, b) => n + b.duration, 0);
  return Math.max(0, gross - unpaid);
}

/** Shift types that are never productive time even when the position is. */
const NON_PRODUCTIVE_SHIFT_TYPE = /training|meeting|holiday|sick|absent|leave/i;

/** Productive = the shift's position sits in Planday's "Production" section
 *  (Graeme controls membership from Planday) and the shift type is not
 *  training, a meeting, holiday, sickness or other leave. */
export function isProductiveShift(
  positionSectionId: number | null | undefined,
  productionSectionId: number,
  shiftTypeName: string | null | undefined,
): boolean {
  if (positionSectionId !== productionSectionId) return false;
  return !(shiftTypeName && NON_PRODUCTIVE_SHIFT_TYPE.test(shiftTypeName));
}

// ── Employer on-costs ─────────────────────────────────────────────────────

export interface OnCostSettings {
  /** Holiday accrued on every hour worked, e.g. 0.1207. Not inside the hourly rate. */
  holidayAccrual: number;
  /** Employer NI rate, e.g. 0.15. */
  niRate: number;
  /** Secondary threshold per person per week, e.g. 96.15. */
  niWeeklyThreshold: number;
  /** Employment Allowance per year, e.g. 10500. */
  employmentAllowanceAnnual: number;
  /** Employer pension as a share of pay, e.g. 0.03. */
  pensionRate: number;
}

/**
 * Effective employer NI as a share of holiday-inclusive pay over a period.
 * `weeklyPay` is one entry per person per week (ALL paid shifts, not only
 * productive ones — the threshold applies to the person's whole week).
 */
export function effectiveNiRate(weeklyPay: number[], weeks: number, s: OnCostSettings): number {
  const withHoliday = weeklyPay.map(p => p * (1 + s.holidayAccrual));
  const total = withHoliday.reduce((n, p) => n + p, 0);
  if (total <= 0) return 0;
  const ni = withHoliday.reduce((n, p) => n + Math.max(0, p - s.niWeeklyThreshold) * s.niRate, 0);
  const allowance = s.employmentAllowanceAnnual * (weeks * 7) / 365;
  return Math.max(0, ni - allowance) / total;
}

/** Multiplier from shift pay to full employer cost:
 *  (1 + holiday accrual) × (1 + effective NI + pension). */
export function onCostMultiplier(niEffective: number, s: Pick<OnCostSettings, "holidayAccrual" | "pensionRate">): number {
  return (1 + s.holidayAccrual) * (1 + niEffective + s.pensionRate);
}

// ── Value ─────────────────────────────────────────────────────────────────

export interface PackLine {
  packs: number;
  /** Price of one pack at RRP (recipes.rrp for that recipe's pack size). */
  rrp: number;
  /** Fixed discount rate for this line's category, e.g. 0.22. */
  discountRate: number;
}

/** Net value of packs: Σ packs × RRP × (1 − discount). */
export function netValue(lines: PackLine[]): number {
  return lines.reduce((n, l) => n + l.packs * l.rrp * (1 - l.discountRate), 0);
}

/** Value credited to a day: most on production, the rest on despatch. */
export function creditedValue(madeNet: number, despatchedNet: number, despatchShare: number): number {
  return (1 - despatchShare) * madeNet + despatchShare * despatchedNet;
}

// ── Efficiency ────────────────────────────────────────────────────────────

export interface DayFigures {
  date: string;
  credited: number;
  labourCost: number;
  /** Leave out of the standard and the rolling figure (e.g. a day whose
   *  output wasn't recorded). */
  exclude?: boolean;
}

export interface DayEfficiency {
  date: string;
  /** Value credited per £1 of labour; null when no labour was paid. */
  ratio: number | null;
  efficiencyPct: number | null;
  /** Ratio of sums over the last `window` non-excluded days ÷ standard. */
  rollingPct: number | null;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The standard: median daily ratio over a baseline set of days. */
export function standardRatio(days: DayFigures[]): number | null {
  return median(days.filter(d => !d.exclude && d.labourCost > 0).map(d => d.credited / d.labourCost));
}

export function dailyEfficiency(days: DayFigures[], standard: number, window = 7): DayEfficiency[] {
  const kept: DayFigures[] = [];
  return days.map(d => {
    const ratio = d.labourCost > 0 ? d.credited / d.labourCost : null;
    if (!d.exclude && d.labourCost > 0) kept.push(d);
    const win = kept.slice(-window);
    const labour = win.reduce((n, x) => n + x.labourCost, 0);
    const rollingPct = labour > 0 && standard > 0
      ? (win.reduce((n, x) => n + x.credited, 0) / labour) / standard * 100
      : null;
    return {
      date: d.date,
      ratio,
      efficiencyPct: ratio != null && standard > 0 ? ratio / standard * 100 : null,
      rollingPct,
    };
  });
}
