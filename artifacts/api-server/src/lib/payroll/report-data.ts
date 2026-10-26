/**
 * Monthly payroll report — the Planday half, assembled. PURE: no database,
 * no Planday calls; lib/payroll/load.ts gathers the inputs (Objective I:
 * people are paid right, and the accountant gets every fact in one place).
 *
 * Rules, in one place:
 *
 *   HOURS AND PAY — per shift via payrollTotals (lib/planday-payroll.ts):
 *     paid hours = end − start − unpaid breaks; pay = Planday's salary plus
 *     the (negative) unpaid-break amounts = paid hours × rate. Approved
 *     shifts only (load.ts asks for shiftStatus=Approved). Rows are deduped
 *     by shift id and kept to dates inside the period.
 *   HOURLY vs SALARIED — from each shift's wage.type: /hour/i is hourly,
 *     /salary|month/i is salaried, anything else (e.g. a per-shift wage) is
 *     neither and gets a warning. hourlyRate is the rate on their latest
 *     hourly shift; a rate change inside the period is warned about.
 *   SICKNESS — absence records that aren't "Declined", one SickDay per
 *     registration dated inside the period whose ABSENCE ACCOUNT NAME
 *     contains "sick" (case-insensitive — "Sick", "Sick Unpaid", "Sick -
 *     paid"; the shared isSickName rule). Pending records count (sickness
 *     gets recorded before it's approved) but are warned about. ALSO rota
 *     shifts whose SHIFT TYPE name contains "sick" — the team often marks a
 *     sick day by changing the shift's type rather than raising an absence
 *     (Tommy, Oct 2026, was missed). One day per person per date either way;
 *     a shift's hours are its rota length when it has times.
 *   JOINERS — Planday hire date (hiredFrom, or hiredDate as the list
 *     endpoint names it) inside the period, active or deactivated.
 *   LEAVERS — deactivated Planday employees whose deactivation date is
 *     inside the period. The date is read from the first of
 *     LEAVER_DATE_FIELDS present; Planday's field name is unverified, so a
 *     deactivated employee with none of them is warned about, not dropped
 *     silently.
 *   CONTRACTED HOURS — chooseContractedHours (lib/contracted-hours.ts), the
 *     same source order as "Hours vs contract": issued in-app contract →
 *     Planday contract rule → uploaded old contract.
 *   CONTRACTED DAYS — nothing in the app records days a week, so it's read
 *     off the Planday contract rule's name or description when it states
 *     one ("5 days, 41.25 hours"); otherwise null.
 */
import { payrollTotals } from "../planday-payroll";
import { chooseContractedHours, type ContractHoursCandidates } from "../contracted-hours";
import { isSickName } from "../../services/attendance-classify";
import type { PlandayPayrollBreak } from "../team-efficiency";
import type { PayPeriod } from "./period";

// ── Output ────────────────────────────────────────────────────────────────

export interface PayrollPerson {
  plandayEmployeeId: number;
  appUserId: number | null;
  name: string;
  hours: number;
  shifts: number;
  hourlyRate: number | null;
  salaried: boolean;
  grossPay: number;
  contractHoursPerWeek: number | null;
  contractDaysPerWeek: number | null;
}

export interface SickDay {
  plandayEmployeeId: number;
  name: string;
  date: string;
  hours: number | null;
  contractHoursPerWeek: number | null;
  contractDaysPerWeek: number | null;
}

export interface StaffChange {
  plandayEmployeeId: number;
  appUserId: number | null;
  name: string;
  date: string;
}

export interface PayrollData {
  period: { from: string; to: string; label: string };
  people: PayrollPerson[];
  sick: SickDay[];
  joiners: StaffChange[];
  leavers: StaffChange[];
  totals: { hours: number; grossPay: number };
  warnings: string[];
}

// ── Input ─────────────────────────────────────────────────────────────────

/** One approved shift from /payroll/v1.0/payroll (PlandayShiftPayroll). */
export interface PayrollShiftInput {
  id: number;
  employeeId: number;
  date: string;
  start: string;
  end: string;
  salary: number;
  breaks?: PlandayPayrollBreak[] | null;
  wage?: { rate?: number | null; type?: string | null } | null;
}

/** A Planday HR employee, active or deactivated. Date fields are optional
 *  because Planday leaves them off when unset. */
export interface PayrollEmployeeInput {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  hiredFrom?: string | null;
  hiredDate?: string | null;
  deactivationDate?: string | null;
  dateTimeDeactivated?: string | null;
  deactivatedDate?: string | null;
  terminationDate?: string | null;
  endDate?: string | null;
}

