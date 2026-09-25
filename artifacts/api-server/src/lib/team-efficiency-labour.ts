/**
 * Team efficiency — labour per production day from Planday (Objective I;
 * pure, no I/O). Callers pass approved payroll rows, the rota's shifts (for
 * approval status and shift type), positions and shift types.
 *
 *   - Productive = position in the Planday "Production" section and a shift
 *     type that isn't training/meeting/holiday/sick/leave (isProductiveShift).
 *   - Pay = salary with unpaid breaks taken off (shiftPay), × the employer
 *     on-cost multiplier for that shift's week (holiday accrual, NI over the
 *     weekly threshold less the Employment Allowance, pension).
 *   - A shift on a rest day — Saturday, Sunday or a listed non-dispatch day
 *     (bank holiday / shutdown) — counts against the NEXT production day
 *     (Sunday or bank-holiday dough prep). A shift on an ordinary weekday
 *     with no plan belongs to no production day: there is no recorded
 *     output to set it against, so it is left out rather than dumped on a
 *     later day.
 *   - A day is only complete once every productive shift attributed to it is
 *     approved. Shifts older than `staleAfterDays` that were never approved
 *     are left out (flagged) so one forgotten shift can't blank a day forever.
 *
 * Only totals leave this module — never a person's pay.
 */
import {
  shiftPay, shiftPaidHours, isProductiveShift, effectiveNiRate, onCostMultiplier,
  type PlandayPayrollBreak, type OnCostSettings,
} from "./team-efficiency";

export interface PayrollRowInput {
  /** Planday shift id — the same id the rota uses. */
  id: number;
  employeeId: number;
  date: string;
  positionId: number | null;
  salary: number;
  start: string;
  end: string;
  breaks: PlandayPayrollBreak[];
}

export interface RotaShiftInput {
  id: number;
  employeeId: number | null;
  date: string;
  status: string | null;
  positionId: number | null;
  shiftTypeId: number | null;
}

export interface PositionInput { id: number; name: string; sectionId: number | null }
export interface NamedInput { id: number; name: string }

export interface DayLabour {
  labourCostTotal: number;
  lineLabour: Record<string, number>;
  paidHours: number;
  headcount: number;
  pendingShifts: number;
  ignoredUnapproved: number;
}

// ── Dates ─────────────────────────────────────────────────────────────────

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the date's week (YYYY-MM-DD) — the key for weekly figures. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  return addDaysIso(date, -dow);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** First production day on or after `date`; null if none is planned yet. */
export function nextProductionDay(date: string, sortedPlanDates: string[]): string | null {
  let lo = 0, hi = sortedPlanDates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedPlanDates[mid] < date) lo = mid + 1; else hi = mid;
  }
  return lo < sortedPlanDates.length ? sortedPlanDates[lo] : null;
}

/** Saturday, Sunday or a listed non-dispatch day (bank holiday, shutdown). */
export function isRestDay(date: string, nonDispatchDays: ReadonlySet<string>): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 || nonDispatchDays.has(date);
}

/** The production day a shift on `date` counts towards: that day if it has
 *  a plan; otherwise the next production day, provided every day in between
 *  is a rest day; otherwise none. */
export function productionDayFor(date: string, sortedPlanDates: string[], nonDispatchDays: ReadonlySet<string>): string | null {
  const next = nextProductionDay(date, sortedPlanDates);
  if (!next || next === date) return next;
  for (let d = date; d < next; d = addDaysIso(d, 1)) {
    if (!isRestDay(d, nonDispatchDays)) return null;
  }
  return next;
}

// ── On-costs ──────────────────────────────────────────────────────────────

/** On-cost multiplier per week (keyed by weekStart). NI is worked out on each
 *  person's whole week — every paid shift, productive or not — because the
 *  threshold applies to all their pay. */
export function weeklyOnCostMultipliers(rows: PayrollRowInput[], s: OnCostSettings): Map<string, number> {
  const byWeek = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const wk = weekStart(r.date.slice(0, 10));
    const people = byWeek.get(wk) ?? new Map<number, number>();
    people.set(r.employeeId, (people.get(r.employeeId) ?? 0) + shiftPay(r));
    byWeek.set(wk, people);
  }
  const out = new Map<string, number>();
  for (const [wk, people] of byWeek) {
    const ni = effectiveNiRate([...people.values()], 1, s);
    out.set(wk, onCostMultiplier(ni, s));
  }
  return out;
}

