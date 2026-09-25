/**
 * People — one place per person (Graeme, 2026-09-25):
 *
 *   GET /api/people[?leavers=1]           the list: everyone, with flags —
 *                                         forms needed, policy trigger reached,
 *                                         next booked meeting — plus everyone's
 *                                         outstanding return-to-work forms
 *   GET /api/people/:userId[?from=]       one person's record: attendance
 *                                         (absence spells with form state,
 *                                         lates), their return-to-work forms and
 *                                         a rolling-12-month summary
 *   GET /api/people/:userId/employment    holiday balance, contract rule and
 *                                         employee type from Planday (cached
 *                                         10 min; ?fresh=1 re-asks)
 *   GET /api/people/job-titles[?leavers=1] everyone's job title in one list,
 *                                         for the "Set job titles" screen
 *   PATCH /api/people/:userId/job-title   set one person's job title
 *                                         (autosaved from the record header
 *                                         and the bulk screen)
 *
 * Meetings, reviews, notes and feedback keep coming from
 * /api/employee-reviews/:userId, which holds the private-note rules.
 *
 * Access: People access ONLY (lib/people-access.ts, the founder's per-person
 * switch), and index.ts mounts this behind requirePeopleUnlock — so the
 * private PIN must be set (428) and entered recently (423). Everyone else
 * gets 403 here: their own record lives in the Employee Hub and their own
 * forms on /return-to-work.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { normaliseJobTitle, JOB_TITLE_MAX } from "../lib/job-title";
import { hasPeopleAccess } from "../lib/people-access";
import { loadClassifiedShifts, loadFormCovers, todayIso } from "../lib/rtw-detect";
import { absenceSpells, dueSpells, type AbsenceSpell } from "../lib/absence-spells";
import { summariseAttendance, rollingWindowStart } from "../lib/attendance-summary";
import { outstandingFormsForViewer, sortPeopleForList } from "../lib/people-list";
import { isLateName } from "../services/attendance-classify";
import { getAttendanceFromCache } from "../services/planday-attendance-cache";
import { getEmploymentFacts } from "../services/planday-employment";
import { formSelect, shapeForm, type FormRow } from "../lib/rtw-forms";

const router: IRouter = Router();

async function requirePeopleAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    if (!(await hasPeopleAccess(userId))) {
      res.status(403).json({ error: "People records are open only to people with People access." });
      return;
    }
    next();
  } catch (err) {
    console.error("[people] access check failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  }
}
router.use(requirePeopleAccess);

/** Bring the Planday mirror up to date for the window (backfills anything
 *  never covered, re-pulls the trailing weeks at most hourly). Planday being
 *  down never fails the page — we read the mirror as it is and say so. */
async function syncAttendance(from: string, to: string): Promise<{ syncedAt: string | null; stale: boolean }> {
  try {
    const r = await getAttendanceFromCache(from, to);
    return { syncedAt: r.syncedAt, stale: r.stale };
  } catch (err) {
    console.warn("[people] attendance sync failed, using mirror as-is:", err instanceof Error ? err.message : err);
    return { syncedAt: null, stale: true };
  }
}

interface UserRow extends Record<string, unknown> {
  id: number;
  name: string;
  role: string;
  avatar_url: string | null;
  is_active: boolean;
  planday_employee_id: number | null;
  probation_months: number | null;
  job_title: string | null;
  contract_start: string | null;
}

const userSelect = sql`
  SELECT u.id, u.name, u.role, u.avatar_url, u.is_active, u.planday_employee_id, u.probation_months,
         -- The person's own title (migration 0130), else their latest
         -- contract's — e.g. a contract issued to an invite before the
         -- account existed.
         COALESCE(NULLIF(btrim(u.job_title), ''), c.job_title) AS job_title,
         c.start_date::text AS contract_start
    FROM app_users u
    LEFT JOIN LATERAL (
      SELECT job_title, start_date FROM employment_contracts ec
       WHERE ec.user_id = u.id ORDER BY ec.issued_at DESC LIMIT 1
    ) c ON TRUE
`;

function shapePerson(u: UserRow) {
  return {
    id: Number(u.id),
    name: u.name,
    role: u.role,
    avatarUrl: u.avatar_url,
    isActive: u.is_active,
    linkedToPlanday: u.planday_employee_id != null,
    probationMonths: u.probation_months,
    jobTitle: u.job_title,
    contractStartDate: u.contract_start,
  };
}

