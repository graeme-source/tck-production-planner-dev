/**
 * Forced testing — the people side (Graeme, 2026-10-10; Objectives E and F).
 * Mounted at /api/test-requests behind the session guard.
 *
 * Anyone signed in:
 *   GET  /mine               the tests still waiting on me (the card)
 *   POST /:id/start          "Take me there" / "I'm trying it" — in progress
 *   POST /:id/prompted       the card has been shown (no-place tests show once)
 *   POST /:id/later          "Put it on my to-do list" — never pops up again
 *   POST /:id/answer         { answer, note? } — my result
 *   POST /:id/photo          multipart "file" — an optional photo with it
 * Managers and admins (and the tester for their own photo):
 *   GET  /?tab=open|problems|answered|closed|all
 *   GET  /issue/:issueId     the issue's reporter, for the form
 *   GET  /improvement/:id    the improvement's submitter, for the form
 *   POST /                   create
 *   POST /:id/close {note?}  /  POST /:id/reopen
 *   GET  /:id/testers/:userId/photo
 *
 * Per PERSON, like the walkthroughs: on a shared station iPad it is
 * whoever switched in with their PIN. The deploy session uses
 * routes/test-requests-machine.ts instead.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, andonIssuesTable, improvementSubmissionsTable, testRequestsTable, testRequestTestersTable, usersTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import { requireManagerOrAdmin, resolveRole } from "../middleware/roles";
import { singleFileUpload } from "../middleware/upload";
import {
  TEST_ANSWERS,
  answerNoteProblem,
  answerVerdict,
  type TestAnswer,
} from "../lib/test-request-rules";
import {
  createTestRequest,
  createTestRequestFields,
  loadRequestViews,
  myOpenRequests,
  putTestOnTodoList,
  recordAnswerSideEffects,
  removeOpenTodosFor,
} from "../lib/test-requests-data";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function userName(userId: number): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? "Someone";
}

async function loadMine(requestId: number, userId: number) {
  const [r] = await db.select().from(testRequestsTable).where(eq(testRequestsTable.id, requestId));
  if (!r) return { r: null, t: null };
  const [t] = await db.select().from(testRequestTestersTable)
    .where(and(eq(testRequestTestersTable.requestId, requestId), eq(testRequestTestersTable.userId, userId)));
  return { r, t: t ?? null };
}

// ── The tester's side ──────────────────────────────────────────────────────
router.get("/mine", async (req: Request, res: Response) => {
  res.json({ requests: await myOpenRequests(req.session.userId!) });
});

router.post("/:id/start", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { r, t } = await loadMine(id, req.session.userId!);
  const v = answerVerdict(r, t);
  if (!v.ok) { res.status(v.status).json({ error: v.error }); return; }
  if (!t!.startedAt) {
    await db.update(testRequestTestersTable).set({ startedAt: new Date(), promptedAt: t!.promptedAt ?? new Date() }).where(eq(testRequestTestersTable.id, t!.id));
  }
  res.json({ ok: true });
});

router.post("/:id/prompted", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const { r, t } = await loadMine(id, req.session.userId!);
  const v = answerVerdict(r, t);
  if (!v.ok) { res.status(v.status).json({ error: v.error }); return; }
  if (!t!.promptedAt) {
    await db.update(testRequestTestersTable).set({ promptedAt: new Date() }).where(eq(testRequestTestersTable.id, t!.id));
  }
  res.json({ ok: true });
});

router.post("/:id/later", validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  const { r, t } = await loadMine(id, userId);
  const v = answerVerdict(r, t);
  if (!v.ok) { res.status(v.status).json({ error: v.error }); return; }
  const todoTaskId = await putTestOnTodoList(r!, t!, await userName(userId));
  res.json({ ok: true, todoTaskId });
});

const answerBody = z.object({
  answer: z.enum(TEST_ANSWERS),
  note: z.string().trim().max(4000).optional().nullable(),
});

router.post("/:id/answer", validate(answerBody), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.session.userId!;
  const { answer, note } = req.body as z.infer<typeof answerBody>;
  const noteProblem = answerNoteProblem(answer as TestAnswer, note);
  if (noteProblem) { res.status(400).json({ error: noteProblem }); return; }
  const { r, t } = await loadMine(id, userId);
  const v = answerVerdict(r, t);
  if (!v.ok) { res.status(v.status).json({ error: v.error }); return; }
  const now = new Date();
  // Guarded on answer IS NULL so two devices can't both answer.
  const updated = await db.update(testRequestTestersTable)
    .set({ answer, note: note || null, answeredAt: now, startedAt: t!.startedAt ?? now, promptedAt: t!.promptedAt ?? now })
    .where(and(eq(testRequestTestersTable.id, t!.id), isNull(testRequestTestersTable.answer)))
    .returning({ id: testRequestTestersTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "You've already answered this one" }); return; }
  await db.update(testRequestsTable).set({ updatedAt: now }).where(eq(testRequestsTable.id, r!.id));
  try {
    await recordAnswerSideEffects(r!, { userId, name: await userName(userId), todoTaskId: t!.todoTaskId }, answer as TestAnswer, note || null);
  } catch (err) {
    // The answer is saved; a failed follow-up must not lose it — but say so in the logs.
    console.error("[test-requests] answer side effects failed:", err instanceof Error ? err.message : String(err));
  }
  res.json({ ok: true });
});

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];

router.post("/:id/photo", singleFileUpload("file", 10), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  if (!req.file) { res.status(400).json({ error: "No photo uploaded" }); return; }
  if (!IMAGE_MIMES.includes(req.file.mimetype)) { res.status(400).json({ error: "That isn't a photo — use JPEG, PNG, WebP or HEIC." }); return; }
  const { r, t } = await loadMine(id, req.session.userId!);
  if (!r || !t) { res.status(404).json({ error: "Test request not found" }); return; }
  await db.update(testRequestTestersTable).set({ photo: req.file.buffer, photoMime: req.file.mimetype }).where(eq(testRequestTestersTable.id, t.id));
  res.status(201).json({ ok: true });
});

router.get("/:id/testers/:userId/photo", async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const testerId = parseId(req.params.userId);
  if (!id || !testerId) { res.status(400).json({ error: "Invalid id" }); return; }
  const role = await resolveRole(req);
  if (testerId !== req.session.userId && role !== "admin" && role !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const [t] = await db.select({ photo: testRequestTestersTable.photo, mime: testRequestTestersTable.photoMime }).from(testRequestTestersTable)
    .where(and(eq(testRequestTestersTable.requestId, id), eq(testRequestTestersTable.userId, testerId)));
  if (!t?.photo || !t.mime) { res.status(404).json({ error: "No photo" }); return; }
  res.setHeader("Content-Type", t.mime);
  res.setHeader("Content-Length", String(t.photo.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(t.photo);
});

// ── Managers and admins ────────────────────────────────────────────────────
const TABS = ["open", "problems", "answered", "closed", "all"] as const;
const listQuery = z.object({ tab: z.enum(TABS).optional() });

router.get("/", requireManagerOrAdmin, validateQuery(listQuery), async (_req: Request, res: Response) => {
  const tab = (res.locals["query"] as z.infer<typeof listQuery>).tab ?? "open";
  const all = await loadRequestViews(undefined, 300);
  const counts = { open: 0, problems: 0, answered: 0, closed: 0, all: all.length };
  const tabOf = (s: string) => (s === "waiting" || s === "in_progress" ? "open" : s === "problems" ? "problems" : s === "closed" ? "closed" : "answered");
  for (const r of all) counts[tabOf(r.status) as keyof typeof counts]++;
  res.json({ requests: tab === "all" ? all : all.filter(r => tabOf(r.status) === tab), counts });
});

router.get("/issue/:issueId", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const issueId = parseId(req.params.issueId);
  if (!issueId) { res.status(400).json({ error: "Invalid id" }); return; }
  const [i] = await db.select({
    id: andonIssuesTable.id,
    description: andonIssuesTable.description,
    station: andonIssuesTable.station,
    reportedBy: andonIssuesTable.reportedBy,
    reportedByName: andonIssuesTable.reportedByName,
  }).from(andonIssuesTable).where(eq(andonIssuesTable.id, issueId));
  if (!i) { res.status(404).json({ error: `Issue #${issueId} not found` }); return; }
  res.json(i);
});

router.get("/improvement/:id", requireManagerOrAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [i] = await db.select({
    id: improvementSubmissionsTable.id,
    title: improvementSubmissionsTable.title,
    station: improvementSubmissionsTable.station,
    submittedBy: improvementSubmissionsTable.submittedBy,
    submittedByName: improvementSubmissionsTable.submittedByName,
  }).from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
  if (!i) { res.status(404).json({ error: `Improvement #${id} not found` }); return; }
  res.json(i);
});

router.post("/", requireManagerOrAdmin, validate(z.object(createTestRequestFields)), async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const out = await createTestRequest(req.body, { userId, name: await userName(userId), source: "person" });
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
  res.status(201).json({ id: out.request.id, testerIds: out.testerIds });
});

const closeBody = z.object({ note: z.string().trim().max(1000).optional().nullable() });

router.post("/:id/close", requireManagerOrAdmin, validate(closeBody), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const name = await userName(req.session.userId!);
  const now = new Date();
  const rows = await db.update(testRequestsTable)
    .set({ closedAt: now, closedByName: name, closeNote: (req.body as z.infer<typeof closeBody>).note || null, updatedAt: now })
    .where(eq(testRequestsTable.id, id)).returning({ id: testRequestsTable.id });
  if (!rows.length) { res.status(404).json({ error: "Test request not found" }); return; }
  // Closed = nobody needs to do it: take it off their to-do lists.
  try {
    await removeOpenTodosFor(id);
  } catch (err) {
    console.error("[test-requests] removing to-dos failed:", err instanceof Error ? err.message : String(err));
  }
  res.json({ ok: true });
});

router.post("/:id/reopen", requireManagerOrAdmin, validate(z.object({}).passthrough()), async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.update(testRequestsTable)
    .set({ closedAt: null, closedByName: null, closeNote: null, updatedAt: new Date() })
    .where(eq(testRequestsTable.id, id)).returning({ id: testRequestsTable.id });
  if (!rows.length) { res.status(404).json({ error: "Test request not found" }); return; }
  res.json({ ok: true });
});

export default router;