// ── Labour per production day ─────────────────────────────────────────────

export interface LabourInputs {
  payroll: PayrollRowInput[];
  rota: RotaShiftInput[];
  positions: PositionInput[];
  shiftTypes: NamedInput[];
  /** Fallback shift types by shift id (the Planday mirror), for payroll rows
   *  the rota fetch didn't return. */
  shiftTypeByShiftId?: Map<number, number | null>;
  productionSectionId: number;
  sortedPlanDates: string[];
  /** Bank holidays / shutdowns (app setting non_dispatch_dates). */
  nonDispatchDays: ReadonlySet<string>;
  /** Line-only position names by category (matched case-insensitively). */
  linePositions: Record<string, string[]>;
  multipliers: Map<string, number>;
  /** Multiplier used for a week with no payroll rows (shouldn't happen). */
  fallbackMultiplier: number;
  today: string;
  staleAfterDays: number;
}

export function labourByProductionDay(inp: LabourInputs): Map<string, DayLabour> {
  const posById = new Map(inp.positions.map(p => [p.id, p]));
  const typeName = new Map(inp.shiftTypes.map(t => [t.id, t.name]));
  const rotaById = new Map(inp.rota.map(s => [s.id, s]));
  const lineOf = new Map<string, string>();
  for (const [cat, names] of Object.entries(inp.linePositions)) {
    for (const n of names) lineOf.set(n.trim().toLowerCase(), cat);
  }

  const out = new Map<string, DayLabour & { heads: Set<number> }>();
  const day = (d: string) => {
    let x = out.get(d);
    if (!x) {
      x = { labourCostTotal: 0, lineLabour: {}, paidHours: 0, headcount: 0, pendingShifts: 0, ignoredUnapproved: 0, heads: new Set() };
      out.set(d, x);
    }
    return x;
  };

  const productive = (positionId: number | null, shiftTypeId: number | null | undefined) => {
    const pos = positionId != null ? posById.get(positionId) : undefined;
    const tName = shiftTypeId != null ? typeName.get(shiftTypeId) : null;
    return isProductiveShift(pos?.sectionId ?? null, inp.productionSectionId, tName ?? null);
  };

  for (const r of inp.payroll) {
    const date = r.date.slice(0, 10);
    const rota = rotaById.get(r.id);
    const shiftTypeId = rota?.shiftTypeId ?? inp.shiftTypeByShiftId?.get(r.id) ?? null;
    if (!productive(r.positionId, shiftTypeId)) continue;
    const target = productionDayFor(date, inp.sortedPlanDates, inp.nonDispatchDays);
    if (!target) continue;
    const mult = inp.multipliers.get(weekStart(date)) ?? inp.fallbackMultiplier;
    const cost = shiftPay(r) * mult;
    const d = day(target);
    d.labourCostTotal += cost;
    d.paidHours += shiftPaidHours(r);
    d.heads.add(r.employeeId);
    const posName = r.positionId != null ? posById.get(r.positionId)?.name : undefined;
    const line = posName ? lineOf.get(posName.trim().toLowerCase()) : undefined;
    if (line) d.lineLabour[line] = (d.lineLabour[line] ?? 0) + cost;
  }

  // Rota shifts not approved yet hold their production day back.
  for (const s of inp.rota) {
    if (s.employeeId == null) continue; // open shift — nobody to pay
    if ((s.status ?? "").toLowerCase() === "approved") continue;
    if (!productive(s.positionId, s.shiftTypeId)) continue;
    const date = s.date.slice(0, 10);
    const target = productionDayFor(date, inp.sortedPlanDates, inp.nonDispatchDays);
    if (!target) continue;
    const d = day(target);
    if (daysBetween(target, inp.today) > inp.staleAfterDays) d.ignoredUnapproved += 1;
    else d.pendingShifts += 1;
  }

  const result = new Map<string, DayLabour>();
  for (const [d, x] of out) {
    const { heads, ...rest } = x;
    result.set(d, { ...rest, headcount: heads.size });
  }
  return result;
}
