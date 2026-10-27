/**
 * Gathers the monthly payroll report's inputs — Planday (read-only GETs)
 * and app_users — and hands them to assemblePayroll (report-data.ts, pure
 * and tested). Objective I.
 *
 * READ-ONLY by design: every Planday call here is a GET, and the database
 * is only SELECTed from.
 *
 * Throws when Planday isn't configured or the payroll call fails — a payroll
 * report built on missing shifts would under-pay people, so it must never
 * quietly show an empty month.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  isPlandayConfigured, getPlandayPayrollRows, getPlandayEmployees, getPlandayAbsenceRecords,
  getPlandayAbsenceAccounts, getPlandayContractRules, getPlandayShiftTypes, getPlandayPositions, getPlandaySections,
  plandayRead, plandayReadAll,
} from "../../services/planday";
import { getAttendanceFromCache } from "../../services/planday-attendance-cache";
import { isSickName } from "../../services/attendance-classify";
import { getContractRuleFacts } from "../../services/planday-employment";
import { payPeriodLabel } from "./period";
import { addDaysIso, linkedRunStart } from "./ssp";
import {
  assemblePayroll, sickDatesByEmployee, type PayrollData, type PayrollAppUserInput, type PayrollContractInput,
  type PayrollEmployeeInput, type PayrollShiftInput,
} from "./report-data";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** getPlandayPayrollRows wants windows of ≤ 28 days; a pay period is up
 *  to 31, so ask in 14-day chunks. Any failed chunk fails the whole load. */
async function payrollRowsFor(from: string, to: string): Promise<PayrollShiftInput[]> {
  const out: PayrollShiftInput[] = [];
  for (let start = from; start <= to; start = addDays(start, 14)) {
    const end = addDays(start, 13) < to ? addDays(start, 13) : to;
    const rows = await getPlandayPayrollRows(start, end);
    if (rows == null) throw new Error(`Couldn't get payroll from Planday for ${start} to ${end}.`);
    out.push(...rows);
  }
  return out;
}

/** Deactivated employees; null when Planday didn't answer (so the report
 *  says leavers couldn't be checked, rather than "no leavers"). */
async function deactivatedEmployees(): Promise<PayrollEmployeeInput[] | null> {
  const probe = await plandayRead<{ data?: PayrollEmployeeInput[] }>(`/hr/v1.0/employees/deactivated?limit=1&offset=0`);
  if (!probe?.data) return null;
  return plandayReadAll<PayrollEmployeeInput>(`/hr/v1.0/employees/deactivated`);
}

interface AppUserRow extends Record<string, unknown> {
  id: number;
  name: string;
  planday_employee_id: number | null;
  is_active: boolean;
  issued_hours: string | null;
  issued_at: string | null;
}

/** App users linked to Planday, with their latest issued contract's weekly
 *  hours — the same query shape as routes/people-hours.ts. Never pay. */
async function appUsers(): Promise<PayrollAppUserInput[]> {
  const rows = await db.execute<AppUserRow>(sql`
    SELECT u.id, u.name, u.planday_employee_id, u.is_active,
           c.weekly_hours AS issued_hours, c.issued_at::date::text AS issued_at
      FROM app_users u
      LEFT JOIN LATERAL (
        SELECT weekly_hours, issued_at FROM employment_contracts ec
         WHERE ec.user_id = u.id ORDER BY ec.issued_at DESC LIMIT 1
      ) c ON TRUE
     WHERE u.planday_employee_id IS NOT NULL
  `);
  const uploaded = new Map<number, PayrollAppUserInput["uploaded"]>();
  const ids = rows.rows.map(r => Number(r.id));
  if (ids.length > 0) {
    try {
      const up = await db.execute<{ user_id: number; confirmed: string | null; extracted: string | null; issue_date: string | null }>(sql`
        SELECT DISTINCT ON (user_id) user_id,
               prefill->>'weeklyHours' AS confirmed,
               extraction->'fields'->'weeklyHours'->>'value' AS extracted,
               original_issue_date::text AS issue_date
          FROM uploaded_contracts
         WHERE user_id IN (${sql.join(ids.map(i => sql`${i}`), sql`, `)})
           AND (NULLIF(btrim(prefill->>'weeklyHours'), '') IS NOT NULL
                OR NULLIF(btrim(extraction->'fields'->'weeklyHours'->>'value'), '') IS NOT NULL)
         ORDER BY user_id, COALESCE(original_issue_date, uploaded_at::date) DESC, uploaded_at DESC
      `);
      for (const r of up.rows) {
        uploaded.set(Number(r.user_id), { confirmedHours: r.confirmed, extractedHours: r.extracted, issueDate: r.issue_date });
      }
    } catch (err) {
      console.warn("[payroll] uploaded contract hours unavailable:", err instanceof Error ? err.message : err);
    }
  }
  return rows.rows.map(r => ({
    id: Number(r.id),
    name: r.name,
    plandayEmployeeId: r.planday_employee_id == null ? null : Number(r.planday_employee_id),
    isActive: Boolean(r.is_active),
    issuedWeeklyHours: r.issued_hours,
    issuedAt: r.issued_at,
    uploaded: uploaded.get(Number(r.id)) ?? null,
  }));
}

