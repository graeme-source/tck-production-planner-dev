/**
 * Hours worked vs contracted hours — pure rules, no I/O (Objective I: the
 * founder sees at a glance who works under or over their contract; F: the
 * numbers come straight from approved Planday shifts, so they can be
 * trusted). Graeme, 2026-09-25, after an analysis of one person's shifts:
 * "I would like this turned into a report on the people record, and we can
 * also then compare it to their contracted hours, so I can see if people are
 * working under or over."
 *
 *   - A shift's paid hours = end − start − unpaid breaks (shiftPaidHours;
 *     approved start/end already reflect the punch clock).
 *   - Shifts whose Planday shift type is holiday, sickness or another
 *     absence reason are NOT hours worked.
 *   - Weeks run Monday–Sunday on the shift's London date (Planday's `date`).
 *   - A week holding any holiday, sickness or absence day is marked and left
 *     out of the weekly average, so a short week is explained rather than
 *     counted as "under". So are part weeks (the range edges, the week in
 *     progress, the week they started) and weeks before they started.
 *   - Everyone has a contracted MINIMUM and is paid for every hour worked,
 *     so the comparison is average paid hours per counted week − contract.
 *
 * Hours only: nothing here takes or returns pay.
 */
import { shiftPaidHours, median, type PlandayPayrollBreak } from "./team-efficiency";
import { addDaysIso, weekStart } from "./team-efficiency-labour";
import { isAbsenceReasonName, isSickName } from "../services/attendance-classify";

// ── Leave ─────────────────────────────────────────────────────────────────

export type LeaveKind = "holiday" | "sickness" | "absence";

/** Planday shift types that mean the person was OFF, not working. Training,
 *  Meeting and "Arrived late" are worked time. */
export function leaveKindForShiftType(name: string | null | undefined): LeaveKind | null {
  if (!name) return null;
  if (isSickName(name)) return "sickness";
  if (/holiday/i.test(name)) return "holiday";
  if (isAbsenceReasonName(name)) return "absence";
  return null;
}

/** Planday absence ACCOUNTS are holiday accruals ("Standard Hourly
 *  Accrual", "Fixed Full Time"…) unless their name says sickness or another
 *  absence reason. */
export function leaveKindForAbsenceAccount(name: string | null | undefined): LeaveKind {
  if (name && isSickName(name)) return "sickness";
  if (name && isAbsenceReasonName(name)) return "absence";
  return "holiday";
}

// ── Shifts ────────────────────────────────────────────────────────────────

/** The fields of a Planday payroll row this report reads. Anything else on
 *  the row (salary, wage) is ignored and never copied. */
export interface PayrollHoursSource {
  id: number;
  employeeId: number;
  /** London date, "YYYY-MM-DD". */
  date: string;
  /** London local time, "YYYY-MM-DDTHH:MM:SS". */
  start: string;
  end: string;
  breaks?: PlandayPayrollBreak[] | null;
}

/** One approved shift, hours only. */
export interface HoursShift {
  id: number;
  employeeId: number;
  date: string;
  /** "HH:MM" London. */
  start: string;
  end: string;
  /** end − start. */
  clockHours: number;
  /** end − start − unpaid breaks. */
  paidHours: number;
}

function timeOfDay(ts: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(ts);
  return m ? `${m[1]}:${m[2]}` : "";
}

/** Strip a payroll row to hours. Pay never leaves this function. */
export function toHoursShift(r: PayrollHoursSource): HoursShift {
  const breaks = r.breaks ?? [];
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.date.slice(0, 10),
    start: timeOfDay(r.start),
    end: timeOfDay(r.end),
    clockHours: shiftPaidHours({ salary: 0, start: r.start, end: r.end, breaks: [] }),
    paidHours: shiftPaidHours({ salary: 0, start: r.start, end: r.end, breaks }),
  };
}

export interface ClassifiedHoursShift extends HoursShift {
  /** Set when the shift's type is holiday/sickness/absence — not worked. */
  leave: LeaveKind | null;
}

export interface LeaveDay { date: string; kind: LeaveKind }

