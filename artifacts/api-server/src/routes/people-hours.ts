/**
 * Hours worked vs contracted hours (Graeme, 2026-09-25; Objective I):
 *
 *   GET /api/people/hours[?from=&to=]           everyone active: average paid
 *                                               hours a week, contracted hours,
 *                                               the difference — who's under or over
 *   GET /api/people/:userId/hours[?from=&to=]   one person's report: average
 *                                               shift, typical start/finish, a
 *                                               weekday table, weekly paid hours
 *                                               with leave weeks marked
 *
 * Mounted INSIDE routes/people.ts, so it sits behind the same gates: People
 * access (lib/people-access.ts) and the compulsory private PIN
 * (middleware/people-unlock.ts, applied where /people is mounted).
 *
 * HOURS ONLY. Planday payroll rows carry pay; services/planday-hours.ts
 * strips them to hours on arrival, and contracts are read for their weekly
 * hours alone — no rate, salary or pay figure ever leaves this file.
 *
 * Rules (pure, tested): lib/hours-worked.ts, lib/contracted-hours.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import {
  buildHoursReport, classifyForEmployees, resolveHoursRange, sortTeamRows,
  type ClassifiedHoursShift, type LeaveDay,
} from "../lib/hours-worked";
import { chooseContractedHours, type ContractHoursCandidates, type ContractedHours } from "../lib/contracted-hours";
import { getPayrollHours } from "../services/planday-hours";
import { getContractRuleFacts, type ContractRuleFacts } from "../services/planday-employment";
import { getAttendanceFromCache } from "../services/planday-attendance-cache";
import { getPlandayShiftTypes, getPlandayAbsenceAccounts, isPlandayConfigured } from "../services/planday";

const router: IRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

interface PersonRow extends Record<string, unknown> {
  id: number;
  name: string;
  avatar_url: string | null;
  job_title: string | null;
  planday_employee_id: number | null;
  issued_hours: string | null;
  issued_at: string | null;
  contract_start: string | null;
}

/** People with what the report needs from the app: their Planday link and
 *  their latest issued contract's weekly hours (never its pay). */
async function loadPeople(where: SQL): Promise<PersonRow[]> {
  const rows = await db.execute<PersonRow>(sql`
    SELECT u.id, u.name, u.avatar_url, u.planday_employee_id,
           COALESCE(NULLIF(btrim(u.job_title), ''), c.job_title) AS job_title,
           c.weekly_hours AS issued_hours, c.issued_at::date::text AS issued_at,
           c.start_date::text AS contract_start
      FROM app_users u
      LEFT JOIN LATERAL (
        SELECT job_title, weekly_hours, issued_at, start_date FROM employment_contracts ec
         WHERE ec.user_id = u.id ORDER BY ec.issued_at DESC LIMIT 1
      ) c ON TRUE
     ${where}
     ORDER BY u.name
  `);
  return rows.rows;
}

/** Weekly hours from each person's latest uploaded old contract that has
 *  any — the founder's confirmed value and what was read off it. Reads the
 *  two hours fields only, never the pay fields beside them. */
async function loadUploadedHours(userIds: number[]): Promise<Map<number, ContractHoursCandidates["uploaded"]>> {
  const out = new Map<number, ContractHoursCandidates["uploaded"]>();
  if (userIds.length === 0) return out;
  try {
    const rows = await db.execute<{ user_id: number; confirmed: string | null; extracted: string | null; issue_date: string | null }>(sql`
      SELECT DISTINCT ON (user_id) user_id,
             prefill->>'weeklyHours' AS confirmed,
             extraction->'fields'->'weeklyHours'->>'value' AS extracted,
             original_issue_date::text AS issue_date
        FROM uploaded_contracts
       WHERE user_id IN (${sql.join(userIds.map(i => sql`${i}`), sql`, `)})
         AND (NULLIF(btrim(prefill->>'weeklyHours'), '') IS NOT NULL
              OR NULLIF(btrim(extraction->'fields'->'weeklyHours'->>'value'), '') IS NOT NULL)
       ORDER BY user_id, COALESCE(original_issue_date, uploaded_at::date) DESC, uploaded_at DESC
    `);
    for (const r of rows.rows) {
      out.set(Number(r.user_id), { confirmedHours: r.confirmed, extractedHours: r.extracted, issueDate: r.issue_date });
    }
  } catch (err) {
    // The table arrives with migration 0130; before that there's simply
    // nothing uploaded to read.
    console.warn("[people-hours] uploaded contract hours unavailable:", err instanceof Error ? err.message : err);
  }
  return out;
}

