/**
 * Return-to-work forms (Graeme, 2026-09-14): completed by a colleague WITH
 * a manager after a spell of absence — sickness, and since 2026-09-25 any
 * absence reason (dependants' or emergency leave, unexplained absence), so
 * the reason is on record. Never holiday. Privacy: the colleague and the
 * people Graeme has given People access only (middleware/rtw-access.ts);
 * ordinary admin/manager roles see nothing. Spells are detected
 * from the Planday mirror (lib/rtw-detect.ts) and an hourly sweep raises
 * to-dos for the colleague and the RTW managers when a form is owed.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { hasRtwManagerAccess, canAccessRtwUser } from "../middleware/rtw-access";
import {
  sickSpellsForUser, absenceSpellsForUser, absenceSpellsForUsers, dueSpells, attendanceEventsForUser, todayIso,
  type AbsenceSpell,
} from "../lib/rtw-detect";
import { outstandingFormsForViewer } from "../lib/people-list";
import { checkAbsenceDates } from "../lib/rtw-dates";
import { chaseLikePatternsForUser } from "../lib/rtw-chase";
import { singleFileUpload } from "../middleware/upload";
import { canUploadRtwAttachment, canDeleteRtwAttachment } from "../lib/rtw-attachment-rules";
import { requirePeopleUnlock } from "../middleware/people-unlock";

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
  absence_type: string | null;
  return_date: string | null;
  reason_category: string | null;
  reason_details: string | null;
  support_notes: string | null;
  doctor_seen: boolean | null;
  work_related: boolean | null;
  manager_name: string | null;
  colleague_signed_at: string | null;
  manager_signed_at: string | null;
  status: string;
  created_at: string;
}

const formSelect = sql`
  SELECT f.id, f.user_id, u.name AS user_name, f.absence_start::text, f.absence_end::text,
         f.absence_type, f.return_date::text, f.reason_category, f.reason_details, f.support_notes,
         f.doctor_seen, f.work_related,
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
    absenceType: r.absence_type,
    returnDate: r.return_date,
    reasonCategory: r.reason_category,
    reasonDetails: r.reason_details,
    supportNotes: r.support_notes,
    doctorSeen: r.doctor_seen,
    workRelated: r.work_related,
    managerName: r.manager_name,
    colleagueSignedAt: r.colleague_signed_at,
    managerSignedAt: r.manager_signed_at,
    status: r.status,
    createdAt: r.created_at,
  };
}

// GET /mine — my forms + any absence spells owing one (drives the page +
// banner). For someone with People access it also counts everyone ELSE's
// outstanding forms — only a number, no names or dates, because /mine sits
// outside the People lock — so the page can point them to People, where
// the full list lives (Graeme, 2026-09-25: he opened this page, saw only his
// own nothing, and concluded there were no forms at all).
router.get("/mine", async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.user_id = ${userId} ORDER BY f.absence_start DESC`);
  const spells = await absenceSpellsForUser(userId).catch(err => {
    console.warn("[rtw] /mine spell detection failed:", err instanceof Error ? err.message : err);
    return [];
  });
  const isRtwManager = await hasRtwManagerAccess(req);
  let othersOutstanding = 0;
  if (isRtwManager) {
    const everyone = await absenceSpellsForUsers(null).catch(() => new Map<number, AbsenceSpell[]>());
    const dueByUser = new Map([...everyone].map(([uid, list]) => [uid, dueSpells(list)]));
    othersOutstanding = outstandingFormsForViewer({ id: userId, hasPeopleAccess: true }, dueByUser, new Map())
      .filter(f => f.userId !== userId).length;
  }
  res.json({
    forms: rows.rows.map(shapeForm),
    due: dueSpells(spells),
    isRtwManager,
    othersOutstanding,
  });
});

// Everything below /mine is behind the People lock (middleware/people-unlock.ts).
// For someone with People access that means their private PIN must be set
// (428 until it is) and entered recently (423) — for reads AND writes, so
// the PIN can't be sidestepped by editing a form it would stop you reading.
// Colleagues without People access pass straight through to their own forms.
// /mine stays outside: it drives the RTW banner and the page itself.
router.use(requirePeopleUnlock);

// GET /user/:userId — spells + forms for one person. Self or RTW manager.
// ?from=YYYY-MM-DD widens the spell window (the report modal passes its own
// range so the instances listed match the numbers that were clicked).
router.get("/user/:userId", async (req: Request, res: Response) => {
  const subjectId = Number(req.params.userId);
  if (!Number.isInteger(subjectId)) { res.status(400).json({ error: "Invalid user" }); return; }
  if (!(await canAccessRtwUser(req, subjectId))) {
    res.status(403).json({ error: "Return-to-work records are private — the colleague and people with People access only." });
    return;
  }
  const fromRaw = String(req.query["from"] ?? "");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : undefined;
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.user_id = ${subjectId} ORDER BY f.absence_start DESC`);
  const spells = await sickSpellsForUser(subjectId, from).catch(() => []);
  // Lates + non-sick absences, so the modal can show one chronological
  // attendance timeline (Graeme, 2026-09-14).
  const events = await attendanceEventsForUser(subjectId, from).catch(() => []);
  res.json({ forms: rows.rows.map(shapeForm), spells, events });
});

// GET /form/:id — one form in full.
router.get("/form/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid form" }); return; }
  const rows = await db.execute<FormRow>(sql`${formSelect} WHERE f.id = ${id}`);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) {
    res.status(403).json({ error: "Return-to-work records are private — the colleague and people with People access only." });
    return;
  }
  res.json(shapeForm(row));
});

const createSchema = z.object({
  userId: z.number().int().optional(),      // People-access managers may open for others
  absenceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  absenceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // What kind of absence: Planday's type name(s) for a detected spell, or
  // the type picked when recording one Planday doesn't show.
  absenceType: z.string().trim().max(80).nullable().optional(),
});

// POST / — open a draft: pre-filled from a detected spell, or dates a
// manager typed for an absence Planday doesn't show (checked: end not before
// start, nothing in the future — lib/rtw-dates.ts).
router.post("/", validate(createSchema), async (req: Request, res: Response) => {
  const callerId = req.session.userId!;
  const { userId, absenceStart, absenceEnd, absenceType } = req.body as z.infer<typeof createSchema>;
  const subjectId = userId ?? callerId;
  if (subjectId !== callerId && !(await hasRtwManagerAccess(req))) {
    res.status(403).json({ error: "Only someone with People access can open a form for someone else." });
    return;
  }
  const dateProblem = checkAbsenceDates(absenceStart, absenceEnd ?? null, todayIso());
  if (dateProblem) { res.status(400).json({ error: dateProblem }); return; }
  // One form per spell: reuse an existing draft covering the same dates.
  const existing = await db.execute<{ id: number }>(sql`
    SELECT id FROM return_to_work_forms
    WHERE user_id = ${subjectId}
      AND absence_start <= ${absenceEnd ?? absenceStart} AND COALESCE(absence_end, absence_start) >= ${absenceStart}
    LIMIT 1
  `);
  if (existing.rows[0]) { res.json({ id: Number(existing.rows[0].id), reused: true }); return; }
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO return_to_work_forms (user_id, absence_start, absence_end, absence_type, created_by_user_id)
    VALUES (${subjectId}, ${absenceStart}, ${absenceEnd ?? null}, ${absenceType || null}, ${callerId})
    RETURNING id
  `);
  res.json({ id: Number(inserted.rows[0].id), reused: false });
});

const patchSchema = z.object({
  absenceStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  absenceEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  absenceType: z.string().trim().max(80).nullable().optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  reasonCategory: z.string().max(60).nullable().optional(),
  reasonDetails: z.string().max(8000).nullable().optional(),
  supportNotes: z.string().max(8000).nullable().optional(),
  doctorSeen: z.boolean().nullable().optional(),
  workRelated: z.boolean().nullable().optional(),
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
    res.status(409).json({ error: "This form is signed — ask someone with People access to change it." });
    return;
  }
  const b = req.body as z.infer<typeof patchSchema>;
  await db.execute(sql`
    UPDATE return_to_work_forms SET
      absence_start = COALESCE(${b.absenceStart ?? null}, absence_start),
      absence_end = ${b.absenceEnd !== undefined ? b.absenceEnd : sql`absence_end`},
      absence_type = ${b.absenceType !== undefined ? (b.absenceType || null) : sql`absence_type`},
      return_date = ${b.returnDate !== undefined ? b.returnDate : sql`return_date`},
      reason_category = ${b.reasonCategory !== undefined ? b.reasonCategory : sql`reason_category`},
      reason_details = ${b.reasonDetails !== undefined ? b.reasonDetails : sql`reason_details`},
      support_notes = ${b.supportNotes !== undefined ? b.supportNotes : sql`support_notes`},
      doctor_seen = ${b.doctorSeen !== undefined ? b.doctorSeen : sql`doctor_seen`},
      work_related = ${b.workRelated !== undefined ? b.workRelated : sql`work_related`},
      manager_name = ${b.managerName !== undefined ? b.managerName : sql`manager_name`},
      updated_at = NOW()
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// POST /:id/complete — the sit-down sign-off. The colleague's press signs
// for them; when an RTW manager is the caller their countersign lands too.
// The ONLY required field is who recorded it (Graeme, 2026-09-14: historical
// back-fills may carry just a reason, or even less — the dates and the
// recorder are the contract). An RTW manager completing a form with no
// manager name recorded gets their own name stamped in automatically.
router.post("/:id/complete", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid form" }); return; }
  const rows = await db.execute<{ user_id: number; reason_category: string | null; manager_name: string | null }>(sql`
    SELECT user_id, reason_category, manager_name FROM return_to_work_forms WHERE id = ${id}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) { res.status(403).json({ error: "Private" }); return; }
  const callerId = req.session.userId!;
  const isManager = await hasRtwManagerAccess(req);
  const isSubject = callerId === Number(row.user_id);
  if (!row.manager_name) {
    if (isManager) {
      const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${callerId}`);
      await db.execute(sql`UPDATE return_to_work_forms SET manager_name = ${me.rows[0]?.name ?? "Manager"} WHERE id = ${id}`);
    } else {
      res.status(422).json({ error: "Add the manager you completed this with before signing." });
      return;
    }
  }
  await db.execute(sql`
    UPDATE return_to_work_forms SET
      status = 'complete',
      colleague_signed_at = CASE WHEN ${isSubject} THEN NOW() ELSE COALESCE(colleague_signed_at, NOW()) END,
      manager_user_id = CASE WHEN ${isManager} THEN ${callerId} ELSE manager_user_id END,
      manager_signed_at = CASE WHEN ${isManager} THEN NOW() ELSE manager_signed_at END,
      updated_at = NOW()
    WHERE id = ${id}
  `);
  // The chase to-dos close themselves for everyone involved — the
  // colleague's (/return-to-work?spell=…) and the managers' (/people/<id>?spell=…,
  // or the older /return-to-work?user=…&spell=…). Anchored on ? or & so
  // user 4's form never closes user 14's (lib/rtw-chase.ts). If the person
  // has another spell still owing a form, the next hourly sweep re-raises it.
  const [tagQ, tagAmp] = chaseLikePatternsForUser(Number(row.user_id));
  await db.execute(sql`
    UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE status <> 'done'
      AND (url LIKE ${"/return-to-work%"} OR url LIKE ${"/people/%"})
      AND (url LIKE ${tagQ} OR url LIKE ${tagAmp})
  `);
  res.json({ ok: true });
});

// ── Attachments: fit notes, appointment letters, photos ────────────────────
// Same privacy boundary as the form. Bytes in Postgres (like the documents
// repository) so backups carry them. Rules in lib/rtw-attachment-rules:
// draft = colleague + managers can file; signed = managers only.

const RTW_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);

async function loadFormForAttachment(req: Request, res: Response, formId: number):
  Promise<{ userId: number; status: string } | null> {
  if (!Number.isInteger(formId)) { res.status(400).json({ error: "Invalid form" }); return null; }
  const rows = await db.execute<{ user_id: number; status: string }>(sql`
    SELECT user_id, status FROM return_to_work_forms WHERE id = ${formId}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Form not found" }); return null; }
  if (!(await canAccessRtwUser(req, Number(row.user_id)))) {
    res.status(403).json({ error: "Return-to-work records are private — the colleague and people with People access only." });
    return null;
  }
  return { userId: Number(row.user_id), status: row.status };
}

// GET /:id/attachments — list (metadata only, no bytes).
router.get("/:id/attachments", async (req: Request, res: Response) => {
  const formId = Number(req.params.id);
  const form = await loadFormForAttachment(req, res, formId);
  if (!form) return;
  const rows = await db.execute<{ id: number; file_name: string | null; mime: string; uploaded_by_name: string | null; uploaded_by_user_id: number | null; created_at: string }>(sql`
    SELECT id, file_name, mime, uploaded_by_name, uploaded_by_user_id, created_at
    FROM return_to_work_attachments WHERE form_id = ${formId} ORDER BY created_at ASC
  `);
  res.json(rows.rows.map(a => ({
    id: Number(a.id),
    fileName: a.file_name,
    mime: a.mime,
    uploadedByName: a.uploaded_by_name,
    uploadedByUserId: a.uploaded_by_user_id == null ? null : Number(a.uploaded_by_user_id),
    createdAt: a.created_at,
  })));
});

// POST /:id/attachments — file one document (PDF or photo, 15MB).
router.post("/:id/attachments", singleFileUpload("file", 15), async (req: Request, res: Response) => {
  const formId = Number(req.params.id);
  const form = await loadFormForAttachment(req, res, formId);
  if (!form) return;
  const isManager = await hasRtwManagerAccess(req);
  if (!canUploadRtwAttachment({ formStatus: form.status, isRtwManager: isManager })) {
    res.status(409).json({ error: "This form is signed — ask someone with People access to file the document." });
    return;
  }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
  if (!RTW_ATTACHMENT_MIMES.has(req.file.mimetype)) {
    res.status(400).json({ error: "PDFs and photos only (PDF, JPEG, PNG, WebP or HEIC)." });
    return;
  }
  const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO return_to_work_attachments (form_id, file_name, mime, data, uploaded_by_user_id, uploaded_by_name)
    VALUES (${formId}, ${req.file.originalname ?? null}, ${req.file.mimetype}, ${req.file.buffer},
            ${req.session.userId}, ${me.rows[0]?.name ?? null})
    RETURNING id
  `);
  res.status(201).json({ id: Number(inserted.rows[0]?.id) });
});

// GET /attachments/:attachmentId — the bytes, inline (view/print).
router.get("/attachments/:attachmentId", async (req: Request, res: Response) => {
  const attId = Number(req.params.attachmentId);
  if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid attachment" }); return; }
  const rows = await db.execute<{ form_id: number; mime: string; file_name: string | null; data: Buffer }>(sql`
    SELECT form_id, mime, file_name, data FROM return_to_work_attachments WHERE id = ${attId}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const form = await loadFormForAttachment(req, res, Number(row.form_id));
  if (!form) return;
  res.setHeader("Content-Type", row.mime);
  if (row.file_name) {
    res.setHeader("Content-Disposition", `inline; filename="${row.file_name.replace(/[^\w.\- ]+/g, "_")}"`);
  }
  res.send(row.data);
});

// DELETE /attachments/:attachmentId — managers always; the colleague only
// their own upload while the form is still a draft.
router.delete("/attachments/:attachmentId", async (req: Request, res: Response) => {
  const attId = Number(req.params.attachmentId);
  if (!Number.isInteger(attId)) { res.status(400).json({ error: "Invalid attachment" }); return; }
  const rows = await db.execute<{ form_id: number; uploaded_by_user_id: number | null }>(sql`
    SELECT form_id, uploaded_by_user_id FROM return_to_work_attachments WHERE id = ${attId}
  `);
  const row = rows.rows[0];
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const form = await loadFormForAttachment(req, res, Number(row.form_id));
  if (!form) return;
  const isManager = await hasRtwManagerAccess(req);
  const allowed = canDeleteRtwAttachment({
    formStatus: form.status,
    isRtwManager: isManager,
    uploadedByUserId: row.uploaded_by_user_id == null ? null : Number(row.uploaded_by_user_id),
    viewerUserId: req.session.userId!,
  });
  if (!allowed) {
    res.status(403).json({ error: "Only someone with People access can remove documents from a signed form." });
    return;
  }
  await db.execute(sql`DELETE FROM return_to_work_attachments WHERE id = ${attId}`);
  res.status(204).send();
});

export default router;