/**
 * Sort one department's payroll rows and leave into per-employee buckets.
 * Shift types come from the rota (payroll rows don't carry them), matched on
 * shift id; a shift the rota mirror hasn't seen yet counts as worked.
 * Leave days come from leave-typed rota shifts (paid or not — an unpaid
 * "Sick Leave" shift never reaches payroll) and APPROVED absence records.
 */
export function classifyForEmployees(input: {
  payroll: HoursShift[];
  rota: ReadonlyArray<{ id: number; employeeId: number | null; date: string; shiftTypeId: number | null }>;
  shiftTypeNames: ReadonlyMap<number, string>;
  absences: ReadonlyArray<{
    employeeId: number | null;
    status?: string | null;
    registrations?: ReadonlyArray<{ date?: string | null; account?: { id?: number | null } | null }> | null;
  }>;
  absenceAccountNames: ReadonlyMap<number, string>;
}): Map<number, { shifts: ClassifiedHoursShift[]; leaveDays: LeaveDay[] }> {
  const out = new Map<number, { shifts: ClassifiedHoursShift[]; leaveDays: LeaveDay[] }>();
  const bucket = (employeeId: number) => {
    let b = out.get(employeeId);
    if (!b) { b = { shifts: [], leaveDays: [] }; out.set(employeeId, b); }
    return b;
  };
  const typeOfShift = new Map<number, number | null>();
  for (const s of input.rota) {
    typeOfShift.set(s.id, s.shiftTypeId);
    if (s.employeeId == null || s.shiftTypeId == null) continue;
    const kind = leaveKindForShiftType(input.shiftTypeNames.get(s.shiftTypeId));
    if (kind) bucket(s.employeeId).leaveDays.push({ date: s.date.slice(0, 10), kind });
  }
  for (const p of input.payroll) {
    const typeId = typeOfShift.get(p.id) ?? null;
    const leave = typeId != null ? leaveKindForShiftType(input.shiftTypeNames.get(typeId)) : null;
    bucket(p.employeeId).shifts.push({ ...p, leave });
    if (leave) bucket(p.employeeId).leaveDays.push({ date: p.date, kind: leave });
  }
  for (const a of input.absences) {
    if (a.employeeId == null || a.status !== "Approved") continue;
    for (const reg of a.registrations ?? []) {
      const date = (reg.date ?? "").slice(0, 10);
      if (!date) continue;
      const accountId = reg.account?.id;
      const kind = leaveKindForAbsenceAccount(accountId != null ? input.absenceAccountNames.get(accountId) : null);
      bucket(a.employeeId).leaveDays.push({ date, kind });
    }
  }
  return out;
}

// ── The report ────────────────────────────────────────────────────────────

/** Within this many hours a week of the contract counts as "on contract". */
export const ON_CONTRACT_TOLERANCE_H = 0.5;

export type WeekStatus = "counted" | "leave" | "part_week" | "in_progress" | "before_start";
export type Standing = "over" | "under" | "on";

export interface WeekHours {
  weekStart: string;
  weekEnd: string;
  paidHours: number;
  shifts: number;
  /** Distinct days of each kind in the week. */
  leaveDays: Record<LeaveKind, number>;
  status: WeekStatus;
  /** paidHours − contract, for counted weeks with a contract; else null. */
  vsContract: number | null;
}

export interface WeekdayHours {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  shifts: number;
  avgPaidHours: number | null;
  avgClockHours: number | null;
  typicalStart: string | null;
  typicalFinish: string | null;
}

export interface HoursReport {
  from: string;
  to: string;
  /** Worked shifts in the range. */
  shifts: number;
  /** Leave-typed shifts in payroll, left out of every figure. */
  leaveShifts: number;
  totalPaidHours: number;
  totalClockHours: number;
  avgClockHours: number | null;
  avgPaidHours: number | null;
  /** Median start and finish ("HH:MM", nearest 5 min) of worked shifts. */
  typicalStart: string | null;
  typicalFinish: string | null;
  weeks: WeekHours[];
  countedWeeks: number;
  leaveWeeks: number;
  /** Part weeks, the week in progress and weeks before they started. */
  otherExcludedWeeks: number;
  /** Average paid hours over COUNTED weeks only; null with no shifts at all. */
  avgPaidPerWeek: number | null;
  contractedHours: number | null;
  /** avgPaidPerWeek − contractedHours. */
  difference: number | null;
  standing: Standing | null;
  weekdays: WeekdayHours[];
}