function contractFor(p: PersonRow, rule: ContractRuleFacts | null, uploaded: ContractHoursCandidates["uploaded"] | undefined): ContractedHours {
  return chooseContractedHours({
    issued: p.issued_hours != null ? { weeklyHours: p.issued_hours, issuedAt: p.issued_at } : null,
    planday: p.planday_employee_id == null
      ? { rule: null, status: "not_linked" }
      : !rule ? { rule: null, status: "unreachable" }
      : rule.status === "ok" ? { rule: rule.contractRule, status: "ok" }
      : { rule: null, status: rule.status },
    uploaded: uploaded ?? null,
  });
}

/** Payroll + leave for the range, sorted per Planday employee. */
async function loadHours(from: string, to: string): Promise<
  | { status: "ok"; byEmployee: ReturnType<typeof classifyForEmployees>; attendanceStale: boolean }
  | { status: "not_configured" | "unreachable" }
> {
  const payroll = await getPayrollHours(from, to);
  if (payroll.status !== "ok") return payroll;
  // The rota mirror gives shift types (payroll rows don't carry them) and
  // approved absence records. It syncs what's missing and serves the mirror
  // as-is if Planday is down — stale leave marks beat no report.
  const [attendance, shiftTypes, accounts] = await Promise.all([
    getAttendanceFromCache(from, to),
    getPlandayShiftTypes(),
    getPlandayAbsenceAccounts(),
  ]);
  const byEmployee = classifyForEmployees({
    payroll: payroll.shifts,
    rota: attendance.shifts.map(s => ({ id: s.id, employeeId: s.employeeId, date: s.date, shiftTypeId: s.shiftTypeId ?? null })),
    shiftTypeNames: new Map(shiftTypes.map(t => [t.id, t.name])),
    absences: attendance.absences,
    absenceAccountNames: new Map(accounts.map(a => [a.id, a.name])),
  });
  return { status: "ok", byEmployee, attendanceStale: attendance.stale };
}

/** Planday asks, a few at a time — Planday allows ~20 requests a second. */
async function rulesFor(plandayIds: number[]): Promise<Map<number, ContractRuleFacts>> {
  const out = new Map<number, ContractRuleFacts>();
  const queue = [...new Set(plandayIds)];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      out.set(id, await getContractRuleFacts(id));
    }
  }));
  return out;
}

function startedOn(p: PersonRow, rule: ContractRuleFacts | null | undefined): string | null {
  return (rule?.status === "ok" ? rule.hiredFrom : null) ?? p.contract_start ?? null;
}

function personOut(p: PersonRow) {
  return { id: Number(p.id), name: p.name, avatarUrl: p.avatar_url, jobTitle: p.job_title, linkedToPlanday: p.planday_employee_id != null };
}

// ── The team ───────────────────────────────────────────────────────────────
// people.ts mounts this router ahead of its own "/:userId", which would
// otherwise read "hours" as a person's id.

