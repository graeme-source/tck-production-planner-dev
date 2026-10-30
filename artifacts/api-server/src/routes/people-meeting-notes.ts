/**
 * "Add meeting notes (AI)" (Graeme, 2026-10-12: "I need a much more
 * AI-automatic process to schedule and record what's going on in these
 * meetings… I don't need to do loads of admin"). Mounted INSIDE
 * routes/people-reviews.ts after its access check, so everything here is
 * already behind the private People PIN and the founder / People-access
 * rule (res.locals.recordViewer is set).
 *
 *   POST /api/people-reviews/entries/:id/meeting-notes/read   { text, url? }
 *        → a DRAFT (title, summary, what was agreed, actions, a suggested
 *          classification) plus the text it was made from. Saves nothing.
 *          The notes are PASTED. A link is never fetched — Wispr Flow shared
 *          notes need a login (checked with a real link, 12 Oct 2026) — it is
 *          only kept as the source reference. A paste that is nothing but a
 *          link is told to paste the notes instead.
 *   POST /api/people-reviews/entries/:id/meeting-notes        the checked draft
 *        → the write-up (private to the author until shared): the summary,
 *          what was agreed as ONE bulleted list per review (kind
 *          "agreement", 0186 — added to the author's private list if the
 *          review already has one), performance objectives, the actions;
 *          the source
 *          kept for audit, the meeting marked held, the pay change and "in
 *          review" if the notes gave them, and a generic to-do ONLY for each
 *          action ticked for one (none by default). Never shared automatically —
 *          "Share with <name>" is the existing share-write-up route.
 *
 * Both carry the employmentRecordWrite guard (Graeme, or People access on
 * someone else's record — the write rule) and zod validation; every call is
 * audited without its content.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  db, usersTable, peopleRecordEntriesTable, peopleReviewNotesTable, peopleRecordAuditTable, peopleRecordClassificationsTable,
  peopleRecordEntrySourcesTable,
} from "@workspace/db";
import {
  meetingNotesRows, tickedActionTodos, appendAgreementBullets, agreementBullets, recordTodo, meetingStatusChange, reclassify, londonTodayIso, cleanFieldSets,
  linkOnly, linkPastedMessage, cleanSourceLink, MAX_NOTES_CHARS, answersTriggerMessage,
  cleanClassIds, entryClassIds, entryClassification,
  type MeetingStatus, type Classification, type EvidenceKind,
} from "@workspace/people-reviews";
import { validate } from "../middleware/validate";
import { employmentRecordWrite, fromRow, ownerOf, loadRecordSubject } from "../middleware/employment-record-write";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { resyncAttentionSoon } from "../lib/hr-attention";
import { loadEntryClassIds, setEntryClassifications } from "../lib/entry-classifications";
import { ReadMeetingNotesBody, SaveMeetingNotesBody, type SaveMeetingNotes } from "../lib/meeting-notes-ai";
import { draftMeetingNotes } from "../services/meeting-notes-reader";

const router: IRouter = Router();

interface Viewer { actor: RecordActor; name: string; role: string; isFounder: boolean }
const viewerOf = (res: Response) => res.locals["recordViewer"] as Viewer;

const onEntry = employmentRecordWrite({ subject: fromRow("id", ownerOf("people_record_entries")), refuseAs404: true });

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "them";

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(res: Response, where: string, err: unknown, message: string) {
  console.error(`[people-meeting-notes] ${where} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: message });
}

type Exec = Pick<typeof db, "insert" | "update" | "select" | "execute">;

async function audit(exec: Exec, viewer: Viewer, row: { subjectUserId: number; entryId: number; action: string; detail: string }) {
  await exec.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId: row.subjectUserId,
    entryId: row.entryId, action: row.action, detail: row.detail.slice(0, 500),
  });
}

async function loadEntry(viewer: Viewer, rawId: unknown) {
  const id = parseId(rawId);
  const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
  if (!row) return null;
  const subject = await loadRecordSubject(row.userId);
  if (!subject || !canWriteEmploymentRecord(viewer.actor, subject)) return null;
  return row;
}

async function loadClassifications(): Promise<Classification[]> {
  const rows = await db.select().from(peopleRecordClassificationsTable);
  return rows.map(r => ({
    id: r.id, label: r.label, sortOrder: r.sortOrder, fieldSets: cleanFieldSets(r.fieldSets ?? []),
    evidence: (r.evidence as EvidenceKind | null) ?? null, active: r.active, defaultForMeetings: r.defaultForMeetings,
  }));
}

async function personName(userId: number): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? "";
}

// ── Read the notes → a draft (nothing saved) ───────────────────────────────

router.post("/entries/:id/meeting-notes/read", onEntry, validate(ReadMeetingNotesBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as { text: string; url?: string | null };
  try {
    const entry = await loadEntry(viewer, req.params["id"]);
    if (!entry) { res.status(404).json({ error: "No such meeting" }); return; }

    // Links are never fetched — only kept as the reference.
    const pastedLink = linkOnly(b.text);
    if (pastedLink) { res.status(422).json({ error: linkPastedMessage(pastedLink), link: pastedLink }); return; }
    const sourceUrl = cleanSourceLink(b.url);
    const text = b.text.trim().slice(0, MAX_NOTES_CHARS);
    if (text.length < 20) { res.status(400).json({ error: "There isn't enough there to go on — paste the full notes." }); return; }

    const classifications = (await loadClassifications()).filter(c => c.active);
    const drafted = await draftMeetingNotes(text, {
      recorderFirstName: firstName(viewer.name),
      colleagueFirstName: firstName(await personName(entry.userId)),
      meetingDate: entry.meetingDate ?? entry.entryDate,
      classificationLabels: classifications.map(c => c.label),
    }, classifications);
    await audit(db, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "ai_draft",
      detail: `Pasted meeting notes read by AI${sourceUrl ? " (source link kept)" : ""}${drafted.ok ? "" : " — failed"}` });
    if (!drafted.ok) { res.status(drafted.status).json({ error: drafted.error }); return; }
    res.json({ draft: drafted.draft, repaired: drafted.repaired, source: { kind: "text", url: sourceUrl, text } });
  } catch (err) {
    fail(res, "read", err, "Couldn't read the notes");
  }
});

// ── Save the checked draft ─────────────────────────────────────────────────

router.post("/entries/:id/meeting-notes", onEntry, validate(SaveMeetingNotesBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as SaveMeetingNotes;
  try {
    const entry = await loadEntry(viewer, req.params["id"]);
    if (!entry) { res.status(404).json({ error: "No such meeting" }); return; }
    const classifications = await loadClassifications();
    // What it's about — every classification ticked (0184), first = primary.
    // Ones already on the entry may since have been retired; new ones must be active.
    const before = entryClassIds({ classificationId: entry.classificationId, classificationIds: (await loadEntryClassIds(db, [entry.id])).get(entry.id) });
    let wanted = b.classificationIds?.length ? cleanClassIds(b.classificationIds)
      : b.classificationId != null ? [b.classificationId] : before;
    // A pay change shows only under a classification that has the pay
    // fields — tick the first one that does if none ticked has them.
    if (b.pay && !wanted.some(id => classifications.find(c => c.id === id)?.fieldSets.includes("pay"))) {
      const payCls = [...classifications].sort((x, y) => x.sortOrder - y.sortOrder).find(c => c.active && c.fieldSets.includes("pay"));
      if (payCls) wanted = [...wanted, payCls.id];
    }
    if (wanted.length === 0 || wanted.some(id => !classifications.some(c => c.id === id && (c.active || before.includes(id))))) {
      res.status(400).json({ error: "No such classification" }); return;
    }
    const reclassified = wanted.join(",") !== before.join(",");
    const from = entryClassification({ classificationId: before[0], classificationIds: before }, classifications);
    const to: Classification | undefined = reclassified ? entryClassification({ classificationId: wanted[0], classificationIds: wanted }, classifications) : undefined;
    const subjectName = await personName(entry.userId);
    const rows = meetingNotesRows(b, { me: firstName(viewer.name), colleague: firstName(subjectName) });
    if (rows.length === 0) { res.status(400).json({ error: "There's nothing to save — add a summary or what was agreed." }); return; }
    // Only the actions ticked "Put it on my to-do list" — none by default.
    const todos = tickedActionTodos(b.actions, londonTodayIso());
    const now = new Date();

    const result = await db.transaction(async tx => {
      const set: Partial<typeof peopleRecordEntriesTable.$inferInsert> = { updatedAt: now };
      if (b.title.trim()) set.title = b.title.trim();
      if (to) {
        await setEntryClassifications(tx, entry.id, wanted);
        if ([...wanted].sort().join(",") !== [...before].sort().join(",")) {
          await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "reclassify",
            detail: reclassify(from, to).message });
        }
      }
      // "Does this review deal with the attendance trigger?" — only when asked.
      if (b.answersTrigger !== undefined && b.answersTrigger !== (entry.answersTrigger ?? null)) {
        set.answersTrigger = b.answersTrigger;
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "trigger_link",
          detail: answersTriggerMessage(b.answersTrigger) });
      }
      // Notes from the meeting mean it happened.
      const prev = (entry.meetingStatus ?? null) as MeetingStatus | null;
      if (prev !== "held") {
        const change = meetingStatusChange(prev, "held", entry.heldAt);
        set.meetingStatus = "held";
        if (change.stampHeldAt) set.heldAt = now;
        if (!entry.meetingDate) set.meetingDate = entry.entryDate;
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "meeting_status", detail: change.message });
      }
      // It happened, so a to-do for the meeting (if one was asked for) is done.
      if (entry.meetingTodoId != null) {
        await tx.execute(sql`
          UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
           WHERE id = ${entry.meetingTodoId} AND status = 'open'
        `);
        set.meetingTodoId = null;
      }
      // The pay change from the notes (Graeme checked it) — onto the meeting.
      if (b.pay) {
        set.payFrom = b.pay.from || entry.payFrom;
        set.payTo = b.pay.to;
        set.payEffectiveOn = b.pay.effectiveOn ?? entry.payEffectiveOn;
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "edit", detail: "Pay change filled in from the meeting notes" });
      }
      // Put in review — only ever opens it; closing is done by hand.
      if (b.inReview === true && entry.status !== "open") {
        set.status = "open";
        set.closedOn = null;
        if (!entry.reviewStart) set.reviewStart = entry.meetingDate ?? entry.entryDate;
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "open", detail: "Marked open — in review (from the meeting notes)" });
      }
      await tx.update(peopleRecordEntriesTable).set(set).where(eq(peopleRecordEntriesTable.id, entry.id));
      // What was agreed is ONE list per review: if this author already has a
      // private one on it, the new points join it. A shared one is never
      // changed behind the colleague's back — a new private list starts.
      let toInsert = rows;
      const agreementRow = rows.find(r => r.kind === "agreement");
      let mergedInto: number | null = null;
      if (agreementRow) {
        const [mine] = await tx.select().from(peopleReviewNotesTable).where(and(
          eq(peopleReviewNotesTable.entryId, entry.id), eq(peopleReviewNotesTable.kind, "agreement"),
          eq(peopleReviewNotesTable.authorId, viewer.actor.id), eq(peopleReviewNotesTable.visibility, "private"),
          isNull(peopleReviewNotesTable.deletedAt),
        )).orderBy(peopleReviewNotesTable.id).limit(1);
        if (mine) {
          await tx.update(peopleReviewNotesTable)
            .set({ body: appendAgreementBullets(mine.body, agreementBullets(agreementRow.body)), updatedAt: now })
            .where(eq(peopleReviewNotesTable.id, mine.id));
          mergedInto = mine.id;
          toInsert = rows.filter(r => r !== agreementRow);
        }
      }
      const created = toInsert.length === 0 ? [] : await tx.insert(peopleReviewNotesTable).values(toInsert.map(r => ({
        entryId: entry.id, userId: entry.userId, kind: r.kind, title: r.title, body: r.body, dueDate: r.dueDate,
        visibility: "private", sharedAt: null, authorId: viewer.actor.id, authorName: viewer.name,
      }))).returning({ id: peopleReviewNotesTable.id });

      await tx.insert(peopleRecordEntrySourcesTable).values({
        entryId: entry.id, userId: entry.userId, kind: b.source.kind, sourceUrl: cleanSourceLink(b.source.url),
        rawText: b.source.text, model: "claude", createdById: viewer.actor.id, createdByName: viewer.name,
      });

      // The author's own actions → discreet to-dos: generic title, no names.
      for (const t of todos) {
        const todo = recordTodo({ kind: "action", ownerId: viewer.actor.id, ownerName: viewer.name, subjectUserId: entry.userId,
          subjectName, entryId: entry.id, date: t.date });
        await tx.execute(sql`
          INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority, scheduled_for, due_date, status, acknowledged_at)
          VALUES (${todo.assigneeId}, ${todo.createdBy}, ${todo.createdByName}, ${todo.title}, ${todo.notes}, ${todo.url}, ${todo.priority},
                  ${todo.scheduledFor}, ${todo.dueDate}, 'open', NOW())
        `);
      }

      await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "write_up",
        detail: `Meeting notes added with AI from pasted text${b.source.url ? " (source link kept)" : ""} (${created.length} part${created.length === 1 ? "" : "s"}${mergedInto ? ", agreed points added to the existing list" : ""}, private${todos.length ? `, ${todos.length} to-do${todos.length === 1 ? "" : "s"}` : ""})` });
      return { created: created.length + (mergedInto ? 1 : 0), todos: todos.length };
    });
    resyncAttentionSoon();
    res.status(201).json(result);
  } catch (err) {
    fail(res, "save", err, "Couldn't save the meeting notes");
  }
});

export default router;