export interface HoursReportInput {
  from: string;
  to: string;
  /** London today — the week holding it is still in progress. */
  today: string;
  shifts: ClassifiedHoursShift[];
  leaveDays: LeaveDay[];
  /** Employment start; weeks before it aren't theirs to count. */
  startedOn: string | null;
  contractedHours: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Averages keep a little more, so 9.158 h still reads as 9h 09m. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hhmm(minutes: number | null): string | null {
  if (minutes == null) return null;
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Typical times are rounded to the nearest 5 minutes — "about 05:15". */
export const TYPICAL_TIME_ROUNDING_MIN = 5;

/** Median time of day of a list of "HH:MM" strings, to the nearest 5 minutes. */
export function typicalTime(times: string[]): string | null {
  const m = median(times.map(minutesOf).filter((n): n is number => n != null));
  return hhmm(m == null ? null : Math.round(m / TYPICAL_TIME_ROUNDING_MIN) * TYPICAL_TIME_ROUNDING_MIN);
}

/** 1 = Monday … 7 = Sunday, from a "YYYY-MM-DD" date. */
export function isoWeekday(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function standingFor(difference: number | null): Standing | null {
  if (difference == null) return null;
  if (Math.abs(difference) < ON_CONTRACT_TOLERANCE_H) return "on";
  return difference > 0 ? "over" : "under";
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildHoursReport(input: HoursReportInput): HoursReport {
  const { from, to, today, startedOn, contractedHours } = input;
  const inRange = input.shifts.filter(s => s.date >= from && s.date <= to);
  const worked = inRange.filter(s => s.leave == null);
  const leaveShifts = inRange.length - worked.length;

  // Weeks, Monday to Sunday, covering the range.
  const weeks: WeekHours[] = [];
  const effectiveFrom = startedOn && startedOn > from ? startedOn : from;
  for (let ws = weekStart(from); ws <= to; ws = addDaysIso(ws, 7)) {
    const we = addDaysIso(ws, 6);
    const own = worked.filter(s => s.date >= ws && s.date <= we);
    const leaveDays: Record<LeaveKind, number> = { holiday: 0, sickness: 0, absence: 0 };
    for (const kind of Object.keys(leaveDays) as LeaveKind[]) {
      leaveDays[kind] = new Set(input.leaveDays.filter(l => l.kind === kind && l.date >= ws && l.date <= we).map(l => l.date)).size;
    }
    const anyLeave = leaveDays.holiday + leaveDays.sickness + leaveDays.absence > 0;
    let status: WeekStatus;
    if (startedOn && we < startedOn) status = "before_start";
    else if (we >= today) status = "in_progress";
    else if (ws < effectiveFrom || we > to) status = "part_week";
    else if (anyLeave) status = "leave";
    else status = "counted";
    const paidHours = own.reduce((n, s) => n + s.paidHours, 0);
    weeks.push({
      weekStart: ws,
      weekEnd: we,
      paidHours: round2(paidHours),
      shifts: own.length,
      leaveDays,
      status,
      vsContract: status === "counted" && contractedHours != null ? round2(paidHours - contractedHours) : null,
    });
  }

  const counted = weeks.filter(w => w.status === "counted");
  // Nobody on the rota at all in the range (the founder, a salaried
  // manager, someone not started yet) has no weekly average — not "0 h".
  const avgPerWeek = worked.length === 0 ? null : mean(counted.map(w => w.paidHours));
  const difference = avgPerWeek != null && contractedHours != null ? round3(avgPerWeek - contractedHours) : null;

  const weekdays: WeekdayHours[] = [];
  for (let d = 1; d <= 7; d++) {
    const day = worked.filter(s => isoWeekday(s.date) === d);
    const paid = mean(day.map(s => s.paidHours));
    const clock = mean(day.map(s => s.clockHours));
    weekdays.push({
      weekday: d,
      shifts: day.length,
      avgPaidHours: paid == null ? null : round3(paid),
      avgClockHours: clock == null ? null : round3(clock),
      typicalStart: typicalTime(day.map(s => s.start)),
      typicalFinish: typicalTime(day.map(s => s.end)),
    });
  }

  const totalPaid = worked.reduce((n, s) => n + s.paidHours, 0);
  const totalClock = worked.reduce((n, s) => n + s.clockHours, 0);
  return {
    from,
    to,
    shifts: worked.length,
    leaveShifts,
    totalPaidHours: round2(totalPaid),
    totalClockHours: round2(totalClock),
    avgClockHours: worked.length ? round3(totalClock / worked.length) : null,
    avgPaidHours: worked.length ? round3(totalPaid / worked.length) : null,
    typicalStart: typicalTime(worked.map(s => s.start)),
    typicalFinish: typicalTime(worked.map(s => s.end)),
    weeks,
    countedWeeks: counted.length,
    leaveWeeks: weeks.filter(w => w.status === "leave").length,
    otherExcludedWeeks: weeks.filter(w => w.status !== "counted" && w.status !== "leave").length,
    avgPaidPerWeek: avgPerWeek == null ? null : round3(avgPerWeek),
    contractedHours,
    difference,
    standing: standingFor(difference),
    weekdays,
  };
}

// ── Team overview ─────────────────────────────────────────────────────────

export interface TeamSortable {
  name: string;
  avgPaidPerWeek: number | null;
  difference: number | null;
}

/** Biggest gap from contract first (under or over), then people with hours
 *  but no contract on file (most hours first), then everyone else by name. */
export function sortTeamRows<T extends TeamSortable>(rows: readonly T[]): T[] {
  const group = (r: T) => (r.difference != null ? 0 : r.avgPaidPerWeek != null ? 1 : 2);
  return [...rows].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (group(a) === 0) return Math.abs(b.difference!) - Math.abs(a.difference!) || a.name.localeCompare(b.name);
    if (group(a) === 1) return b.avgPaidPerWeek! - a.avgPaidPerWeek! || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

// ── The range asked for ───────────────────────────────────────────────────

/** Longest range one request may ask for (a year and a bit). */
export const MAX_RANGE_DAYS = 400;
/** Default: this week plus the 12 before it (about 3 months). */
export const DEFAULT_WEEKS = 13;

/** Resolve ?from/?to: defaults to the last 13 weeks, never runs past today,
 *  and refuses a backwards or over-long range. */
export function resolveHoursRange(
  q: { from?: string; to?: string },
  today: string,
): { from: string; to: string } | { error: string } {
  const to = q.to && q.to < today ? q.to : today;
  const from = q.from ?? addDaysIso(weekStart(today), -7 * (DEFAULT_WEEKS - 1));
  if (from > to) return { error: "The start date is after the end date." };
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: `Pick a range of ${MAX_RANGE_DAYS} days or fewer.` };
  return { from, to };
}

// ── Payroll windows ───────────────────────────────────────────────────────

/** Planday payroll is asked for in 28-day blocks aligned to a fixed Monday,
 *  so every range (4 weeks, 3 months, a custom one) shares the same cached
 *  blocks instead of each range fetching its own overlapping windows. */
export const PAYROLL_BLOCK_DAYS = 28;
const BLOCK_EPOCH = "2020-01-06"; // a Monday

export function payrollBlocks(from: string, to: string): Array<{ from: string; to: string }> {
  const dayIndex = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${BLOCK_EPOCH}T00:00:00Z`)) / 86_400_000);
  const first = Math.floor(dayIndex(from) / PAYROLL_BLOCK_DAYS);
  const last = Math.floor(dayIndex(to) / PAYROLL_BLOCK_DAYS);
  const out: Array<{ from: string; to: string }> = [];
  for (let i = first; i <= last; i++) {
    const start = addDaysIso(BLOCK_EPOCH, i * PAYROLL_BLOCK_DAYS);
    out.push({ from: start, to: addDaysIso(start, PAYROLL_BLOCK_DAYS - 1) });
  }
  return out;
}
