/**
 * Performance pay review reports (Graeme, 24 Nov 2026): "an automatic report
 * that I can load up for any given person at any given time" — improvements,
 * training, the Lean curriculum, station speeds, attendance and what's on
 * their record — plus private prep notes, and a frozen copy attached to the
 * meeting that can be shared with them.
 *
 * Same guard as the employment record (routes/people-reviews.ts): private
 * People PIN set + unlocked (mounted behind requirePeopleUnlock), founder or
 * People access, never your own record. Every view and change is audited.
 *
 *   GET  /api/people-performance/person/:userId[?from&to]  the live report,
 *        suggestions, my prep note, saved copies and meetings to attach to
 *   PUT  /api/people-performance/person/:userId/prep        my prep note (autosave)
 *   POST /api/people-performance/person/:userId/reports     save a copy {from,to,entryId}
 *   GET  /api/people-performance/reports/:id                a saved copy
 *   POST /api/people-performance/reports/:id/share          {shared, shareWriteUp?} — show it to them
 *        (and, when attached to a meeting, my own write-up of it too), or stop
 *   DELETE /api/people-performance/reports/:id              remove an unshared copy
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, usersTable, peopleRecordAuditTable, peopleRecordEntriesTable,
  peoplePerformancePrepTable, peoplePerformanceReportsTable,
} from "@workspace/db";
import { applyExclusions, defaultPeriod, forSavedCopy, suggestions, type PerformanceReport } from "@workspace/performance-review";
import { validate, validateQuery } from "../middleware/validate";
import { loadRecordActor, loadRecordSubject } from "../middleware/employment-record-write";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { isFounderEmail } from "../lib/founder-email";
import { londonDateString } from "../lib/london-time";
import { lastAppraisalDate, loadMeetingWriteUp, loadPerformanceReport, type ReportViewer } from "../services/performance-review-data";
import { shareMyWriteUp } from "../services/share-write-up";

const router: IRouter = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const Id = z.coerce.number().int().positive();
interface Viewer { actor: RecordActor; name: string }

router.use(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const actor = await loadRecordActor(id);
    if (!actor || (!isFounderEmail(actor.email) && !actor.hasPeopleAccess)) { res.status(404).json({ error: "Not found" }); return; }
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
    res.locals["viewer"] = { actor, name: u?.name ?? "" } satisfies Viewer;
    next();
  } catch (err) {
    console.error("[people-performance] access check failed:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const viewerOf = (res: Response) => res.locals["viewer"] as Viewer;
/** The viewer as the notes' reading rule sees them. Everyone past the gate
 *  above has People access (or is Graeme) — the same as routes/people-reviews.ts. */
const noteReader = (viewer: Viewer): ReportViewer => ({ id: viewer.actor.id, role: "", hasPeopleAccess: true });

/** The shared rule: People access, and never your own record. */
async function mayOpen(viewer: Viewer, subjectUserId: number): Promise<boolean> {
  const subject = await loadRecordSubject(subjectUserId);
  return subject != null && canWriteEmploymentRecord(viewer.actor, subject);
}

async function audit(viewer: Viewer, subjectUserId: number, action: string, detail?: string) {
  await db.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId, action, detail: detail?.slice(0, 500) ?? null,
  }).catch(err => console.error("[people-performance] audit failed:", err));
}

