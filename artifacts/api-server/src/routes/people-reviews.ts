/**
 * The employment record — classified entries (Graeme, 2026-10-12): one
 * "Add to record" form whose classification (Performance appraisal,
 * Probation review, Disciplinary, Attendance, Timekeeping, Health…) decides
 * the few extra fields. Any entry can be "Open — in review"; the person's
 * badge is the most serious open one. Rules + tests: lib/people-reviews.
 *
 *   GET   /api/people-reviews/badges                  the People list's badges
 *   GET   /api/people-reviews/lists                   classifications + stages
 *   POST  /api/people-reviews/classifications         add       (founder / admin with People access)
 *   PATCH /api/people-reviews/classifications/:id     edit      (ditto)
 *   POST  /api/people-reviews/stages                  add       (ditto)
 *   PATCH /api/people-reviews/stages/:id              edit      (ditto)
 *   GET   /api/people-reviews/person/:userId          one person's entries (+ history,
 *                                                     attendance evidence)
 *   POST  /api/people-reviews/person/:userId/entries  add an entry
 *   PATCH /api/people-reviews/entries/:id             change any field (autosaved);
 *                                                     reclassifying keeps every value
 *   POST  /api/people-reviews/entries/:id/withdraw-warning  { reason }
 *
 * Access, the same as the most sensitive People sections:
 *   • index.ts mounts this behind requirePeopleUnlock (private People PIN
 *     set + entered: 428 / 423);
 *   • here: the founder or a People-data grant holder (migration 0126), read
 *     fresh every request — anyone else gets 404;
 *   • per person, reads AND writes use the one shared rule
 *     canWriteEmploymentRecord (lib/people-write-access.ts): never your own
 *     record (by account, email or Planday id) unless you're the founder.
 *     Every write route carries the employmentRecordWrite guard (the route
 *     test proves it);
 *   • every read and write lands in people_record_audit.
 * Booking a meeting or a next-review date makes a discreet to-do on the
 * booker's own list. Nothing is ever sent to the employee; nothing deleted.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db, usersTable, peopleRecordClassificationsTable, peopleReviewStagesTable, peopleRecordEntriesTable, peopleRecordAuditTable,
  peopleLetterTemplatesTable, peopleLettersTable, personDocumentsTable, peopleHrSettingsTable,
} from "@workspace/db";
import {
  FIELD_SETS, EVIDENCE_KINDS, STAGE_TYPES, RATINGS, PROBATION_OUTCOMES, FIT_FOR_WORK, ENTRY_STATUSES, MEETING_TYPES,
  canEditLists, cleanFieldSets, cleanChecklist, checkWarningDates, expiryForStage, reclassify, reviewBadge,
  longestLiveWarning, entryWarning, recordTodo, planTodo, sortStages, sortClassifications, londonTodayIso,
  extendedEnd, extensionMessage, periodEnd, nextStage, attentionLine, PERIOD_MONTHS,
  MERGE_FIELDS, hrEmailIdentity, checkHrEmailSettings, templatesForEntry, letterMergeValues, fillTemplate, letterGaps, checkLetterAction, letterWaitingEmail,
  effectiveStage,
  type LetterTemplate, type LetterStatus, type FieldSet, type ProbationOutcome,
  type Classification, type Stage, type StageType, type EvidenceKind, type EntryLike, type EntryStatus,
  type MeetingType, type TodoKind,
} from "@workspace/people-reviews";
import { validate } from "../middleware/validate";
import {
  employmentRecordWrite, fromParam, fromRow, ownerOf, loadRecordActor, loadRecordSubject,
} from "../middleware/employment-record-write";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { isFounderEmail, FOUNDER_EMAIL } from "../lib/founder-email";
import { loadClassifiedShifts } from "../lib/rtw-detect";
import { summariseAttendance, rollingWindowStart } from "../lib/attendance-summary";
import { renderContractPdf } from "../pdf/contract-pdf";
import { sendEmail, FROM_EMAIL } from "../lib/email";
import {
  resyncAttentionSoon, attentionForViewer, loadProbations, attentionSettings, subjectsById,
} from "../lib/hr-attention";

const router: IRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");
const TEXT_MAX = 20_000;

interface Viewer { actor: RecordActor; name: string; role: string; isFounder: boolean }

function viewerOf(res: Response): Viewer {
  return res.locals["recordViewer"] as Viewer;
}

function fail(res: Response, where: string, err: unknown, message: string) {
  console.error(`[people-reviews] ${where} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: message });
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Every route: the founder or a People-data grant, read fresh. 404 —
// nothing here exists for anyone else.
router.use(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const actor = await loadRecordActor(id);
    const isFounder = isFounderEmail(actor?.email);
    if (!actor || (!isFounder && !actor.hasPeopleAccess)) { res.status(404).json({ error: "Not found" }); return; }
    const [u] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id));
    res.locals["recordViewer"] = { actor, name: u?.name ?? "", role: u?.role ?? "viewer", isFounder } satisfies Viewer;
    next();
  } catch (err) {
    fail(res, "access check", err, "Internal server error");
  }
});

/** May this viewer open (and change) this person's record? The shared rule. */
async function mayOpen(viewer: Viewer, subjectUserId: number): Promise<boolean> {
  const subject = await loadRecordSubject(subjectUserId);
  return subject != null && canWriteEmploymentRecord(viewer.actor, subject);
}

type Exec = Pick<typeof db, "insert" | "update" | "select" | "execute">;

async function audit(exec: Exec, viewer: Viewer, row: { subjectUserId: number | null; entryId?: number | null; action: string; detail?: string | null }) {
  await exec.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId: row.subjectUserId,
    entryId: row.entryId ?? null, action: row.action, detail: row.detail?.slice(0, 500) ?? null,
  });
}

async function loadStages(): Promise<Stage[]> {
  const rows = await db.select().from(peopleReviewStagesTable);
  return sortStages(rows.map(r => ({
    id: r.id, label: r.label, rank: r.rank, type: r.type as StageType, formal: r.formal,
    defaultExpiryMonths: r.defaultExpiryMonths, optional: r.optional, active: r.active,
  })));
}

async function loadClassifications(): Promise<Classification[]> {
  const rows = await db.select().from(peopleRecordClassificationsTable);
  return sortClassifications(rows.map(r => ({
    id: r.id, label: r.label, sortOrder: r.sortOrder, fieldSets: cleanFieldSets(r.fieldSets ?? []),
    evidence: (r.evidence as EvidenceKind | null) ?? null, active: r.active,
  })));
}

type EntryRow = typeof peopleRecordEntriesTable.$inferSelect;

function asEntryLike(r: EntryRow): EntryLike {
  return {
    id: r.id, classificationId: r.classificationId, entryDate: r.entryDate, title: r.title, status: r.status as EntryStatus,
    stageId: r.stageId, warningExpiresOn: r.warningExpiresOn,
    warningWithdrawnAt: r.warningWithdrawnAt ? r.warningWithdrawnAt.toISOString() : null,
  };
}

// ── The list badges ────────────────────────────────────────────────────────