/** Contract rules, four Planday asks at a time (Planday allows ~20/s). */
async function contractsFor(plandayIds: number[]): Promise<PayrollContractInput[]> {
  const descriptions = new Map((await getPlandayContractRules()).map(r => [r.name, r.description ?? null]));
  const out: PayrollContractInput[] = [];
  const queue = [...new Set(plandayIds)];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      const f = await getContractRuleFacts(id);
      out.push(f.status === "ok"
        ? { plandayEmployeeId: id, status: "ok", rule: f.contractRule, ruleDescription: f.contractRule ? descriptions.get(f.contractRule) ?? null : null }
        : { plandayEmployeeId: id, status: f.status, rule: null });
    }
  }));
  return out;
}

export async function loadPayrollData(from: string, to: string): Promise<PayrollData> {
  if (!isPlandayConfigured()) throw new Error("Planday isn't connected, so there's no payroll to show.");

  const [payrollRows, employees, deactivated, absenceRecords, absenceAccounts, users, attendance, shiftTypes, positions, sections] = await Promise.all([
    payrollRowsFor(from, to),
    getPlandayEmployees(),
    deactivatedEmployees(),
    getPlandayAbsenceRecords(from, to),
    getPlandayAbsenceAccounts(),
    appUsers(),
    // Rota shifts with their types: a sick day is often a shift re-typed
    // "Sick" rather than an absence. The mirror serves stale if Planday's down.
    getAttendanceFromCache(from, to),
    getPlandayShiftTypes(),
    // Which positions sit outside the Production section — office work,
    // below the line (Graeme, 2026-10-27).
    getPlandayPositions(),
    getPlandaySections(),
  ]);

  // Contract rules for everyone the report mentions: paid, sick, or linked.
  const ids = new Set<number>();
  for (const r of payrollRows) ids.add(r.employeeId);
  for (const a of absenceRecords) ids.add(a.employeeId);
  const sickTypes = new Set(shiftTypes.filter(t => isSickName(t.name)).map(t => t.id));
  for (const s of attendance.shifts) if (s.employeeId != null && s.shiftTypeId != null && sickTypes.has(s.shiftTypeId)) ids.add(s.employeeId);
  for (const u of users) if (u.isActive && u.plandayEmployeeId != null) ids.add(u.plandayEmployeeId);
  const contracts = await contractsFor([...ids]);

  // SSP estimate: sickness over the 26 weeks before (linked spells, the
  // 28-week limit) and — only if anyone was off sick — pay for the 8 weeks
  // before each spell began (average weekly earnings).
  const history = await sspHistory(from, absenceRecords, absenceAccounts, attendance.shifts, shiftTypes);

  return assemblePayroll({
    period: { from, to, label: payPeriodLabel(from, to) },
    payrollRows,
    employees,
    deactivatedEmployees: deactivated,
    absenceRecords,
    absenceAccounts,
    rotaShifts: attendance.shifts,
    shiftTypes,
    listLeavers: false,
    contracts,
    appUsers: users,
    positions,
    sections,
    history,
  });
}

const SSP_LOOKBACK_DAYS = 182;

async function sspHistory(
  from: string,
  periodAbsences: Awaited<ReturnType<typeof getPlandayAbsenceRecords>>,
  accounts: Array<{ id: number; name: string }>,
  periodShifts: Awaited<ReturnType<typeof getAttendanceFromCache>>["shifts"],
  shiftTypes: Array<{ id: number; name: string }>,
): Promise<NonNullable<Parameters<typeof assemblePayroll>[0]["history"]>> {
  const lookFrom = addDaysIso(from, -SSP_LOOKBACK_DAYS);
  const dayBefore = addDaysIso(from, -1);
  const accountName = new Map(accounts.map(a => [a.id, a.name]));
  const typeName = new Map(shiftTypes.map(t => [t.id, t.name]));
  const sickNow = sickDatesByEmployee(periodAbsences, accountName, periodShifts, typeName, from, "9999-12-31");
  if (sickNow.size === 0) return { from: lookFrom, payrollRows: [], absenceRecords: [], rotaShifts: [] };

  const [absenceRecords, attendance] = await Promise.all([
    getPlandayAbsenceRecords(lookFrom, dayBefore),
    getAttendanceFromCache(lookFrom, dayBefore),
  ]);
  const earlier = sickDatesByEmployee(absenceRecords, accountName, attendance.shifts, typeName, lookFrom, dayBefore);
  // Pay back to 8 weeks before the earliest spell any sick person's run began.
  let earliest = from;
  for (const [id, dates] of sickNow) {
    const all = [...(earlier.get(id) ?? []), ...dates];
    for (const d of dates) { const start = linkedRunStart(all, d); if (start < earliest) earliest = start; }
  }
  const payFrom = addDaysIso(earliest, -56);
  const payrollRows = payFrom <= dayBefore ? await payrollRowsFor(payFrom, dayBefore) : [];
  return { from: lookFrom, payrollRows, absenceRecords, rotaShifts: attendance.shifts };
}