/** Fields that may carry a deactivated employee's leaving date, in order. */
export const LEAVER_DATE_FIELDS = [
  "deactivationDate", "dateTimeDeactivated", "deactivatedDate", "terminationDate", "endDate",
] as const;

export interface PayrollAbsenceRecordInput {
  id: number;
  employeeId: number;
  status: string;
  registrations?: Array<{ date?: string | null; account?: { id?: number | null } | null; hours?: number | null }> | null;
}

/** A person's Planday contract rule, as services/planday-employment.ts
 *  reports it. Absent = not asked (e.g. not linked). */
export interface PayrollContractInput {
  plandayEmployeeId: number;
  status: "ok" | "unreachable" | "not_configured";
  rule: string | null;
  ruleDescription?: string | null;
}

export interface PayrollAppUserInput {
  id: number;
  name: string;
  plandayEmployeeId: number | null;
  isActive: boolean;
  /** Latest issued in-app contract's weekly hours text. */
  issuedWeeklyHours: string | null;
  issuedAt: string | null;
  /** Latest uploaded old contract with hours. */
  uploaded: ContractHoursCandidates["uploaded"];
}

export interface PayrollInput {
  period: PayPeriod;
  payrollRows: PayrollShiftInput[];
  /** Active Planday employees. */
  employees: PayrollEmployeeInput[];
  /** Deactivated Planday employees; null when they couldn't be fetched. */
  deactivatedEmployees: PayrollEmployeeInput[] | null;
  absenceRecords: PayrollAbsenceRecordInput[];
  absenceAccounts: Array<{ id: number; name: string }>;
  /** Rota shifts for the period (any status) and Planday's shift types —
   *  sick-typed shifts are sick days too. Optional: absent = absences only. */
  rotaShifts?: ReadonlyArray<{ id: number; employeeId: number | null; date: string; startDateTime?: string | null; endDateTime?: string | null; shiftTypeId?: number | null }>;
  shiftTypes?: ReadonlyArray<{ id: number; name: string }>;
  /** false = don't look for leavers in Planday (the report's leavers are
   *  added by hand — Planday only marks them after their last payroll). */
  listLeavers?: boolean;
  contracts: PayrollContractInput[];
  appUsers: PayrollAppUserInput[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
const day = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const within = (d: string | null, p: PayPeriod) => d != null && d >= p.from && d <= p.to;

/** "5 days", "4 days a week", "3-day week" → that number; else null. */
export function parseContractDays(...texts: Array<string | null | undefined>): number | null {
  for (const t of texts) {
    if (!t) continue;
    const m = /(\d+(?:\.\d+)?)\s*-?\s*days?\b/i.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n <= 7) return n;
    }
  }
  return null;
}

function wageKind(type: string | null | undefined): "hourly" | "salaried" | "other" {
  const t = type ?? "";
  if (/hour/i.test(t)) return "hourly";
  if (/salary|month/i.test(t)) return "salaried";
  return "other";
}

export function leaverDate(e: PayrollEmployeeInput): string | null {
  for (const f of LEAVER_DATE_FIELDS) {
    const v = day(e[f]);
    if (v) return v;
  }
  return null;
}

// ── Assembly ──────────────────────────────────────────────────────────────