router.get("/badges", async (_req: Request, res: Response) => {
  const viewer = viewerOf(res);
  try {
    const today = londonTodayIso();
    const [classifications, stages, entries] = await Promise.all([
      loadClassifications(), loadStages(), db.select().from(peopleRecordEntriesTable),
    ]);
    const byUser = new Map<number, EntryRow[]>();
    for (const e of entries) byUser.set(e.userId, [...(byUser.get(e.userId) ?? []), e]);
    const ids = [...byUser.keys()];
    const subjects = ids.length
      ? await db.select({ id: usersTable.id, email: usersTable.email, plandayEmployeeId: usersTable.plandayEmployeeId })
        .from(usersTable).where(inArray(usersTable.id, ids))
      : [];
    const badges = subjects
      .filter(s => canWriteEmploymentRecord(viewer.actor, s)) // never the viewer's own
      .map(s => {
        const list = (byUser.get(s.id) ?? []).map(asEntryLike);
        const warnings = list.map(e => entryWarning(e, classifications, stages)).filter((w): w is NonNullable<typeof w> => w != null);
        return {
          userId: s.id,
          badge: reviewBadge(list, classifications, stages),
          liveWarningUntil: longestLiveWarning(warnings, today)?.expiresOn ?? null,
        };
      })
      .filter(b => b.badge || b.liveWarningUntil);
    await audit(db, viewer, { subjectUserId: null, action: "view_list", detail: `${badges.length} flagged` });
    res.json({ badges });
  } catch (err) {
    fail(res, "badges", err, "Couldn't load record badges");
  }
});

// ── The lists ──────────────────────────────────────────────────────────────

function mayEditLists(v: Viewer): boolean {
  return canEditLists({ hasPeopleAccess: v.actor.hasPeopleAccess, role: v.role, isFounder: v.isFounder });
}

router.get("/lists", async (_req: Request, res: Response) => {
  try {
    const [classifications, stages] = await Promise.all([loadClassifications(), loadStages()]);
    res.json({ classifications, stages, canEdit: mayEditLists(viewerOf(res)) });
  } catch (err) {
    fail(res, "lists", err, "Couldn't load the lists");
  }
});

const ClassificationBody = z.object({
  label: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  fieldSets: z.array(z.enum(FIELD_SETS)).max(FIELD_SETS.length).optional(),
  evidence: z.enum(EVIDENCE_KINDS).nullable().optional(),
});
const ClassificationPatch = ClassificationBody.partial().extend({ active: z.boolean().optional() });

const refuseLists = (res: Response) =>
  res.status(403).json({ error: "Only Graeme, or an admin with People access, can change these lists." });

router.post("/classifications", validate(ClassificationBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!mayEditLists(viewer)) { refuseLists(res); return; }
  const b = req.body as z.infer<typeof ClassificationBody>;
  try {
    const [max] = await db.select({ m: sql<number>`COALESCE(MAX(sort_order), 0)` }).from(peopleRecordClassificationsTable);
    const [row] = await db.insert(peopleRecordClassificationsTable).values({
      label: b.label, sortOrder: b.sortOrder ?? Number(max?.m ?? 0) + 10,
      fieldSets: cleanFieldSets(b.fieldSets ?? []), evidence: b.evidence ?? null,
    }).returning();
    await audit(db, viewer, { subjectUserId: null, action: "list_add_classification", detail: b.label });
    res.status(201).json(row);
  } catch (err) {
    fail(res, "classification add", err, "Couldn't add the classification");
  }
});

router.patch("/classifications/:id", validate(ClassificationPatch), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!mayEditLists(viewer)) { refuseLists(res); return; }
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such classification" }); return; }
  const b = req.body as z.infer<typeof ClassificationPatch>;
  try {
    const [row] = await db.update(peopleRecordClassificationsTable).set({
      ...(b.label !== undefined ? { label: b.label } : {}),
      ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
      ...(b.fieldSets !== undefined ? { fieldSets: cleanFieldSets(b.fieldSets) } : {}),
      ...(b.evidence !== undefined ? { evidence: b.evidence } : {}),
      ...(b.active !== undefined ? { active: b.active } : {}),
      updatedAt: new Date(),
    }).where(eq(peopleRecordClassificationsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "No such classification" }); return; }
    await audit(db, viewer, { subjectUserId: null, action: "list_edit_classification", detail: `${row.label}: ${Object.keys(b).join(", ")}` });
    res.json(row);
  } catch (err) {
    fail(res, "classification edit", err, "Couldn't save the classification");
  }
});

const StageBody = z.object({
  label: z.string().trim().min(1).max(80),
  rank: z.number().int().min(0).max(10_000),
  type: z.enum(STAGE_TYPES),
  formal: z.boolean(),
  defaultExpiryMonths: z.number().int().min(1).max(60).nullable().optional(),
  optional: z.boolean().optional(),
});
const StagePatch = StageBody.partial().extend({ active: z.boolean().optional() });

router.post("/stages", validate(StageBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!mayEditLists(viewer)) { refuseLists(res); return; }
  const b = req.body as z.infer<typeof StageBody>;
  try {
    const [row] = await db.insert(peopleReviewStagesTable).values({
      label: b.label, rank: b.rank, type: b.type, formal: b.formal,
      defaultExpiryMonths: b.type === "warning" ? (b.defaultExpiryMonths ?? 12) : null, optional: b.optional ?? false,
    }).returning();
    await audit(db, viewer, { subjectUserId: null, action: "list_add_stage", detail: b.label });
    res.status(201).json(row);
  } catch (err) {
    fail(res, "stage add", err, "Couldn't add the stage");
  }
});

router.patch("/stages/:id", validate(StagePatch), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!mayEditLists(viewer)) { refuseLists(res); return; }
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such stage" }); return; }
  const b = req.body as z.infer<typeof StagePatch>;
  try {
    const [row] = await db.update(peopleReviewStagesTable).set({ ...b, updatedAt: new Date() })
      .where(eq(peopleReviewStagesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "No such stage" }); return; }
    await audit(db, viewer, { subjectUserId: null, action: "list_edit_stage", detail: `${row.label}: ${Object.keys(b).join(", ")}` });
    res.json(row);
  } catch (err) {
    fail(res, "stage edit", err, "Couldn't save the stage");
  }
});

// ── One person ─────────────────────────────────────────────────────────────

