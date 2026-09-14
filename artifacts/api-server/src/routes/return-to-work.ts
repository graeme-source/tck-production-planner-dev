/**
 * Return-to-work forms (Graeme, 2026-09-14): completed by a colleague WITH
 * a manager after a spell of sick leave. Privacy: the colleague and the
 * named RTW managers only (middleware/rtw-access.ts — founder + Lorna
 * Brown); ordinary admin/manager roles see nothing. Spells are detected
 * from the Planday mirror (lib/rtw-detect.ts) and an hourly sweep raises
 * to-dos for the colleague and the RTW managers when a form is owed.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { hasRtwManagerAccess, canAccessRtwUser } from "../middleware/rtw-access";
import { sickSpellsForUser, dueSpells } from "../lib/rtw-detect";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}
router.use(requireAuth);

interface FormRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  user_name: string | null;
  absence_start: string;
  absence_end: string | null;
  return_date: string | null;
  reason_category: string | null;
  reason_details: string | null;
  support_notes: string | null;
  manager_name: string | null;
  colleague_signed_at: string | null;
  manager_signed_at: string | null;
  status: string;
  created_at: string;
}

const formSelect = sql`
  SELECT f.id, f.user_id, u.name AS user_name, f.absence_start::text, f.absence_end::text,
         f.return_date::text, f.reason_category, f.reason_details, f.support_notes,
         f.manager_name, f.colleague_signed_at, f.manager_signed_at, f.status, f.created_at
  FROM return_to_work_forms f JOIN app_users u ON u.id = f.user_id
`;

function shapeForm(r: FormRow) {
  return {
    id: Number(r.id),
    userId: Number(r.user_id),
    userName: r.user_name,
    absenceStart: r.absence_start,
    absenceEnd: r.absence_end,
    returnDate: r.return_date,
    reasonCategory: r.reason_category,
    reasonDetails: r.reason_details,
    supportNotes: r.support_notes,
    managerName: r.manager_name,
    colleagueSignedAt: r.colleague_signed_at,
    managerSignedAt: r.manager_signed_at,
    status: r.status,
    createdAt: r.created_at,
  };
}

// GET /mine — my forms + any spells owing one (drives the page + banner).
router.get("/mine", async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.user_id = ${userId} ORDER BY f.absence_start DESC`);
  const spells = await sickSpellsForUser(userId).catch(() => []);
  res.json({
    forms: rows.rows.map(shapeForm),
    due: dueSpells(spells),
    isRtwManager: await hasRtwManagerAccess(req),
  });
});

// GET /user/:userId — spells + forms for one person. Self or RTW manager.
router.get("/user/:userId", async (req: Request, res: Response) => {
  const subjectId = Number(req.params.userId);
  if (!Number.isInteger(subjectId)) { res.status(400).json({ error: "Invalid user" }); return; }
  if (!(await canAccessRtwUser(req, subjectId))) {
    res.status(403).json({ error: "Return-to-work records are private — the colleague and named RTW managers only." });
    return;
  }
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.user_id = ${subjectId} ORDER BY f.absence_start DESC`);
  const spells = await sickSpellsForUser(subjectId).catch(() => []);
  res.json({ forms: rows.rows.map(shapeForm), spells });
});

// GET /form/:id — one form in full.
router.get("/form/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid form" }); return; }
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.id = ${id}`);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) {
    res.status(403).json({ error: "Return-to-work records are private — the colleague and named RTW managers only." });
    return;
  }
  res.json(shapeForm(row));
});

const createSchema = z.object({
  userId: z.number().int().optional(),      // RTW managers may open for others
  absenceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  absenceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

// POST / — open a draft (usually pre-filled from a detected spell).
router.post("/", validate(createSchema), async (req: Request, res: Response) => {
  const callerId = req.session.userId!;
  const { userId, absenceStart, absenceEnd } = req.body as z.infer<typeof createSchema>;
  const subjectId = userId ?? callerId;
  if (subjectId !== callerId && !(await hasRtwManagerAccess(req))) {
    res.status(403).json({ error: "Only RTW managers can open a form for someone else." });
    return;
  }
  // One form per spell: reuse an existing draft covering the same dates.
  const existing = await db.execute<{ id: number }>(sql`
    SELECT id FROM return_to_work_forms
    WHERE user_id = ${subjectId}
      AND absence_start <= ${absenceEnd ?? absenceStart} AND COALESCE(absence_end, absence_start) >= ${absenceStart}
    LIMIT 1
  `);
  if (existing.rows[0]) { res.json({ id: Number(existing.rows[0].id), reused: true }); return; }
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO return_to_work_forms (user_id, absence_start, absence_end, created_by_user_id)
    VALUES (${subjectId}, ${absenceStart}, ${absenceEnd ?? null}, ${callerId})
    RETURNING id
  `);
  res.json({ id: Number(inserted.rows[0].id), reused: false });
});

const patchSchema = z.object({
  absenceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  absenceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reasonCategory: z.string().max(60).nullable().optional(),
  reasonDetails: z.string().max(8000).nullable().optional(),
  supportNotes: z.string().max(8000).nullable().optional(),
  managerName: z.string().max(120).nullable().optional(),
});

// PATCH /:id — autosave. Subject or RTW manager; completed forms only
// editable by RTW managers (the record shouldn't shift after signing).
router.patch("/:id", validate(patchSchema), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid form" }); return; }
  const rows = await db.execute<{ user_id: number; status: string }>(sql`
    SELECT user_id, status FROM return_to_work_forms WHERE id = ${id}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) { res.status(403).json({ error: "Private" }); return; }
  if (row.status === "complete" && !(await hasRtwManagerAccess(req))) {
    res.status(409).json({ error: "This form is signed — ask Graeme or Lorna for changes." });
    return;
  }
  const b = req.body as z.infer<typeof patchSchema>;
  await db.execute(sql`
    UPDATE return_to_work_forms SET
      absence_start = COALESCE(${b.absenceStart ?? null}, absence_start),
      absence_end = ${b.absenceEnd !== undefined ? b.absenceEnd : sql`absence_end`},
      return_date = ${b.returnDate !== undefined ? b.returnDate : sql`return_date`},
      reason_category = ${b.reasonCategory !== undefined ? b.reasonCategory : sql`reason_category`},
      reason_details = ${b.reasonDetails !== undefined ? b.reasonDetails : sql`reason_details`},
      support_notes = ${b.supportNotes !== undefined ? b.supportNotes : sql`support_notes`},
      manager_name = ${b.managerName !== undefined ? b.managerName : sql`manager_name`},
      updated_at = NOW()
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// POST /:id/complete — the sit-down sign-off. The colleague's press signs
// for them; when an RTW manager is the caller their countersign lands too.
router.post("/:id/complete", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid form" }); return; }
  const rows = await db.execute<{ user_id: number; reason_category: string | null; manager_name: string | null }>(sql`
    SELECT user_id, reason_category, manager_name FROM return_to_work_forms WHERE id = ${id}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) { res.status(403).json({ error: "Private" }); return; }
  if (!row.reason_category || !row.manager_name) {
    res.status(422).json({ error: "Fill in the reason and the manager you completed this with before signing." });
    return;
  }
  const callerId = req.session.userId!;
  const isManager = await hasRtwManagerAccess(req);
  const isSubject = callerId === Number(row.user_id);
  await db.execute(sql`
    UPDATE return_to_work_forms SET
      status = 'complete',
      colleague_signed_at = CASE WHEN ${isSubject} THEN NOW() ELSE COALESCE(colleague_signed_at, NOW()) END,
      manager_user_id = CASE WHEN ${isManager} THEN ${callerId} ELSE manager_user_id END,
      manager_signed_at = CASE WHEN ${isManager} THEN NOW() ELSE manager_signed_at END,
      updated_at = NOW()
    WHERE id = ${id}
  `);
  // The chase to-dos close themselves for everyone involved.
  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE status <> 'done' AND url LIKE ${"/return-to-work%"} AND url LIKE ${`%spell=${row.user_id}:%`}
  `);
  res.json({ ok: true });
});

export default router;