async function periodFor(userId: number, q: { from?: string; to?: string }) {
  const today = londonDateString(new Date());
  const last = await lastAppraisalDate(userId, today);
  const def = defaultPeriod(today, last);
  const from = q.from ?? def.from;
  const to = q.to ?? def.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

const periodQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

router.get("/person/:userId", validateQuery(periodQuery), async (req: Request, res: Response) => {
  const userId = Id.safeParse(req.params.userId);
  if (!userId.success) { res.status(400).json({ error: "Bad person" }); return; }
  const viewer = viewerOf(res);
  if (!(await mayOpen(viewer, userId.data))) { res.status(404).json({ error: "Not found" }); return; }
  try {
    const period = await periodFor(userId.data, res.locals["query"] as z.infer<typeof periodQuery>);
    const [report, prep, saved, meetings] = await Promise.all([
      loadPerformanceReport(userId.data, period.from, period.to, noteReader(viewer)),
      db.select({ body: peoplePerformancePrepTable.body, updatedAt: peoplePerformancePrepTable.updatedAt })
        .from(peoplePerformancePrepTable)
        .where(and(eq(peoplePerformancePrepTable.subjectUserId, userId.data), eq(peoplePerformancePrepTable.authorUserId, viewer.actor.id))),
      db.select({
        id: peoplePerformanceReportsTable.id, from: peoplePerformanceReportsTable.periodFrom, to: peoplePerformanceReportsTable.periodTo,
        entryId: peoplePerformanceReportsTable.entryId, entryTitle: peopleRecordEntriesTable.title,
        createdAt: peoplePerformanceReportsTable.createdAt, createdByName: peoplePerformanceReportsTable.createdByName,
        sharedAt: peoplePerformanceReportsTable.sharedAt,
        // The attached meeting's write-up: my own notes still private (they
        // can go out with the report), and what's already shared with them.
        writeUpMine: sql<number>`(SELECT COUNT(*)::int FROM people_review_notes n WHERE n.entry_id = ${peoplePerformanceReportsTable.entryId}
          AND n.deleted_at IS NULL AND n.visibility <> 'shared' AND n.author_id = ${viewer.actor.id})`,
        writeUpShared: sql<number>`(SELECT COUNT(*)::int FROM people_review_notes n WHERE n.entry_id = ${peoplePerformanceReportsTable.entryId}
          AND n.deleted_at IS NULL AND n.visibility = 'shared')`,
      }).from(peoplePerformanceReportsTable)
        .leftJoin(peopleRecordEntriesTable, eq(peopleRecordEntriesTable.id, peoplePerformanceReportsTable.entryId))
        .where(eq(peoplePerformanceReportsTable.subjectUserId, userId.data))
        .orderBy(desc(peoplePerformanceReportsTable.createdAt)),
      db.select({
        id: peopleRecordEntriesTable.id, title: peopleRecordEntriesTable.title,
        entryDate: peopleRecordEntriesTable.entryDate, meetingDate: peopleRecordEntriesTable.meetingDate,
        meetingStatus: peopleRecordEntriesTable.meetingStatus,
      }).from(peopleRecordEntriesTable)
        .where(eq(peopleRecordEntriesTable.userId, userId.data))
        .orderBy(desc(peopleRecordEntriesTable.entryDate)).limit(25),
    ]);
    await audit(viewer, userId.data, "viewed performance report", `${period.from} to ${period.to}`);
    res.json({
      report,
      suggestions: suggestions(report),
      prep: { body: prep[0]?.body ?? "", updatedAt: prep[0]?.updatedAt ?? null },
      saved,
      meetings: meetings.map(m => ({ id: m.id, title: m.title, date: m.meetingDate ?? m.entryDate, meetingStatus: m.meetingStatus })),
    });
  } catch (err) {
    console.error("[people-performance] report failed:", err);
    res.status(500).json({ error: "Couldn't build the report" });
  }
});

const prepBody = z.object({ body: z.string().max(50_000) });

router.put("/person/:userId/prep", validate(prepBody), async (req: Request, res: Response) => {
  const userId = Id.safeParse(req.params.userId);
  if (!userId.success) { res.status(400).json({ error: "Bad person" }); return; }
  const viewer = viewerOf(res);
  if (!(await mayOpen(viewer, userId.data))) { res.status(404).json({ error: "Not found" }); return; }
  const { body } = req.body as z.infer<typeof prepBody>;
  const now = new Date();
  await db.insert(peoplePerformancePrepTable)
    .values({ subjectUserId: userId.data, authorUserId: viewer.actor.id, body, updatedAt: now })
    .onConflictDoUpdate({ target: [peoplePerformancePrepTable.subjectUserId, peoplePerformancePrepTable.authorUserId], set: { body, updatedAt: now } });
  res.json({ updatedAt: now.toISOString() });
});

const saveBody = z.object({
  from: isoDate, to: isoDate, entryId: z.number().int().positive().nullable(),
  /** What was unticked on screen — left out of the saved copy (24 Nov 2026). */
  exclusions: z.object({ sections: z.array(z.string().max(40)).max(20), items: z.array(z.string().max(300)).max(1000) }).optional(),
});

router.post("/person/:userId/reports", validate(saveBody), async (req: Request, res: Response) => {
  const userId = Id.safeParse(req.params.userId);
  if (!userId.success) { res.status(400).json({ error: "Bad person" }); return; }
  const viewer = viewerOf(res);
  if (!(await mayOpen(viewer, userId.data))) { res.status(404).json({ error: "Not found" }); return; }
  const b = req.body as z.infer<typeof saveBody>;
  if (b.entryId != null) {
    const [e] = await db.select({ userId: peopleRecordEntriesTable.userId }).from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, b.entryId));
    if (!e || e.userId !== userId.data) { res.status(400).json({ error: "That meeting isn't on this person's record" }); return; }
  }
  try {
    // Rebuilt here, not taken from the screen: the saved copy is what the data
    // said. Only notes already shared with them can be frozen into it; the
    // attached meeting's write-up is read live when the copy is opened.
    const built = await loadPerformanceReport(userId.data, b.from <= b.to ? b.from : b.to, b.from <= b.to ? b.to : b.from, noteReader(viewer));
    const report = forSavedCopy(applyExclusions(built, b.exclusions), b.entryId);
    const [row] = await db.insert(peoplePerformanceReportsTable).values({
      subjectUserId: userId.data, entryId: b.entryId, periodFrom: report.period.from, periodTo: report.period.to,
      data: report, createdBy: viewer.actor.id, createdByName: viewer.name,
    }).returning({ id: peoplePerformanceReportsTable.id });
    const left = b.exclusions ? b.exclusions.sections.length + b.exclusions.items.length : 0;
    await audit(viewer, userId.data, "saved performance report", `#${row!.id} ${report.period.from} to ${report.period.to}${b.entryId ? ` on entry ${b.entryId}` : ""}${left ? `; ${left} item(s) left out` : ""}`);
    res.status(201).json({ id: row!.id });
  } catch (err) {
    console.error("[people-performance] save failed:", err);
    res.status(500).json({ error: "Couldn't save the report" });
  }
});