export function assemblePayroll(input: PayrollInput): PayrollData {
  const { period } = input;
  const warnings: string[] = [];

  // Planday id → app user (an active one wins over a deactivated duplicate).
  const userByPd = new Map<number, PayrollAppUserInput>();
  for (const u of input.appUsers) {
    if (u.plandayEmployeeId == null) continue;
    const prev = userByPd.get(u.plandayEmployeeId);
    if (prev) {
      warnings.push(`${prev.name} and ${u.name} are both linked to Planday employee ${u.plandayEmployeeId}.`);
      if (prev.isActive || !u.isActive) continue;
    }
    userByPd.set(u.plandayEmployeeId, u);
  }

  const employeeById = new Map<number, PayrollEmployeeInput>();
  for (const e of input.deactivatedEmployees ?? []) employeeById.set(e.id, e);
  for (const e of input.employees) employeeById.set(e.id, e); // active wins

  const nameOf = (pdId: number): string => {
    const e = employeeById.get(pdId);
    const n = e ? `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() : "";
    return n || userByPd.get(pdId)?.name || `Planday employee ${pdId}`;
  };

  const contractById = new Map(input.contracts.map(c => [c.plandayEmployeeId, c]));
  let unreachableRules = 0;
  const contractFor = (pdId: number) => {
    const u = userByPd.get(pdId);
    const c = contractById.get(pdId);
    if (c?.status === "unreachable") unreachableRules++;
    const chosen = chooseContractedHours({
      issued: u?.issuedWeeklyHours != null ? { weeklyHours: u.issuedWeeklyHours, issuedAt: u.issuedAt } : null,
      planday: !c ? { rule: null, status: "not_linked" } : { rule: c.status === "ok" ? c.rule : null, status: c.status },
      uploaded: u?.uploaded ?? null,
    });
    const days = c?.status === "ok" ? parseContractDays(c.rule, c.ruleDescription) : null;
    return { hours: chosen.hours, days };
  };
  const contractCache = new Map<number, { hours: number | null; days: number | null }>();
  const contractOf = (pdId: number) => {
    let c = contractCache.get(pdId);
    if (!c) { c = contractFor(pdId); contractCache.set(pdId, c); }
    return c;
  };

  // ── People: approved shifts in the period ──
  const seenShift = new Set<number>();
  const rowsByEmployee = new Map<number, PayrollShiftInput[]>();
  let outside = 0;
  for (const r of input.payrollRows) {
    if (seenShift.has(r.id)) continue;
    seenShift.add(r.id);
    if (!within(day(r.date), period)) { outside++; continue; }
    const list = rowsByEmployee.get(r.employeeId) ?? [];
    list.push(r);
    rowsByEmployee.set(r.employeeId, list);
  }
  if (outside > 0) warnings.push(`${outside} shift${outside === 1 ? "" : "s"} dated outside ${period.label} left out.`);

  const people: PayrollPerson[] = [];
  let totalHours = 0;
  let totalPay = 0;
  for (const [pdId, rows] of rowsByEmployee) {
    const name = nameOf(pdId);
    const t = payrollTotals(rows.map(r => ({ ...r, breaks: r.breaks ?? [] })));
    totalHours += t.totalHours;
    totalPay += t.grossWages;

    const sorted = [...rows].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const hourly = sorted.filter(r => wageKind(r.wage?.type) === "hourly");
    const salaried = sorted.some(r => wageKind(r.wage?.type) === "salaried");
    const other = sorted.filter(r => wageKind(r.wage?.type) === "other");
    const rates = [...new Set(hourly.map(r => r.wage?.rate).filter((n): n is number => typeof n === "number"))];
    const hourlyRate = hourly.length ? (hourly[hourly.length - 1].wage?.rate ?? null) : null;
    if (rates.length > 1) {
      warnings.push(`${name}'s hourly rate changed during the period (${rates.map(r => `£${r.toFixed(2)}`).join(", ")}); the latest is shown.`);
    }
    if (other.length > 0) {
      warnings.push(`${name} has ${other.length} shift${other.length === 1 ? "" : "s"} with an unrecognised wage type ("${other[0].wage?.type ?? "none"}").`);
    }
    if (salaried) {
      warnings.push(`${name} is salaried in Planday — check their pay against their salary, not their shifts.`);
    }
    if (!userByPd.has(pdId)) warnings.push(`${name} (Planday ${pdId}) isn't linked to anyone in the app.`);

    const c = contractOf(pdId);
    people.push({
      plandayEmployeeId: pdId,
      appUserId: userByPd.get(pdId)?.id ?? null,
      name,
      hours: round2(t.totalHours),
      shifts: rows.length,
      hourlyRate,
      salaried,
      grossPay: round2(t.grossWages),
      contractHoursPerWeek: c.hours,
      contractDaysPerWeek: c.days,
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));

  // Active, linked people with no approved shift at all — salaried, off
  // all period, or shifts not approved yet. Payroll needs to know.
  // Only people still active in Planday too.
  const activeInPlanday = new Set(input.employees.map(e => e.id));
  for (const u of input.appUsers) {
    if (!u.isActive || u.plandayEmployeeId == null || rowsByEmployee.has(u.plandayEmployeeId)) continue;
    if (userByPd.get(u.plandayEmployeeId) !== u || !activeInPlanday.has(u.plandayEmployeeId)) continue;
    warnings.push(`${u.name} has no approved shifts in Planday for ${period.label} — check for unapproved shifts or a salary.`);
  }

  // ── Sickness ──
  const accountName = new Map(input.absenceAccounts.map(a => [a.id, a.name]));
  const sickKey = new Map<string, SickDay>();
  const pendingSick = new Set<number>();
  const unknownAccounts = new Set<number>();
  for (const rec of input.absenceRecords) {
    if (rec.status === "Declined") continue;
    for (const reg of rec.registrations ?? []) {
      const date = day(reg.date);
      if (!within(date, period)) continue;
      const accId = reg.account?.id;
      const accName = accId != null ? accountName.get(accId) : undefined;
      if (accId != null && accName === undefined) { unknownAccounts.add(accId); continue; }
      if (!isSickName(accName)) continue;
      if (rec.status !== "Approved") pendingSick.add(rec.id);
      const key = `${rec.employeeId}|${date}`;
      const existing = sickKey.get(key);
      const hours = typeof reg.hours === "number" ? reg.hours : null;
      if (existing) {
        if (hours != null) existing.hours = round2((existing.hours ?? 0) + hours);
        continue;
      }
      const c = contractOf(rec.employeeId);
      sickKey.set(key, {
        plandayEmployeeId: rec.employeeId,
        name: nameOf(rec.employeeId),
        date: date!,
        hours,
        contractHoursPerWeek: c.hours,
        contractDaysPerWeek: c.days,
      });
    }
  }
  const shiftTypeName = new Map((input.shiftTypes ?? []).map(t => [t.id, t.name]));
  for (const s of input.rotaShifts ?? []) {
    const date = day(s.date);
    if (s.employeeId == null || s.shiftTypeId == null || !within(date, period)) continue;
    if (!isSickName(shiftTypeName.get(s.shiftTypeId))) continue;
    const key = `${s.employeeId}|${date}`;
    if (sickKey.has(key)) continue;
    const ms = s.startDateTime && s.endDateTime ? Date.parse(s.endDateTime) - Date.parse(s.startDateTime) : NaN;
    const c = contractOf(s.employeeId);
    sickKey.set(key, {
      plandayEmployeeId: s.employeeId,
      name: nameOf(s.employeeId),
      date: date!,
      hours: Number.isFinite(ms) && ms > 0 ? round2(ms / 3_600_000) : null,
      contractHoursPerWeek: c.hours,
      contractDaysPerWeek: c.days,
    });
  }
  const sick = [...sickKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
  if (pendingSick.size > 0) {
    warnings.push(`${pendingSick.size} sickness record${pendingSick.size === 1 ? " is" : "s are"} not approved in Planday yet but are included.`);
  }
  if (unknownAccounts.size > 0) {
    warnings.push(`Absence records use account${unknownAccounts.size === 1 ? "" : "s"} ${[...unknownAccounts].join(", ")} that Planday didn't list — not counted.`);
  }

  // ── Joiners and leavers ──
  const change = (e: PayrollEmployeeInput, date: string): StaffChange => ({
    plandayEmployeeId: e.id, appUserId: userByPd.get(e.id)?.id ?? null, name: nameOf(e.id), date,
  });
  const joiners: StaffChange[] = [];
  let withHireDate = 0;
  for (const e of employeeById.values()) {
    const hired = day(e.hiredFrom) ?? day(e.hiredDate);
    if (hired) withHireDate++;
    if (within(hired, period)) joiners.push(change(e, hired!));
  }
  if (employeeById.size > 0 && withHireDate === 0) {
    warnings.push("Planday gave no hire dates, so joiners can't be listed.");
  }

  const leavers: StaffChange[] = [];
  if (input.listLeavers === false) {
    // Leavers come from the hand-added list instead.
  } else if (input.deactivatedEmployees == null) {
    warnings.push("Couldn't fetch deactivated employees from Planday, so leavers can't be listed.");
  } else {
    const undated: string[] = [];
    for (const e of input.deactivatedEmployees) {
      const left = leaverDate(e);
      if (!left) { undated.push(nameOf(e.id)); continue; }
      if (within(left, period)) leavers.push(change(e, left));
    }
    if (undated.length > 0) {
      warnings.push(`Planday gave no leaving date for ${undated.length} deactivated employee${undated.length === 1 ? "" : "s"} (${undated.slice(0, 5).join(", ")}${undated.length > 5 ? ", …" : ""}) — check leavers by hand.`);
    }
  }
  const byDate = (a: StaffChange, b: StaffChange) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
  joiners.sort(byDate);
  leavers.sort(byDate);

  if (unreachableRules > 0) warnings.push("Couldn't reach Planday for some contract rules — contracted hours may be missing.");

  return {
    period: { from: period.from, to: period.to, label: period.label },
    people,
    sick,
    joiners,
    leavers,
    totals: { hours: round2(totalHours), grossPay: round2(totalPay) },
    warnings,
  };
}