router.get("/hours", validateQuery(rangeQuery), async (_req: Request, res: Response) => {
  const today = londonDateString();
  const range = resolveHoursRange(res.locals["query"] as z.infer<typeof rangeQuery>, today);
  if ("error" in range) { res.status(400).json({ error: range.error }); return; }
  try {
    const people = await loadPeople(sql`WHERE u.is_active = TRUE`);
    const plandayIds = people.map(p => p.planday_employee_id).filter((n): n is number => n != null).map(Number);
    const [hours, rules, uploaded] = await Promise.all([
      isPlandayConfigured() ? loadHours(range.from, range.to) : Promise.resolve({ status: "not_configured" as const }),
      rulesFor(plandayIds),
      loadUploadedHours(people.map(p => Number(p.id))),
    ]);

    const rows = people.map(p => {
      const pdId = p.planday_employee_id != null ? Number(p.planday_employee_id) : null;
      const rule = pdId != null ? rules.get(pdId) ?? null : null;
      const contract = contractFor(p, rule, uploaded.get(Number(p.id)));
      const mine = hours.status === "ok" && pdId != null ? hours.byEmployee.get(pdId) : undefined;
      const report = hours.status === "ok" && pdId != null
        ? buildHoursReport({
            from: range.from, to: range.to, today,
            shifts: mine?.shifts ?? [], leaveDays: mine?.leaveDays ?? [],
            startedOn: startedOn(p, rule), contractedHours: contract.hours,
          })
        : null;
      return {
        ...personOut(p),
        shifts: report?.shifts ?? 0,
        avgPaidHours: report?.avgPaidHours ?? null,
        avgPaidPerWeek: report?.avgPaidPerWeek ?? null,
        countedWeeks: report?.countedWeeks ?? 0,
        leaveWeeks: report?.leaveWeeks ?? 0,
        contractedHours: contract.hours,
        contractSource: contract.source,
        difference: report?.difference ?? null,
        standing: report?.standing ?? null,
      };
    });

    const sources = { issued_contract: 0, planday_rule: 0, uploaded_contract: 0, none: 0 };
    for (const r of rows) sources[r.contractSource ?? "none"] += 1;

    res.json({
      status: hours.status,
      range: { ...range, today },
      rows: sortTeamRows(rows),
      sources,
      attendanceStale: hours.status === "ok" ? hours.attendanceStale : null,
    });
  } catch (err) {
    console.error("[people-hours] team failed:", err);
    res.status(500).json({ error: "Couldn't load hours" });
  }
});

// ── One person ─────────────────────────────────────────────────────────────

router.get("/:userId/hours", validateQuery(rangeQuery), async (req: Request, res: Response) => {
  const userId = Number(req.params["userId"]);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Invalid person" }); return; }
  const today = londonDateString();
  const range = resolveHoursRange(res.locals["query"] as z.infer<typeof rangeQuery>, today);
  if ("error" in range) { res.status(400).json({ error: range.error }); return; }
  try {
    const [person] = await loadPeople(sql`WHERE u.id = ${userId}`);
    if (!person) { res.status(404).json({ error: "Not found" }); return; }
    const pdId = person.planday_employee_id != null ? Number(person.planday_employee_id) : null;
    const [rule, uploaded] = await Promise.all([
      pdId != null ? getContractRuleFacts(pdId) : Promise.resolve(null),
      loadUploadedHours([userId]),
    ]);
    const contract = contractFor(person, rule, uploaded.get(userId));
    const base = { person: personOut(person), range: { ...range, today }, contract };

    if (pdId == null) { res.json({ ...base, status: "not_linked", report: null }); return; }
    if (!isPlandayConfigured()) { res.json({ ...base, status: "not_configured", report: null }); return; }
    const hours = await loadHours(range.from, range.to);
    if (hours.status !== "ok") { res.json({ ...base, status: hours.status, report: null }); return; }

    const mine = hours.byEmployee.get(pdId);
    const shifts: ClassifiedHoursShift[] = mine?.shifts ?? [];
    const leaveDays: LeaveDay[] = mine?.leaveDays ?? [];
    res.json({
      ...base,
      status: "ok",
      startedOn: startedOn(person, rule),
      attendanceStale: hours.attendanceStale,
      report: buildHoursReport({
        from: range.from, to: range.to, today, shifts, leaveDays,
        startedOn: startedOn(person, rule), contractedHours: contract.hours,
      }),
    });
  } catch (err) {
    console.error("[people-hours] person failed:", err);
    res.status(500).json({ error: "Couldn't load hours" });
  }
});

export default router;