async function attendanceFacts(userId: number, today: string) {
  try {
    const [u] = await db.select({ plandayId: usersTable.plandayEmployeeId }).from(usersTable).where(eq(usersTable.id, userId));
    if (!u || u.plandayId == null) return null;
    // The Planday mirror as it stands — the record page keeps it synced.
    const shifts = (await loadClassifiedShifts([userId], rollingWindowStart(today), { includeInactive: true })).get(userId) ?? [];
    const s = summariseAttendance(shifts, today);
    return {
      sickInstances: s.sickInstances, sickDays: s.sickDays, lates: s.lates, otherAbsenceDays: s.otherAbsenceDays,
      triggers: s.triggers, policy: s.policy, windowStart: s.windowStart,
    };
  } catch (err) {
    console.warn("[people-reviews] attendance evidence unavailable:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** History lines worth showing on an entry (not every autosave). */
const HISTORY_ACTIONS = ["entry_add", "reclassify", "stage", "open", "close", "extend", "escalate", "warning_withdraw", "letter_draft", "letter_file", "letter_send", "letter_email", "letter_read", "letter_ack"];

router.get("/person/:userId", async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const userId = parseId(req.params["userId"]);
  try {
    if (userId == null || !(await mayOpen(viewer, userId))) { res.status(404).json({ error: "Not found" }); return; }
    const [person] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive }).from(usersTable).where(eq(usersTable.id, userId));
    if (!person) { res.status(404).json({ error: "Not found" }); return; }
    const today = londonTodayIso();
    const entries = await db.select().from(peopleRecordEntriesTable)
      .where(eq(peopleRecordEntriesTable.userId, userId))
      .orderBy(desc(peopleRecordEntriesTable.entryDate), desc(peopleRecordEntriesTable.id));
    const ids = entries.map(e => e.id);
    const [classifications, stages, history, attendance, letters] = await Promise.all([
      loadClassifications(),
      loadStages(),
      ids.length
        ? db.select({ entryId: peopleRecordAuditTable.entryId, action: peopleRecordAuditTable.action, detail: peopleRecordAuditTable.detail, at: peopleRecordAuditTable.at, by: peopleRecordAuditTable.viewerName })
          .from(peopleRecordAuditTable)
          .where(and(inArray(peopleRecordAuditTable.entryId, ids), inArray(peopleRecordAuditTable.action, HISTORY_ACTIONS)))
          .orderBy(asc(peopleRecordAuditTable.at))
        : Promise.resolve([] as Array<{ entryId: number | null; action: string; detail: string | null; at: Date; by: string | null }>),
      attendanceFacts(userId, today),
      ids.length
        ? db.select().from(peopleLettersTable).where(inArray(peopleLettersTable.entryId, ids)).orderBy(asc(peopleLettersTable.createdAt))
        : Promise.resolve([] as Array<typeof peopleLettersTable.$inferSelect>),
    ]);
    const [probation] = await loadProbations([userId]);
    await audit(db, viewer, { subjectUserId: userId, action: "view", detail: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` });
    res.json({
      person, today, viewerId: viewer.actor.id, probation: probation ?? null, periodMonths: PERIOD_MONTHS, canEditLists: mayEditLists(viewer), classifications, stages, attendance,
      entries: entries.map(e => ({
        id: e.id, userId: e.userId, classificationId: e.classificationId, entryDate: e.entryDate, title: e.title,
        notes: e.notes, notesUpdatedByName: e.notesUpdatedByName, notesUpdatedAt: e.notesUpdatedAt,
        status: e.status, closedOn: e.closedOn, reviewStart: e.reviewStart, reviewEnd: e.reviewEnd, outcome: e.outcome, nextReviewDate: e.nextReviewDate,
        stageId: e.stageId, warningExpiresOn: e.warningExpiresOn, warningWithdrawnAt: e.warningWithdrawnAt,
        warningWithdrawnReason: e.warningWithdrawnReason, rating: e.rating, payFrom: e.payFrom, payTo: e.payTo,
        payEffectiveOn: e.payEffectiveOn, probationOutcome: e.probationOutcome, probationNewEnd: e.probationNewEnd,
        fitForWork: e.fitForWork, meetingType: e.meetingType, meetingDate: e.meetingDate, meetingTime: e.meetingTime,
        meetingAttendees: e.meetingAttendees, meetingChecklist: e.meetingChecklist,
        createdByName: e.createdByName, createdAt: e.createdAt, updatedAt: e.updatedAt,
        history: history.filter(h => h.entryId === e.id).map(h => ({ action: h.action, detail: h.detail, at: h.at, by: h.by })),
        letters: letters.filter(l => l.entryId === e.id).map(l => ({
          id: l.id, templateId: l.templateId, title: l.title, body: l.body, status: l.status, signatoryName: l.signatoryName,
          documentId: l.documentId, filedAt: l.filedAt, sentAt: l.sentAt, sentByName: l.sentByName, emailedTo: l.emailedTo,
          emailedAt: l.emailedAt, readAt: l.readAt, acknowledgedAt: l.acknowledgedAt, createdByName: l.createdByName,
          createdAt: l.createdAt, updatedAt: l.updatedAt,
        })),
      })),
    });
  } catch (err) {
    fail(res, "person", err, "Couldn't load the record");
  }
});

// ── Entries ────────────────────────────────────────────────────────────────

const EntryFields = z.object({
  classificationId: z.number().int().positive(),
  entryDate: isoDate,
  title: z.string().max(400),
  notes: z.string().max(TEXT_MAX).nullable(),
  status: z.enum(ENTRY_STATUSES),
  reviewStart: isoDate.nullable(),
  reviewEnd: isoDate.nullable(),
  outcome: z.string().max(TEXT_MAX).nullable(),
  nextReviewDate: isoDate.nullable(),
  stageId: z.number().int().positive().nullable(),
  warningExpiresOn: isoDate.nullable(),
  rating: z.enum(RATINGS).nullable(),
  payFrom: z.string().max(200).nullable(),
  payTo: z.string().max(200).nullable(),
  payEffectiveOn: isoDate.nullable(),
  probationOutcome: z.enum(PROBATION_OUTCOMES).nullable(),
  probationNewEnd: isoDate.nullable(),
  fitForWork: z.enum(FIT_FOR_WORK).nullable(),
  meetingType: z.enum(MEETING_TYPES).nullable(),
  meetingDate: isoDate.nullable(),
  meetingTime: hhmm.nullable(),
  meetingAttendees: z.string().max(2000).nullable(),
  meetingChecklist: z.array(z.string().max(60)).max(20),
});
type EntryPatch = Partial<z.infer<typeof EntryFields>>;
const EntryPatchBody = EntryFields.partial();
const EntryCreateBody = EntryFields.partial().extend({ classificationId: z.number().int().positive() });

class Refusal extends Error { constructor(public status: number, message: string) { super(message); } }

/** Keep the linked to-do in step with a date: make, move, or close it. */
async function syncTodo(tx: Exec, viewer: Viewer, kind: TodoKind, row: EntryRow, subjectName: string,
  prev: { todoId: number | null; date: string | null; time?: string | null }, next: { date: string | null; time?: string | null }): Promise<number | null> {
  const action = planTodo(prev, next);
  if (action === "none") return prev.todoId;
  if (action === "cancel") {
    await tx.execute(sql`
      UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW(), title = 'Cancelled — ' || title
       WHERE id = ${prev.todoId} AND status = 'open'
    `);
    return null;
  }
  const t = recordTodo({
    kind, ownerId: viewer.actor.id, ownerName: viewer.name, subjectUserId: row.userId, subjectName,
    entryId: row.id, date: next.date!, time: next.time ?? null,
  });
  if (action === "update") {
    const upd = await tx.execute<{ id: number }>(sql`
      UPDATE todo_tasks SET title = ${t.title}, scheduled_for = ${t.scheduledFor}, due_date = ${t.dueDate}, updated_at = NOW()
       WHERE id = ${prev.todoId} AND status = 'open' RETURNING id
    `);
    if (upd.rows.length > 0) return prev.todoId;
    // Already ticked off — a new date gets a new to-do.
  }
  // Self-raised, so already acknowledged — no full-screen "seen it?" prompt.
  const ins = await tx.execute<{ id: number }>(sql`
    INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, scheduled_for, due_date, status, acknowledged_at)
    VALUES (${t.assigneeId}, ${t.createdBy}, ${t.createdByName}, ${t.title}, ${t.notes}, ${t.url}, ${t.priority},
            ${t.scheduledFor}, ${t.dueDate}, 'open', NOW())
    RETURNING id
  `);
  return Number(ins.rows[0].id);
}

/** Apply a change to an entry — the one path for both add and edit. Every
 *  value is stored whatever the classification; the screen shows only the
 *  field sets the classification uses, so reclassifying never loses data. */
async function applyChange(tx: Exec, viewer: Viewer, row: EntryRow, b: EntryPatch, ctx: {
  classifications: Classification[]; stages: Stage[]; created: boolean;
}): Promise<void> {
  const today = londonTodayIso();
  const set: Partial<typeof peopleRecordEntriesTable.$inferInsert> = { updatedAt: new Date() };
  const changed = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);

  const cls = new Map(ctx.classifications.map(c => [c.id, c]));
  if (b.classificationId !== undefined && b.classificationId !== row.classificationId) {
    const to = cls.get(b.classificationId);
    if (!to) throw new Refusal(400, "No such classification");
    set.classificationId = to.id;
    if (!ctx.created) {
      await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "reclassify", detail: reclassify(cls.get(row.classificationId), to).message });
    }
  }
  for (const k of ["entryDate", "title", "reviewStart", "reviewEnd", "outcome", "rating", "payFrom", "payTo", "payEffectiveOn", "probationOutcome",
    "probationNewEnd", "fitForWork", "meetingAttendees"] as const) {
    if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
  }
  if (b.notes !== undefined) {
    set.notes = b.notes;
    set.notesUpdatedByName = viewer.name;
    set.notesUpdatedAt = new Date();
  }

  // Stage + warning expiry.
  const entryDate = b.entryDate ?? row.entryDate;
  let stageId = row.stageId;
  if (b.stageId !== undefined) {
    stageId = b.stageId;
    if (stageId != null && !ctx.stages.some(s => s.id === stageId)) throw new Refusal(400, "No such stage");
    set.stageId = stageId;
  }
  const stage = stageId != null ? ctx.stages.find(s => s.id === stageId) ?? null : null;
  let expires = b.warningExpiresOn !== undefined ? b.warningExpiresOn : row.warningExpiresOn;
  if (b.stageId !== undefined && b.stageId !== row.stageId && b.warningExpiresOn === undefined && stage?.type === "warning") {
    // A newly picked warning stage starts from its own default expiry.
    expires = null;
  }
  expires = expiryForStage(stage, entryDate, expires);
  if (expires && stage?.type === "warning") {
    const bad = checkWarningDates(entryDate, expires);
    if (bad) throw new Refusal(400, bad);
  }
  if (expires !== row.warningExpiresOn) set.warningExpiresOn = expires;
  if (b.stageId !== undefined && b.stageId !== row.stageId && !ctx.created) {
    await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "stage", detail: `Stage: ${stage?.label ?? "none"}` });
  }

  // Open / closed.
  if (b.status !== undefined && b.status !== row.status) {
    set.status = b.status;
    set.closedOn = b.status === "closed" ? today : null;
    // Opening a review starts its period today unless one was given.
    if (b.status === "open" && b.reviewStart === undefined && !row.reviewStart) set.reviewStart = today;
    await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: b.status === "open" ? "open" : "close",
      detail: b.status === "open" ? "Marked open — in review" : "Review closed" });
  }

  // Meeting + its to-do; next review date + its to-do.
  const meetingType = (b.meetingType !== undefined ? b.meetingType : row.meetingType) as MeetingType | null;
  if (b.meetingType !== undefined) set.meetingType = b.meetingType;
  if (b.meetingDate !== undefined) set.meetingDate = b.meetingDate;
  if (b.meetingTime !== undefined) set.meetingTime = b.meetingTime;
  if (b.meetingChecklist !== undefined || b.meetingType !== undefined) {
    set.meetingChecklist = cleanChecklist(meetingType, b.meetingChecklist ?? row.meetingChecklist ?? []);
  }
  if (b.nextReviewDate !== undefined) set.nextReviewDate = b.nextReviewDate;
  const touchesMeeting = b.meetingDate !== undefined || b.meetingTime !== undefined;
  if (touchesMeeting || b.nextReviewDate !== undefined) {
    const [subject] = await tx.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.userId));
    const name = subject?.name ?? "";
    if (touchesMeeting) {
      set.meetingTodoId = await syncTodo(tx, viewer, "meeting", row, name,
        { todoId: row.meetingTodoId, date: row.meetingDate, time: row.meetingTime },
        { date: b.meetingDate !== undefined ? b.meetingDate : row.meetingDate, time: b.meetingTime !== undefined ? b.meetingTime : row.meetingTime });
    }
    if (b.nextReviewDate !== undefined) {
      set.reviewTodoId = await syncTodo(tx, viewer, "review", row, name,
        { todoId: row.reviewTodoId, date: row.nextReviewDate }, { date: b.nextReviewDate });
    }
  }

  await tx.update(peopleRecordEntriesTable).set(set).where(eq(peopleRecordEntriesTable.id, row.id));
  if (!ctx.created && changed.length > 0) {
    await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "edit", detail: changed.join(", ") });
  }
}

router.post(
  "/person/:userId/entries",
  employmentRecordWrite({ subject: fromParam("userId") }),
  validate(EntryCreateBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const userId = parseId(req.params["userId"]);
    if (userId == null) { res.status(400).json({ error: "Invalid person" }); return; }
    const b = req.body as z.infer<typeof EntryCreateBody>;
    try {
      if (!(await mayOpen(viewer, userId))) { res.status(404).json({ error: "Not found" }); return; }
      const [classifications, stages] = await Promise.all([loadClassifications(), loadStages()]);
      const cls = classifications.find(c => c.id === b.classificationId);
      if (!cls) { res.status(400).json({ error: "No such classification" }); return; }
      const id = await db.transaction(async tx => {
        const [row] = await tx.insert(peopleRecordEntriesTable).values({
          userId, classificationId: cls.id, entryDate: b.entryDate ?? londonTodayIso(), title: b.title ?? "",
          createdById: viewer.actor.id, createdByName: viewer.name,
        }).returning();
        await audit(tx, viewer, { subjectUserId: userId, entryId: row.id, action: "entry_add", detail: `Added as ${cls.label}` });
        const { classificationId: _c, entryDate: _d, title: _t, ...rest } = b;
        await applyChange(tx, viewer, row, rest, { classifications, stages, created: true });
        return row.id;
      });
      resyncAttentionSoon();
      res.status(201).json({ id });
    } catch (err) {
      if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
      fail(res, "add entry", err, "Couldn't add to the record");
    }
  },
);

const entryOwner = ownerOf("people_record_entries");

router.patch(
  "/entries/:id",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(EntryPatchBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      const [classifications, stages] = await Promise.all([loadClassifications(), loadStages()]);
      await db.transaction(tx => applyChange(tx, viewer, row, req.body as EntryPatch, { classifications, stages, created: false }));
      resyncAttentionSoon();
      const [fresh] = await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, row.id));
      res.json({ ok: true, warningExpiresOn: fresh?.warningExpiresOn ?? null, status: fresh?.status ?? row.status });
    } catch (err) {
      if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
      fail(res, "edit entry", err, "Couldn't save");
    }
  },
);

const WithdrawBody = z.object({ reason: z.string().trim().min(1, "Say why it's withdrawn").max(2000) });

router.post(
  "/entries/:id/withdraw-warning",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(WithdrawBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    const b = req.body as z.infer<typeof WithdrawBody>;
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      const [classifications, stages] = await Promise.all([loadClassifications(), loadStages()]);
      if (!entryWarning(asEntryLike(row), classifications, stages)) { res.status(409).json({ error: "This entry isn't a warning." }); return; }
      if (row.warningWithdrawnAt) { res.status(409).json({ error: "Already withdrawn." }); return; }
      await db.transaction(async tx => {
        await tx.update(peopleRecordEntriesTable).set({ warningWithdrawnAt: new Date(), warningWithdrawnReason: b.reason, updatedAt: new Date() })
          .where(eq(peopleRecordEntriesTable.id, row.id));
        await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "warning_withdraw", detail: `Warning withdrawn: ${b.reason}` });
      });
      resyncAttentionSoon();
      res.json({ ok: true });
    } catch (err) {
      fail(res, "withdraw warning", err, "Couldn't withdraw the warning");
    }
  },
);

// ── Letters ────────────────────────────────────────────────────────────────
//
//   GET   /letter-templates                 the templates (+ merge fields)
//   PATCH /letter-templates/:id             edit wording / turn off   (founder only)
//   POST  /entries/:id/letters              { templateId } → a draft, filled from the entry
//   PATCH /letters/:id                      title / body / signatory — draft only (autosaved)
//   GET   /letters/:id/preview.pdf          the PDF as it stands (read)
//   POST  /letters/:id/file                 PDF into their Documents, NOT shared
//   POST  /letters/:id/send                 { email } — share it with them; optionally
//                                           email "a letter is waiting" (never the PDF)
// Never automatic: filing and sending are each a deliberate tap, confirmed.

type TemplateRow = typeof peopleLetterTemplatesTable.$inferSelect;
type LetterRow = typeof peopleLettersTable.$inferSelect;

function asTemplate(t: TemplateRow): LetterTemplate {
  return {
    id: t.id, key: t.key, title: t.title, body: t.body, fieldSet: (t.fieldSet as FieldSet | null) ?? null,
    stageId: t.stageId, stageType: (t.stageType as StageType | null) ?? null,
    probationOutcome: (t.probationOutcome as ProbationOutcome | null) ?? null,
    requiresMeeting: t.requiresMeeting, requiresPay: t.requiresPay, sortOrder: t.sortOrder, active: t.active,
  };
}

async function loadTemplates(): Promise<LetterTemplate[]> {
  return (await db.select().from(peopleLetterTemplatesTable)).map(asTemplate);
}

router.get("/letter-templates", async (_req: Request, res: Response) => {
  try {
    const templates = (await loadTemplates()).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    res.json({ templates, mergeFields: MERGE_FIELDS, canEdit: viewerOf(res).isFounder });
  } catch (err) {
    fail(res, "letter templates", err, "Couldn't load the letter templates");
  }
});

const TemplatePatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().min(1).max(TEXT_MAX).optional(),
  active: z.boolean().optional(),
});

router.patch("/letter-templates/:id", validate(TemplatePatch), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!viewer.isFounder) { res.status(403).json({ error: "Only Graeme can change the letter templates." }); return; }
  const id = parseId(req.params["id"]);
  if (id == null) { res.status(404).json({ error: "No such template" }); return; }
  const b = req.body as z.infer<typeof TemplatePatch>;
  try {
    const [row] = await db.update(peopleLetterTemplatesTable)
      .set({ ...b, updatedByName: viewer.name, updatedAt: new Date() })
      .where(eq(peopleLetterTemplatesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "No such template" }); return; }
    await audit(db, viewer, { subjectUserId: null, action: "list_edit_letter_template", detail: `${row.key}: ${Object.keys(b).join(", ")}` });
    res.json(asTemplate(row));
  } catch (err) {
    fail(res, "letter template edit", err, "Couldn't save the template");
  }
});

// Who the "a letter is waiting" emails come from — founder-edited.
async function letterEmailIdentity() {
  const [row] = await db.select().from(peopleHrSettingsTable).where(eq(peopleHrSettingsTable.id, 1));
  const settings = { fromName: row?.fromName ?? null, fromLocal: row?.fromLocal ?? null, replyTo: row?.replyTo ?? null };
  return {
    settings, identity: hrEmailIdentity(settings, FROM_EMAIL, FOUNDER_EMAIL), updatedByName: row?.updatedByName ?? null,
    leadTimes: await attentionSettings(),
  };
}

router.get("/hr-settings", async (_req: Request, res: Response) => {
  try {
    const { settings, identity, updatedByName, leadTimes } = await letterEmailIdentity();
    const viewer = viewerOf(res);
    res.json({ canEdit: viewer.isFounder, settings: viewer.isFounder ? settings : null, identity, updatedByName, leadTimes });
  } catch (err) {
    fail(res, "letter settings", err, "Couldn't load the email settings");
  }
});

const LetterSettingsPatch = z.object({
  fromName: z.string().max(80).nullable().optional(),
  fromLocal: z.string().max(64).nullable().optional(),
  replyTo: z.string().max(254).nullable().optional(),
  probationDays: z.number().int().min(1).max(90).optional(),
  reviewDays: z.number().int().min(1).max(90).optional(),
  warningDays: z.number().int().min(1).max(90).optional(),
});

router.patch("/hr-settings", validate(LetterSettingsPatch), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  if (!viewer.isFounder) { res.status(403).json({ error: "Only Graeme can change the HR settings." }); return; }
  const b = req.body as z.infer<typeof LetterSettingsPatch>;
  const bad = checkHrEmailSettings({ fromName: b.fromName ?? null, fromLocal: b.fromLocal ?? null, replyTo: b.replyTo ?? null });
  if (bad) { res.status(400).json({ error: bad }); return; }
  const blankToNull = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());
  try {
    const set: Partial<typeof peopleHrSettingsTable.$inferInsert> = { updatedByName: viewer.name, updatedAt: new Date() };
    if (b.fromName !== undefined) set.fromName = blankToNull(b.fromName);
    if (b.fromLocal !== undefined) set.fromLocal = blankToNull(b.fromLocal)?.toLowerCase() ?? null;
    if (b.replyTo !== undefined) set.replyTo = blankToNull(b.replyTo);
    if (b.probationDays !== undefined) set.probationDays = b.probationDays;
    if (b.reviewDays !== undefined) set.reviewDays = b.reviewDays;
    if (b.warningDays !== undefined) set.warningDays = b.warningDays;
    await db.insert(peopleHrSettingsTable).values({ id: 1, ...set })
      .onConflictDoUpdate({ target: peopleHrSettingsTable.id, set });
    await audit(db, viewer, { subjectUserId: null, action: "list_edit_hr_settings", detail: Object.keys(b).join(", ") });
    resyncAttentionSoon();
    res.json((await letterEmailIdentity()).identity);
  } catch (err) {
    fail(res, "letter settings edit", err, "Couldn't save the email settings");
  }
});

const NewLetterBody = z.object({ templateId: z.number().int().positive() });

router.post(
  "/entries/:id/letters",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(NewLetterBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    const { templateId } = req.body as z.infer<typeof NewLetterBody>;
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      const [classifications, stages, templates] = await Promise.all([loadClassifications(), loadStages(), loadTemplates()]);
      const offered = templatesForEntry({
        classificationId: row.classificationId, stageId: row.stageId,
        probationOutcome: (row.probationOutcome as ProbationOutcome | null) ?? null, meetingDate: row.meetingDate, payTo: row.payTo,
      }, classifications, stages, templates);
      const tpl = offered.find(t => t.id === templateId);
      if (!tpl) { res.status(400).json({ error: "That letter doesn't fit this entry." }); return; }
      const [person] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.userId));
      const stage = effectiveStage(asEntryLike(row), classifications, stages);
      const values = letterMergeValues({
        todayIso: londonTodayIso(),
        personName: person?.name ?? "",
        classificationLabel: classifications.find(c => c.id === row.classificationId)?.label ?? "",
        entry: {
          title: row.title, outcome: row.outcome, stageLabel: stage?.label ?? null, warningExpiresOn: row.warningExpiresOn,
          nextReviewDate: row.nextReviewDate, meetingType: (row.meetingType as MeetingType | null) ?? null,
          meetingDate: row.meetingDate, meetingTime: row.meetingTime, payFrom: row.payFrom, payTo: row.payTo,
          payEffectiveOn: row.payEffectiveOn, probationOutcome: (row.probationOutcome as ProbationOutcome | null) ?? null,
          probationNewEnd: row.probationNewEnd,
        },
        signatoryName: viewer.name,
        signatoryIsFounder: viewer.isFounder,
      });
      const filled = fillTemplate(tpl.body, values);
      const letterId = await db.transaction(async tx => {
        const [l] = await tx.insert(peopleLettersTable).values({
          entryId: row.id, userId: row.userId, templateId: tpl.id, title: tpl.title, body: filled.text,
          signatoryName: viewer.name, createdById: viewer.actor.id, createdByName: viewer.name,
        }).returning({ id: peopleLettersTable.id });
        await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "letter_draft", detail: `Letter drafted: ${tpl.title}` });
        return l.id;
      });
      res.status(201).json({ id: letterId, gaps: filled.gaps });
    } catch (err) {
      fail(res, "new letter", err, "Couldn't start the letter");
    }
  },
);

const letterOwner = ownerOf("people_letters");

/** Load a letter this viewer may work on, or answer 404. */
async function loadLetter(req: Request, res: Response): Promise<LetterRow | null> {
  const id = parseId(req.params["id"]);
  const [l] = id == null ? [] : await db.select().from(peopleLettersTable).where(eq(peopleLettersTable.id, id));
  if (!l || !(await mayOpen(viewerOf(res), l.userId))) { res.status(404).json({ error: "No such letter" }); return null; }
  return l;
}

const LetterPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().max(TEXT_MAX).optional(),
});

router.patch(
  "/letters/:id",
  employmentRecordWrite({ subject: fromRow("id", letterOwner), refuseAs404: true }),
  validate(LetterPatch),
  async (req: Request, res: Response) => {
    try {
      const l = await loadLetter(req, res);
      if (!l) return;
      const gate = checkLetterAction({ status: l.status as LetterStatus, acknowledgedAt: null }, "edit");
      if (!gate.ok) { res.status(409).json({ error: gate.error }); return; }
      const b = req.body as z.infer<typeof LetterPatch>;
      await db.update(peopleLettersTable).set({ ...b, updatedAt: new Date() }).where(eq(peopleLettersTable.id, l.id));
      res.json({ ok: true, gaps: letterGaps(b.body ?? l.body) });
    } catch (err) {
      fail(res, "edit letter", err, "Couldn't save the letter");
    }
  },
);

router.get("/letters/:id/preview.pdf", async (req: Request, res: Response) => {
  try {
    const l = await loadLetter(req, res);
    if (!l) return;
    const pdf = await renderContractPdf(l.body, { title: `${l.title} — The Calzone Kitchen` });
    await audit(db, viewerOf(res), { subjectUserId: l.userId, entryId: l.entryId, action: "letter_view", detail: l.title });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="letter-${l.id}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(pdf);
  } catch (err) {
    fail(res, "letter preview", err, "Couldn't make the PDF");
  }
});

/** Make the PDF and file it in their Documents (not shared). Returns the document id. */
async function fileLetter(tx: Exec, viewer: Viewer, l: LetterRow): Promise<number> {
  const gaps = letterGaps(l.body);
  if (gaps.length > 0) throw new Refusal(400, `Fill in the gaps first: ${gaps.map(g => `[${g}]`).join(", ")}`);
  const pdf = await renderContractPdf(l.body, { title: `${l.title} — The Calzone Kitchen` });
  const today = londonTodayIso();
  const [doc] = await tx.insert(personDocumentsTable).values({
    userId: l.userId, kind: "letter", title: l.title, documentDate: today,
    notes: "Made from their employment record (Reviews & letters).",
    fileName: `${l.title.replace(/[^A-Za-z0-9]+/g, "-")}-${today}.pdf`, mime: "application/pdf", byteSize: pdf.length, data: pdf,
    visibility: "people", sharedWithEmployee: false, uploadedByUserId: viewer.actor.id, uploadedByName: viewer.name,
  }).returning({ id: personDocumentsTable.id });
  await tx.update(peopleLettersTable).set({ status: "filed", documentId: doc.id, filedAt: new Date(), updatedAt: new Date() })
    .where(eq(peopleLettersTable.id, l.id));
  await audit(tx, viewer, { subjectUserId: l.userId, entryId: l.entryId, action: "letter_file", detail: `Letter filed in Documents: ${l.title}` });
  return doc.id;
}

router.post(
  "/letters/:id/file",
  employmentRecordWrite({ subject: fromRow("id", letterOwner), refuseAs404: true }),
  validate(z.object({})),
  async (req: Request, res: Response) => {
    try {
      const l = await loadLetter(req, res);
      if (!l) return;
      const gate = checkLetterAction({ status: l.status as LetterStatus, acknowledgedAt: null }, "file");
      if (!gate.ok) { res.status(409).json({ error: gate.error }); return; }
      const documentId = await db.transaction(tx => fileLetter(tx, viewerOf(res), l));
      res.json({ ok: true, documentId });
    } catch (err) {
      if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
      fail(res, "file letter", err, "Couldn't file the letter");
    }
  },
);

const SendBody = z.object({ email: z.boolean() });

router.post(
  "/letters/:id/send",
  employmentRecordWrite({ subject: fromRow("id", letterOwner), refuseAs404: true }),
  validate(SendBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const { email } = req.body as z.infer<typeof SendBody>;
    try {
      const l = await loadLetter(req, res);
      if (!l) return;
      const gate = checkLetterAction({ status: l.status as LetterStatus, acknowledgedAt: null }, "send");
      if (!gate.ok) { res.status(409).json({ error: gate.error }); return; }
      const [person] = await db.select({ name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive })
        .from(usersTable).where(eq(usersTable.id, l.userId));
      if (!person?.isActive) { res.status(409).json({ error: "They don't have an active account, so they can't read it in the app. File it and give them a copy instead." }); return; }
      await db.transaction(async tx => {
        const documentId = l.status === "draft" ? await fileLetter(tx, viewer, l) : l.documentId;
        if (documentId != null) {
          await tx.update(personDocumentsTable).set({ sharedWithEmployee: true, updatedAt: new Date(), updatedByUserId: viewer.actor.id })
            .where(eq(personDocumentsTable.id, documentId));
        }
        await tx.update(peopleLettersTable).set({ status: "sent", sentAt: new Date(), sentByName: viewer.name, updatedAt: new Date() })
          .where(eq(peopleLettersTable.id, l.id));
        await audit(tx, viewer, { subjectUserId: l.userId, entryId: l.entryId, action: "letter_send", detail: `Letter sent in the app: ${l.title}` });
      });
      // The email only says a letter is waiting — never the letter. A failed
      // email doesn't undo the send; it's reported back, not swallowed.
      let emailed: { to: string } | null = null;
      let emailError: string | null = null;
      if (email && person.email) {
        try {
          const appUrl = process.env["APP_URL"] ?? "https://tck-production-planner-dev-production.up.railway.app";
          const m = letterWaitingEmail(person.name, appUrl);
          const { identity } = await letterEmailIdentity();
          await sendEmail({
            to: person.email, subject: m.subject, text: m.text, html: m.html,
            fromName: identity.fromName, fromEmail: identity.fromEmail, replyTo: identity.replyTo,
          });
          await db.update(peopleLettersTable).set({ emailedTo: person.email, emailedAt: new Date() }).where(eq(peopleLettersTable.id, l.id));
          await audit(db, viewer, { subjectUserId: l.userId, entryId: l.entryId, action: "letter_email", detail: `Email sent to ${person.email}: a letter is waiting` });
          emailed = { to: person.email };
        } catch (e) {
          emailError = e instanceof Error ? e.message : "The email didn't go";
          console.error("[people-reviews] letter email failed:", emailError);
        }
      }
      res.json({ ok: true, emailed, emailError });
    } catch (err) {
      if (err instanceof Refusal) { res.status(err.status).json({ error: err.message }); return; }
      fail(res, "send letter", err, "Couldn't send the letter");
    }
  },
);

// ── Needs attention + review periods + probation ───────────────────────────
//
//   GET  /attention                       this viewer's queue (never their own record)
//   POST /entries/:id/extend              { months } | { endDate } — history kept
//   POST /entries/:id/escalate            a NEW entry at the next stage, open
//   POST /entries/:id/begin-dismissal     a NEW entry: disciplinary hearing booked
//                                         later, checklist shown — never ends
//                                         employment automatically
//   POST /person/:userId/probation        { action: set | extend | passed | not_passed }

router.get("/attention", async (_req: Request, res: Response) => {
  const viewer = viewerOf(res);
  try {
    const items = await attentionForViewer(viewer.actor);
    const userIds = [...new Set(items.map(i => i.userId))];
    const entryIds = [...new Set(items.map(i => i.entryId).filter((x): x is number => x != null))];
    const [people, entries, classifications, stages, probations] = await Promise.all([
      userIds.length ? db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : Promise.resolve([] as Array<{ id: number; name: string }>),
      entryIds.length ? db.select().from(peopleRecordEntriesTable).where(inArray(peopleRecordEntriesTable.id, entryIds)) : Promise.resolve([] as EntryRow[]),
      loadClassifications(), loadStages(), loadProbations(userIds),
    ]);
    const today = londonTodayIso();
    const attendance = new Map<number, Awaited<ReturnType<typeof attendanceFacts>>>();
    for (const e of entries) {
      const c = classifications.find(x => x.id === e.classificationId);
      if (c?.evidence && !attendance.has(e.userId)) attendance.set(e.userId, await attendanceFacts(e.userId, today));
    }
    await audit(db, viewer, { subjectUserId: null, action: "view_attention", detail: `${items.length} item(s)` });
    res.json({
      today,
      items: items.map(i => {
        const e = entries.find(x => x.id === i.entryId) ?? null;
        const cls = e ? classifications.find(c => c.id === e.classificationId) ?? null : null;
        const stage = e ? effectiveStage(asEntryLike(e), classifications, stages) : null;
        return {
          ...i,
          line: attentionLine(i),
          person: people.find(p => p.id === i.userId) ?? { id: i.userId, name: "Someone" },
          entry: e && {
            id: e.id, title: e.title, classification: cls?.label ?? null, evidence: cls?.evidence ?? null, entryDate: e.entryDate,
            reviewStart: e.reviewStart, reviewEnd: e.reviewEnd, stage: stage?.label ?? null, status: e.status,
            canEscalate: !!cls?.fieldSets.includes("stage") && nextStage(e.stageId, stages) != null,
            usesStage: !!cls?.fieldSets.includes("stage"),
          },
          probation: i.kind === "probation_due" ? probations.find(p => p.userId === i.userId) ?? null : null,
          attendance: attendance.get(i.userId) ?? null,
        };
      }),
    });
  } catch (err) {
    fail(res, "attention", err, "Couldn't load what needs attention");
  }
});

const ExtendBody = z.object({
  months: z.number().int().min(1).max(24).nullable().optional(),
  endDate: isoDate.nullable().optional(),
});

router.post(
  "/entries/:id/extend",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(ExtendBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    const b = req.body as z.infer<typeof ExtendBody>;
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      const today = londonTodayIso();
      const r = extendedEnd(row.reviewEnd, today, b);
      if (!r.ok) { res.status(400).json({ error: r.error }); return; }
      const message = extensionMessage(b.endDate ? null : b.months ?? null, r.end);
      await db.transaction(async tx => {
        await tx.update(peopleRecordEntriesTable).set({
          reviewEnd: r.end, reviewStart: row.reviewStart ?? today, status: "open", closedOn: null, updatedAt: new Date(),
        }).where(eq(peopleRecordEntriesTable.id, row.id));
        await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action: "extend", detail: message });
      });
      resyncAttentionSoon();
      res.json({ ok: true, reviewEnd: r.end, message });
    } catch (err) {
      fail(res, "extend", err, "Couldn't extend it");
    }
  },
);

/** Make a follow-on entry (escalate / begin dismissal) from an existing one. */
async function followOn(viewer: Viewer, row: EntryRow, values: Partial<typeof peopleRecordEntriesTable.$inferInsert>, action: string, detail: string) {
  return db.transaction(async tx => {
    const today = londonTodayIso();
    const [n] = await tx.insert(peopleRecordEntriesTable).values({
      userId: row.userId, classificationId: row.classificationId, entryDate: today, status: "open", reviewStart: today,
      createdById: viewer.actor.id, createdByName: viewer.name, ...values,
    }).returning();
    await audit(tx, viewer, { subjectUserId: row.userId, entryId: n.id, action: "entry_add", detail });
    await audit(tx, viewer, { subjectUserId: row.userId, entryId: row.id, action, detail });
    return n.id;
  });
}

router.post(
  "/entries/:id/escalate",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(z.object({ stageId: z.number().int().positive().nullable().optional() })),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      const [classifications, stages] = await Promise.all([loadClassifications(), loadStages()]);
      const cls = classifications.find(c => c.id === row.classificationId);
      if (!cls?.fieldSets.includes("stage")) { res.status(400).json({ error: "This kind of entry doesn't have stages." }); return; }
      const asked = (req.body as { stageId?: number | null }).stageId;
      const target = asked != null ? stages.find(s => s.id === asked) ?? null : nextStage(row.stageId, stages);
      const current = row.stageId != null ? stages.find(s => s.id === row.stageId) : undefined;
      if (!target || (current && target.rank <= current.rank)) { res.status(400).json({ error: "There's no further stage to move to — pick one, or close it." }); return; }
      const today = londonTodayIso();
      const newId = await followOn(viewer, row, {
        title: row.title, stageId: target.id, warningExpiresOn: expiryForStage(target, today, null),
      }, "escalate", `Escalated to ${target.label}`);
      // The earlier entry's review is over — it's carried on by the new one.
      await db.update(peopleRecordEntriesTable).set({ status: "closed", closedOn: today, updatedAt: new Date() })
        .where(and(eq(peopleRecordEntriesTable.id, row.id), eq(peopleRecordEntriesTable.status, "open")));
      resyncAttentionSoon();
      res.status(201).json({ id: newId });
    } catch (err) {
      fail(res, "escalate", err, "Couldn't escalate it");
    }
  },
);

router.post(
  "/entries/:id/begin-dismissal",
  employmentRecordWrite({ subject: fromRow("id", entryOwner), refuseAs404: true }),
  validate(z.object({ confirm: z.literal(true) })),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const id = parseId(req.params["id"]);
    try {
      const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
      if (!row || !(await mayOpen(viewer, row.userId))) { res.status(404).json({ error: "No such entry" }); return; }
      // A formal hearing where dismissal is a possible outcome — the stage
      // stays where it is until the hearing decides. Nothing about their
      // employment changes in the app.
      const newId = await followOn(viewer, row, {
        title: `Disciplinary hearing — dismissal is a possible outcome${row.title ? ` (${row.title})` : ""}`,
        stageId: row.stageId, meetingType: "disciplinary",
      }, "dismissal_process", "Dismissal process started — hearing to be arranged");
      resyncAttentionSoon();
      res.status(201).json({ id: newId });
    } catch (err) {
      fail(res, "begin dismissal", err, "Couldn't start that");
    }
  },
);

const ProbationBody = z.object({
  action: z.enum(["set", "extend", "passed", "not_passed"]),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  months: z.number().int().min(1).max(24).optional(),
});

router.post(
  "/person/:userId/probation",
  employmentRecordWrite({ subject: fromParam("userId") }),
  validate(ProbationBody),
  async (req: Request, res: Response) => {
    const viewer = viewerOf(res);
    const userId = parseId(req.params["userId"]);
    const b = req.body as z.infer<typeof ProbationBody>;
    try {
      if (userId == null || !(await mayOpen(viewer, userId))) { res.status(404).json({ error: "Not found" }); return; }
      const today = londonTodayIso();
      const [current] = await loadProbations([userId]);
      let startDate = current?.startDate ?? null;
      let endDate = current?.endDate ?? null;
      let outcome: "passed" | "not_passed" | null = current?.outcome ?? null;
      let detail: string;
      if (b.action === "set") {
        startDate = b.startDate ?? startDate;
        if (!startDate) { res.status(400).json({ error: "When did they start?" }); return; }
        endDate = b.endDate ?? (b.months ? periodEnd(startDate, b.months) : endDate);
        if (!endDate || endDate < startDate) { res.status(400).json({ error: "Give an end date after the start." }); return; }
        detail = `Probation set: ${startDate} to ${endDate}`;
      } else if (b.action === "extend") {
        if (!startDate || !endDate) { res.status(400).json({ error: "Set their probation dates first." }); return; }
        const r = extendedEnd(endDate, today, { months: b.months ?? null, endDate: b.endDate ?? null });
        if (!r.ok) { res.status(400).json({ error: r.error }); return; }
        endDate = r.end;
        outcome = null;
        detail = `Probation ${extensionMessage(b.endDate ? null : b.months ?? null, r.end).toLowerCase()}`;
      } else {
        if (!startDate || !endDate) { res.status(400).json({ error: "Set their probation dates first." }); return; }
        outcome = b.action;
        detail = b.action === "passed" ? "Probation passed" : "Probation not passed";
      }
      // The decision also goes on the record as a Probation review entry
      // (the classification that uses the probation field set).
      const classifications = await loadClassifications();
      const probationCls = classifications.find(c => c.active && c.fieldSets.includes("probation"));
      await db.transaction(async tx => {
        await tx.execute(sql`
          INSERT INTO people_probation (user_id, start_date, end_date, outcome, decided_on, updated_by_name, updated_at)
          VALUES (${userId}, ${startDate}, ${endDate}, ${outcome}, ${outcome ? today : null}, ${viewer.name}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
            outcome = EXCLUDED.outcome, decided_on = EXCLUDED.decided_on, updated_by_name = EXCLUDED.updated_by_name, updated_at = NOW()
        `);
        let entryId: number | null = null;
        if (b.action !== "set" && probationCls) {
          const [n] = await tx.insert(peopleRecordEntriesTable).values({
            userId, classificationId: probationCls.id, entryDate: today, title: detail, status: "closed",
            probationOutcome: b.action === "extend" ? "extended" : b.action, probationNewEnd: b.action === "extend" ? endDate : null,
            createdById: viewer.actor.id, createdByName: viewer.name,
          }).returning({ id: peopleRecordEntriesTable.id });
          entryId = n.id;
        }
        await audit(tx, viewer, { subjectUserId: userId, entryId, action: b.action === "set" ? "probation_set" : "entry_add", detail });
      });
      resyncAttentionSoon();
      res.json({ ok: true, probation: (await loadProbations([userId]))[0] ?? null });
    } catch (err) {
      fail(res, "probation", err, "Couldn't save the probation");
    }
  },
);

export default router;
