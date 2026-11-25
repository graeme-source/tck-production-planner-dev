/**
 * Last review and "No review required" (Graeme, 25 Nov 2026) — the People
 * list's Last review column and the review card on a person's record.
 * Mounted INSIDE routes/people-reviews.ts, after its access check, so
 * everything here is already behind the private People PIN and the founder
 * / People-access rule; res.locals.recordViewer is set.
 *
 *   GET /api/people-reviews/review-due                          everyone the viewer may open:
 *                                                               last review date + the switch
 *   GET /api/people-reviews/person/:userId/review-due           one person's
 *   PUT /api/people-reviews/person/:userId/no-review-required   { noReviewRequired } (autosaved)
 *
 * Same rules as the list badges and the record: a person is only included
 * when canWriteEmploymentRecord says the viewer may open their record —
 * never your own unless you're Graeme. The switch carries the
 * employmentRecordWrite guard. Every read and change lands in
 * people_record_audit. What counts as a review: lib/last-appraisals.ts;
 * whether it's overdue: lib/people-reviews review-due.ts (the screens
 * classify, so the server only hands over facts).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, usersTable, peopleRecordAuditTable, peopleReviewSettingsTable } from "@workspace/db";
import { londonTodayIso, noReviewRequiredAuditDetail } from "@workspace/people-reviews";
import { validate } from "../middleware/validate";
import { employmentRecordWrite, fromParam, loadRecordSubject } from "../middleware/employment-record-write";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { lastAppraisalsByUser } from "../lib/last-appraisals";

const router: IRouter = Router();

interface Viewer { actor: RecordActor; name: string; role: string; isFounder: boolean }
const viewerOf = (res: Response) => res.locals["recordViewer"] as Viewer;

const onPerson = employmentRecordWrite({ subject: fromParam("userId"), refuseAs404: true });

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(res: Response, where: string, err: unknown, message: string) {
  console.error(`[people-review-due] ${where} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: message });
}

async function audit(viewer: Viewer, row: { subjectUserId: number | null; action: string; detail: string }) {
  await db.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId: row.subjectUserId,
    entryId: null, action: row.action, detail: row.detail.slice(0, 500),
  });
}

export interface ReviewDueRow {
  userId: number;
  lastReviewDate: string | null;
  lastReviewEntryId: number | null;
  noReviewRequired: boolean;
  setByName: string | null;
  setAt: string | null;
}

async function loadSettings(): Promise<Map<number, { on: boolean; by: string | null; at: string | null }>> {
  const rows = await db.select().from(peopleReviewSettingsTable);
  return new Map(rows.map(r => [r.userId, { on: r.noReviewRequired, by: r.updatedByName, at: r.updatedAt ? r.updatedAt.toISOString() : null }]));
}

function shape(userId: number, last: { entryId: number; date: string } | undefined, s: { on: boolean; by: string | null; at: string | null } | undefined): ReviewDueRow {
  return {
    userId,
    lastReviewDate: last?.date ?? null,
    lastReviewEntryId: last?.entryId ?? null,
    noReviewRequired: s?.on ?? false,
    setByName: s?.by ?? null,
    setAt: s?.at ?? null,
  };
}

// ── The list ───────────────────────────────────────────────────────────────

router.get("/review-due", async (_req: Request, res: Response) => {
  const viewer = viewerOf(res);
  try {
    const today = londonTodayIso();
    const subjects = (await db.select({ id: usersTable.id, email: usersTable.email, plandayEmployeeId: usersTable.plandayEmployeeId }).from(usersTable))
      .filter(s => canWriteEmploymentRecord(viewer.actor, s)); // never the viewer's own
    const ids = subjects.map(s => s.id);
    const [lastByUser, settings] = await Promise.all([lastAppraisalsByUser(ids, today), loadSettings()]);
    const people = ids.map(id => shape(id, lastByUser.get(id), settings.get(id)));
    await audit(viewer, { subjectUserId: null, action: "view_review_dates", detail: `Last review dates for ${people.length} people` });
    res.json({ today, people });
  } catch (err) {
    fail(res, "list", err, "Couldn't load last review dates");
  }
});

// ── One person ─────────────────────────────────────────────────────────────

router.get("/person/:userId/review-due", async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const userId = parseId(req.params["userId"]);
  try {
    const subject = userId == null ? null : await loadRecordSubject(userId);
    if (userId == null || !subject || !canWriteEmploymentRecord(viewer.actor, subject)) { res.status(404).json({ error: "Not found" }); return; }
    const today = londonTodayIso();
    const [lastByUser, settings] = await Promise.all([lastAppraisalsByUser([userId], today), loadSettings()]);
    await audit(viewer, { subjectUserId: userId, action: "view_review_dates", detail: "Last review date" });
    res.json({ today, ...shape(userId, lastByUser.get(userId), settings.get(userId)) });
  } catch (err) {
    fail(res, "person", err, "Couldn't load their last review");
  }
});

const NoReviewBody = z.object({ noReviewRequired: z.boolean() });

router.put("/person/:userId/no-review-required", onPerson, validate(NoReviewBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const userId = parseId(req.params["userId"]);
  if (userId == null) { res.status(404).json({ error: "Not found" }); return; }
  const on = (req.body as z.infer<typeof NoReviewBody>).noReviewRequired;
  try {
    const [person] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
    if (!person) { res.status(404).json({ error: "Not found" }); return; }
    const [before] = await db.select({ on: peopleReviewSettingsTable.noReviewRequired })
      .from(peopleReviewSettingsTable).where(eq(peopleReviewSettingsTable.userId, userId));
    const now = new Date();
    const [row] = await db.insert(peopleReviewSettingsTable)
      .values({ userId, noReviewRequired: on, updatedBy: viewer.actor.id, updatedByName: viewer.name, updatedAt: now })
      .onConflictDoUpdate({
        target: peopleReviewSettingsTable.userId,
        set: { noReviewRequired: on, updatedBy: viewer.actor.id, updatedByName: viewer.name, updatedAt: now },
      })
      .returning();
    // Only a real change is history; a repeated autosave of the same value isn't.
    if ((before?.on ?? false) !== on) {
      await audit(viewer, { subjectUserId: userId, action: "no_review_required", detail: noReviewRequiredAuditDetail(on) });
    }
    res.json({
      userId,
      noReviewRequired: row!.noReviewRequired,
      setByName: row!.updatedByName,
      setAt: row!.updatedAt ? row!.updatedAt.toISOString() : null,
    });
  } catch (err) {
    fail(res, "set", err, "Couldn't save No review required");
  }
});

export default router;