function spellOut(s: AbsenceSpell) {
  return {
    start: s.start, end: s.end, days: s.days, types: s.types, sickness: s.sickness,
    returned: s.returned, formId: s.formId, formStatus: s.formStatus, formState: s.formState,
  };
}

// ── The list ───────────────────────────────────────────────────────────────

const listQuery = z.object({ leavers: z.enum(["0", "1"]).optional() });

router.get("/", validateQuery(listQuery), async (req: Request, res: Response) => {
  const { leavers } = res.locals["query"] as z.infer<typeof listQuery>;
  const includeLeavers = leavers === "1";
  const today = todayIso();
  const windowStart = rollingWindowStart(today);
  try {
    const attendance = await syncAttendance(windowStart, today);
    const users = await db.execute<UserRow>(sql`
      ${userSelect}
      ${includeLeavers ? sql`` : sql`WHERE u.is_active = TRUE`}
      ORDER BY u.name
    `);
    const ids = users.rows.map(u => Number(u.id));
    const [shiftsByUser, formsByUser, meetings] = await Promise.all([
      loadClassifiedShifts(ids, windowStart, { includeInactive: includeLeavers }),
      loadFormCovers(ids),
      ids.length === 0 ? Promise.resolve({ rows: [] as Array<{ subject_user_id: number; kind: string; title: string | null; scheduled_for: string }> }) :
        db.execute<{ subject_user_id: number; kind: string; title: string | null; scheduled_for: string }>(sql`
          SELECT DISTINCT ON (subject_user_id) subject_user_id, kind, title, scheduled_for::text
            FROM employee_meetings
           WHERE status = 'booked' AND scheduled_for >= ${today}
           ORDER BY subject_user_id, scheduled_for ASC
        `),
    ]);
    const nextMeeting = new Map(meetings.rows.map(m => [Number(m.subject_user_id), { date: m.scheduled_for, kind: m.kind, title: m.title }]));

    const dueByUser = new Map<number, AbsenceSpell[]>();
    const people = users.rows.map(u => {
      const id = Number(u.id);
      const shifts = shiftsByUser.get(id) ?? [];
      const spells = absenceSpells(shifts, formsByUser.get(id) ?? [], today);
      const due = dueSpells(spells);
      if (due.length > 0) dueByUser.set(id, due);
      const summary = summariseAttendance(shifts, today);
      return {
        ...shapePerson(u),
        formsNeeded: due.length,
        awayNow: spells.some(s => s.formState === "away"),
        triggers: summary.triggers,
        sickInstances: summary.sickInstances,
        lates: summary.lates,
        nextMeeting: nextMeeting.get(id) ?? null,
      };
    });

    const names = new Map(users.rows.map(u => [Number(u.id), u.name]));
    const outstanding = outstandingFormsForViewer(
      { id: req.session.userId!, hasPeopleAccess: true },
      dueByUser,
      names,
    );

    res.json({
      people: sortPeopleForList(people),
      outstanding,
      policy: summariseAttendance([], today).policy,
      attendance,
    });
  } catch (err) {
    console.error("[people] list failed:", err);
    res.status(500).json({ error: "Couldn't load the people list" });
  }
});

// ── Job titles ─────────────────────────────────────────────────────────────
//
// What each person DOES ("Production Operative", "Head Chef") — shown on the
// list and the record instead of the app role. Never touches the permission
// role. Declared before "/:userId" so "job-titles" isn't read as an id.

router.get("/job-titles", validateQuery(listQuery), async (_req: Request, res: Response) => {
  const { leavers } = res.locals["query"] as z.infer<typeof listQuery>;
  try {
    const rows = await db.execute<{
      id: number; name: string; avatar_url: string | null; is_active: boolean;
      job_title: string | null; contract_job_title: string | null;
    }>(sql`
      SELECT u.id, u.name, u.avatar_url, u.is_active, u.job_title,
             c.job_title AS contract_job_title
        FROM app_users u
        LEFT JOIN LATERAL (
          SELECT job_title FROM employment_contracts ec
           WHERE ec.user_id = u.id ORDER BY ec.issued_at DESC LIMIT 1
        ) c ON TRUE
       ${leavers === "1" ? sql`` : sql`WHERE u.is_active = TRUE`}
       ORDER BY u.name
    `);
    res.json({
      people: rows.rows.map(r => ({
        id: Number(r.id),
        name: r.name,
        avatarUrl: r.avatar_url,
        isActive: r.is_active,
        jobTitle: r.job_title,
        contractJobTitle: r.contract_job_title,
      })),
    });
  } catch (err) {
    console.error("[people] job titles failed:", err);
    res.status(500).json({ error: "Couldn't load job titles" });
  }
});