async function loadSaved(id: number) {
  const [r] = await db.select().from(peoplePerformanceReportsTable).where(eq(peoplePerformanceReportsTable.id, id));
  return r ?? null;
}

router.get("/reports/:id", async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Bad report" }); return; }
  const viewer = viewerOf(res);
  const r = await loadSaved(id.data);
  if (!r || !(await mayOpen(viewer, r.subjectUserId))) { res.status(404).json({ error: "Not found" }); return; }
  await audit(viewer, r.subjectUserId, "viewed saved performance report", `#${r.id}`);
  const report = r.data as PerformanceReport;
  const writeUp = r.entryId != null ? await loadMeetingWriteUp(r.entryId, r.subjectUserId, noteReader(viewer)) : null;
  res.json({ id: r.id, sharedAt: r.sharedAt, createdAt: r.createdAt, createdByName: r.createdByName, report, writeUp, suggestions: suggestions(report) });
});

const shareBody = z.object({
  shared: z.boolean(),
  /** Also share my own private write-up of the attached meeting (24 Nov 2026). */
  shareWriteUp: z.boolean().optional(),
});

router.post("/reports/:id/share", validate(shareBody), async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Bad report" }); return; }
  const viewer = viewerOf(res);
  const r = await loadSaved(id.data);
  if (!r || !(await mayOpen(viewer, r.subjectUserId))) { res.status(404).json({ error: "Not found" }); return; }
  const { shared, shareWriteUp } = req.body as z.infer<typeof shareBody>;
  await db.update(peoplePerformanceReportsTable)
    .set(shared ? { sharedAt: new Date(), sharedBy: viewer.actor.id } : { sharedAt: null, sharedBy: null })
    .where(eq(peoplePerformanceReportsTable.id, r.id));
  await audit(viewer, r.subjectUserId, shared ? "shared performance report" : "unshared performance report", `#${r.id}`);
  // The final report carries the meeting's write-up (Graeme, 24 Nov 2026) —
  // my own private notes on it go out with it when I say so. Others'
  // private notes are theirs to share.
  const writeUpShared = shared && shareWriteUp && r.entryId != null
    ? await shareMyWriteUp({ id: viewer.actor.id, name: viewer.name }, { id: r.entryId, userId: r.subjectUserId })
    : 0;
  res.json({ ok: true, writeUpShared });
});

router.delete("/reports/:id", async (req: Request, res: Response) => {
  const id = Id.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Bad report" }); return; }
  const viewer = viewerOf(res);
  const r = await loadSaved(id.data);
  if (!r || !(await mayOpen(viewer, r.subjectUserId))) { res.status(404).json({ error: "Not found" }); return; }
  if (r.sharedAt) { res.status(409).json({ error: "It's been shared with them — stop sharing it first." }); return; }
  await db.delete(peoplePerformanceReportsTable).where(eq(peoplePerformanceReportsTable.id, r.id));
  await audit(viewer, r.subjectUserId, "deleted saved performance report", `#${r.id}`);
  res.json({ ok: true });
});

export default router;