const JobTitleBody = z.object({
  // Generous cap: the value is tidied and cut to JOB_TITLE_MAX, never refused
  // mid-typing by an autosave.
  jobTitle: z.string().max(JOB_TITLE_MAX * 4).nullable(),
});

router.patch("/:userId/job-title", validate(JobTitleBody), async (req: Request, res: Response) => {
  const userId = parseUserId(req, res);
  if (userId == null) return;
  const jobTitle = normaliseJobTitle((req.body as z.infer<typeof JobTitleBody>).jobTitle);
  try {
    const rows = await db.execute<{ id: number; job_title: string | null }>(sql`
      UPDATE app_users
         SET job_title = ${jobTitle}, job_title_updated_at = NOW(), job_title_updated_by = ${req.session.userId ?? null}
       WHERE id = ${userId}
       RETURNING id, job_title
    `);
    if (!rows.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ id: userId, jobTitle: rows.rows[0].job_title });
  } catch (err) {
    console.error("[people] job title save failed:", err);
    res.status(500).json({ error: "Couldn't save the job title" });
  }
});

// ── One person's record ────────────────────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recordQuery = z.object({ from: isoDate.optional() });

function parseUserId(req: Request, res: Response): number | null {
  const id = Number(req.params["userId"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid person" }); return null; }
  return id;
}

router.get("/:userId", validateQuery(recordQuery), async (req: Request, res: Response) => {
  const userId = parseUserId(req, res);
  if (userId == null) return;
  const today = todayIso();
  const q = res.locals["query"] as z.infer<typeof recordQuery>;
  const defaultFrom = rollingWindowStart(today);
  const from = q.from && q.from < today ? q.from : defaultFrom;
  try {
    const users = await db.execute<UserRow>(sql`${userSelect} WHERE u.id = ${userId}`);
    const user = users.rows[0];
    if (!user) { res.status(404).json({ error: "Not found" }); return; }

    // The summary always needs the full 12 months, even if the timeline asks for less.
    const loadFrom = from < defaultFrom ? from : defaultFrom;
    const attendance = await syncAttendance(loadFrom, today);
    const [shiftsByUser, formsByUser, formRows] = await Promise.all([
      loadClassifiedShifts([userId], loadFrom, { includeInactive: true }),
      loadFormCovers([userId]),
      db.execute<FormRow>(sql`${formSelect} WHERE f.user_id = ${userId} ORDER BY f.absence_start DESC`),
    ]);
    const shifts = shiftsByUser.get(userId) ?? [];
    const spells = absenceSpells(shifts, formsByUser.get(userId) ?? [], today)
      .filter(s => s.end >= from)
      .sort((a, b) => b.end.localeCompare(a.end));
    const lates = shifts
      .filter(s => s.date >= from && s.typeName != null && isLateName(s.typeName))
      .map(s => ({ date: s.date, label: s.typeName as string }))
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      person: shapePerson(user),
      window: { from, to: today, defaultFrom },
      spells: spells.map(spellOut),
      lates,
      forms: formRows.rows.map(shapeForm),
      summary: summariseAttendance(shifts, today),
      attendance: { ...attendance, linked: user.planday_employee_id != null },
    });
  } catch (err) {
    console.error("[people] record failed:", err);
    res.status(500).json({ error: "Couldn't load this record" });
  }
});

const employmentQuery = z.object({ fresh: z.enum(["0", "1"]).optional() });

router.get("/:userId/employment", validateQuery(employmentQuery), async (req: Request, res: Response) => {
  const userId = parseUserId(req, res);
  if (userId == null) return;
  const { fresh } = res.locals["query"] as z.infer<typeof employmentQuery>;
  try {
    const rows = await db.execute<{ planday_employee_id: number | null }>(sql`
      SELECT planday_employee_id FROM app_users WHERE id = ${userId}
    `);
    if (!rows.rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    const plandayId = rows.rows[0].planday_employee_id;
    if (plandayId == null) { res.json({ status: "not_linked" }); return; }
    res.json(await getEmploymentFacts(Number(plandayId), { fresh: fresh === "1" }));
  } catch (err) {
    console.error("[people] employment failed:", err);
    res.json({ status: "unreachable" });
  }
});

export default router;
