/**
 * A review's write-up — feedback, objectives and notes (migration 0178;
 * Graeme, 2026-10-12: one review, classified). Mounted INSIDE
 * routes/people-reviews.ts, after its access check, so everything here is
 * already behind the private People PIN and the founder / People-access
 * rule; res.locals.recordViewer is set.
 *
 *   POST   /api/people-reviews/entries/:id/write-up        { feedback, objectives[], notes, share }
 *   POST   /api/people-reviews/entries/:id/notes           one note / feedback / objective
 *   POST   /api/people-reviews/entries/:id/share-write-up  share all of MY private notes on it
 *   POST   /api/people-reviews/person/:userId/notes     a LOOSE note — not part of any meeting
 *                                                     (Graeme, 2026-10-14), private unless shared
 *   PATCH  /api/people-reviews/review-notes/:id            edit, share / unshare, tick done, due date
 *   DELETE /api/people-reviews/review-notes/:id            hide it (never hard-deleted)
 *
 * The same privacy promise as the old meetings (employee-review-visibility):
 * a note is PRIVATE to whoever wrote it until they share it, which publishes
 * it to the employee's own record and tells them. Only the author may
 * change, share or remove a note — "private" means private from other
 * managers too, so they can't publish it either. Every write carries the
 * employmentRecordWrite guard (never your own record unless you're Graeme)
 * and lands in people_record_audit.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, peopleRecordEntriesTable, peopleReviewNotesTable, peopleRecordAuditTable } from "@workspace/db";
import {
  NOTE_KINDS, NOTE_KIND_LABEL, writeUpRows, meetingStatusChange, londonTodayIso, looseNoteDate, looseNoteAuditDetail,
  LOOSE_NOTE_TITLE_MAX, LOOSE_NOTE_BODY_MAX, type MeetingStatus, type NoteKind,
} from "@workspace/people-reviews";
import { validate } from "../middleware/validate";
import { employmentRecordWrite, fromParam, fromRow, ownerOf, loadRecordSubject } from "../middleware/employment-record-write";
import { canWriteEmploymentRecord, type RecordActor } from "../lib/people-write-access";
import { resyncAttentionSoon } from "../lib/hr-attention";

const router: IRouter = Router();

interface Viewer { actor: RecordActor; name: string; role: string; isFounder: boolean }
const viewerOf = (res: Response) => res.locals["recordViewer"] as Viewer;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const BODY_MAX = 10_000;

const onEntry = employmentRecordWrite({ subject: fromRow("id", ownerOf("people_record_entries")), refuseAs404: true });
const onNote = employmentRecordWrite({ subject: fromRow("id", ownerOf("people_review_notes")), refuseAs404: true });
const onPerson = employmentRecordWrite({ subject: fromParam("userId"), refuseAs404: true });

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fail(res: Response, where: string, err: unknown, message: string) {
  console.error(`[people-review-notes] ${where} failed:`, err instanceof Error ? err.message : err);
  if (!res.headersSent) res.status(500).json({ error: message });
}

async function mayOpen(viewer: Viewer, subjectUserId: number): Promise<boolean> {
  const subject = await loadRecordSubject(subjectUserId);
  return subject != null && canWriteEmploymentRecord(viewer.actor, subject);
}

type Exec = Pick<typeof db, "insert" | "update" | "select" | "execute">;

async function audit(exec: Exec, viewer: Viewer, row: { subjectUserId: number; entryId: number | null; action: string; detail: string }) {
  await exec.insert(peopleRecordAuditTable).values({
    viewerId: viewer.actor.id, viewerName: viewer.name, subjectUserId: row.subjectUserId,
    entryId: row.entryId, action: row.action, detail: row.detail.slice(0, 500),
  });
}

/** Tell the employee something was shared with them. A missed bell must
 *  never fail the share itself. Says nothing about what's in it. */
async function notifyShared(subjectUserId: number, viewer: Viewer, what: string) {
  if (subjectUserId === viewer.actor.id) return;
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${subjectUserId}, ${"review"}, ${`${viewer.name} shared ${what} on your record`.slice(0, 500)}, false)
    `);
  } catch (err) {
    console.warn("[people-review-notes] notification insert failed:", err instanceof Error ? err.message : err);
  }
}

async function loadEntry(viewer: Viewer, rawId: unknown) {
  const id = parseId(rawId);
  const [row] = id == null ? [] : await db.select().from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.id, id));
  if (!row || !(await mayOpen(viewer, row.userId))) return null;
  return row;
}

// ── Write a review up in one go ────────────────────────────────────────────

const WriteUpBody = z.object({
  feedback: z.string().max(BODY_MAX).optional(),
  objectives: z.array(z.object({
    title: z.string().max(200).optional(),
    body: z.string().max(BODY_MAX).optional(),
    dueDate: isoDate.nullable().optional(),
  })).max(20).optional(),
  notes: z.string().max(BODY_MAX).optional(),
  /** Publish the whole write-up to the colleague as it's saved. */
  share: z.boolean().optional(),
});

router.post("/entries/:id/write-up", onEntry, validate(WriteUpBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as z.infer<typeof WriteUpBody>;
  try {
    const entry = await loadEntry(viewer, req.params["id"]);
    if (!entry) { res.status(404).json({ error: "No such review" }); return; }
    const rows = writeUpRows(b);
    if (rows.length === 0) { res.status(400).json({ error: "Write something first — feedback, an objective, or a note." }); return; }
    const now = new Date();
    const created = await db.transaction(async tx => {
      const out = await tx.insert(peopleReviewNotesTable).values(rows.map(r => ({
        entryId: entry.id, userId: entry.userId, kind: r.kind, title: r.title, body: r.body, dueDate: r.dueDate,
        visibility: b.share ? "shared" : "private", sharedAt: b.share ? now : null,
        authorId: viewer.actor.id, authorName: viewer.name,
      }))).returning({ id: peopleReviewNotesTable.id });
      await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "write_up",
        detail: `Written up (${rows.length} part${rows.length === 1 ? "" : "s"}${b.share ? ", shared with them" : ", private"})` });
      // Writing a booked review up means it happened.
      if (entry.meetingStatus === "booked") {
        const change = meetingStatusChange("booked", "held", entry.heldAt);
        await tx.update(peopleRecordEntriesTable)
          .set({ meetingStatus: "held", ...(change.stampHeldAt ? { heldAt: now } : {}), updatedAt: now })
          .where(eq(peopleRecordEntriesTable.id, entry.id));
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "meeting_status", detail: change.message });
      }
      return out;
    });
    if (b.share) await notifyShared(entry.userId, viewer, "a review write-up");
    resyncAttentionSoon();
    res.status(201).json({ created: created.length });
  } catch (err) {
    fail(res, "write-up", err, "Couldn't save the write-up");
  }
});

// ── One note at a time ─────────────────────────────────────────────────────

const NoteBody = z.object({
  kind: z.enum(NOTE_KINDS).default("note"),
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1, "Write something first").max(BODY_MAX),
  visibility: z.enum(["private", "shared"]).default("private"),
  dueDate: isoDate.nullable().optional(),
});

router.post("/entries/:id/notes", onEntry, validate(NoteBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as z.infer<typeof NoteBody>;
  try {
    const entry = await loadEntry(viewer, req.params["id"]);
    if (!entry) { res.status(404).json({ error: "No such review" }); return; }
    const [row] = await db.transaction(async tx => {
      const out = await tx.insert(peopleReviewNotesTable).values({
        entryId: entry.id, userId: entry.userId, kind: b.kind, title: b.title || null, body: b.body,
        dueDate: b.kind === "objective" ? (b.dueDate ?? null) : null,
        visibility: b.visibility, sharedAt: b.visibility === "shared" ? new Date() : null,
        authorId: viewer.actor.id, authorName: viewer.name,
      }).returning();
      await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "write_up",
        detail: `${NOTE_KIND_LABEL[b.kind as NoteKind]} added (${b.visibility === "shared" ? "shared with them" : "private"})` });
      return out;
    });
    if (b.visibility === "shared") await notifyShared(entry.userId, viewer, "a note");
    resyncAttentionSoon();
    res.status(201).json(row);
  } catch (err) {
    fail(res, "add note", err, "Couldn't save the note");
  }
});

// ── A loose note, straight onto the record ─────────────────────────────────
// Notes and observations that aren't part of any meeting (Graeme,
// 2026-10-14). No entry, so no classification: a private note must never
// become an entry other People-access holders can see (0178). Private to
// its author until shared; "Save and share" shares it in the same act,
// through the same in-app notification as sharing it later.

const LooseNoteBody = z.object({
  title: z.string().trim().max(LOOSE_NOTE_TITLE_MAX).nullable().optional(),
  body: z.string().trim().min(1, "Write something first").max(LOOSE_NOTE_BODY_MAX),
  /** The day it's about — today if left out; an earlier day for an observation. */
  noteDate: isoDate.nullable().optional(),
  visibility: z.enum(["private", "shared"]).default("private"),
});

router.post("/person/:userId/notes", onPerson, validate(LooseNoteBody), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as z.infer<typeof LooseNoteBody>;
  const userId = parseId(req.params["userId"]);
  try {
    if (userId == null || !(await mayOpen(viewer, userId))) { res.status(404).json({ error: "Not found" }); return; }
    const today = londonTodayIso();
    const when = looseNoteDate(b.noteDate, today);
    if (!when.ok) { res.status(400).json({ error: when.error }); return; }
    const shared = b.visibility === "shared";
    const now = new Date();
    const [row] = await db.transaction(async tx => {
      const out = await tx.insert(peopleReviewNotesTable).values({
        entryId: null, userId, kind: "note", title: b.title || null, body: b.body,
        visibility: b.visibility, sharedAt: shared ? now : null,
        authorId: viewer.actor.id, authorName: viewer.name,
        ...(when.createdAt ? { createdAt: when.createdAt } : {}),
      }).returning();
      await audit(tx, viewer, { subjectUserId: userId, entryId: null, action: "write_up",
        detail: looseNoteAuditDetail(shared, b.noteDate, today) });
      return out;
    });
    if (shared) await notifyShared(userId, viewer, "a note");
    resyncAttentionSoon();
    res.status(201).json(row);
  } catch (err) {
    fail(res, "add loose note", err, "Couldn't save the note");
  }
});

/** Share everything YOU wrote on a review, in one act. Never anyone else's
 *  private note — they can't even read it. */
router.post("/entries/:id/share-write-up", onEntry, async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  try {
    const entry = await loadEntry(viewer, req.params["id"]);
    if (!entry) { res.status(404).json({ error: "No such review" }); return; }
    const shared = await db.transaction(async tx => {
      const out = await tx.update(peopleReviewNotesTable)
        .set({ visibility: "shared", sharedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(peopleReviewNotesTable.entryId, entry.id),
          eq(peopleReviewNotesTable.authorId, viewer.actor.id),
          eq(peopleReviewNotesTable.visibility, "private"),
          isNull(peopleReviewNotesTable.deletedAt),
        ))
        .returning({ id: peopleReviewNotesTable.id });
      if (out.length > 0) {
        await audit(tx, viewer, { subjectUserId: entry.userId, entryId: entry.id, action: "note_share",
          detail: `Write-up shared with them (${out.length} part${out.length === 1 ? "" : "s"})` });
      }
      return out;
    });
    if (shared.length > 0) await notifyShared(entry.userId, viewer, "a review write-up");
    res.json({ shared: shared.length });
  } catch (err) {
    fail(res, "share write-up", err, "Couldn't share the write-up");
  }
});

// ── Change one note (its author only) ──────────────────────────────────────

const NotePatch = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1, "A note can't be empty").max(BODY_MAX).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  done: z.boolean().optional(),
  dueDate: isoDate.nullable().optional(),
});

async function loadOwnNote(viewer: Viewer, rawId: unknown, res: Response) {
  const id = parseId(rawId);
  const [note] = id == null ? [] : await db.select().from(peopleReviewNotesTable)
    .where(and(eq(peopleReviewNotesTable.id, id), isNull(peopleReviewNotesTable.deletedAt)));
  if (!note || !(await mayOpen(viewer, note.userId))) { res.status(404).json({ error: "No such note" }); return null; }
  // A private note is its author's alone — another manager can't read it,
  // so they can't change or publish it either.
  if (note.authorId !== viewer.actor.id) { res.status(403).json({ error: "Only whoever wrote a note can change it" }); return null; }
  return note;
}

router.patch("/review-notes/:id", onNote, validate(NotePatch), async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  const b = req.body as z.infer<typeof NotePatch>;
  try {
    const note = await loadOwnNote(viewer, req.params["id"], res);
    if (!note) return;
    // Only an objective is ever done or due — what was agreed is neither (0186).
    if (note.kind !== "objective" && (b.done !== undefined || (b.dueDate !== undefined && b.dueDate !== null))) {
      res.status(400).json({ error: "Only an objective can be marked done or given a due date." }); return;
    }
    const set: Partial<typeof peopleReviewNotesTable.$inferInsert> = { updatedAt: new Date() };
    if (b.title !== undefined) set.title = b.title || null;
    if (b.body !== undefined) set.body = b.body;
    if (b.dueDate !== undefined) set.dueDate = b.dueDate;
    if (b.done !== undefined) set.doneAt = b.done ? (note.doneAt ?? new Date()) : null;
    if (b.visibility !== undefined) {
      set.visibility = b.visibility;
      // Stamped the first time it's published; taking it back down clears
      // it so the record doesn't claim it's still shared.
      set.sharedAt = b.visibility === "shared" ? (note.sharedAt ?? new Date()) : null;
    }
    const newlyShared = b.visibility === "shared" && note.visibility !== "shared";
    const [row] = await db.transaction(async tx => {
      const out = await tx.update(peopleReviewNotesTable).set(set).where(eq(peopleReviewNotesTable.id, note.id)).returning();
      const what = NOTE_KIND_LABEL[(NOTE_KINDS as readonly string[]).includes(note.kind) ? note.kind as NoteKind : "note"];
      const detail = b.visibility !== undefined && b.visibility !== note.visibility
        ? `${what} ${b.visibility === "shared" ? "shared with them" : "made private again"}`
        : b.done !== undefined ? `${what} ${b.done ? "ticked done" : "not done after all"}`
        : `${what} edited`;
      await audit(tx, viewer, { subjectUserId: note.userId, entryId: note.entryId,
        action: b.visibility !== undefined && b.visibility !== note.visibility ? "note_share" : "note_edit", detail });
      return out;
    });
    if (newlyShared) await notifyShared(note.userId, viewer, "a note");
    res.json(row);
  } catch (err) {
    fail(res, "edit note", err, "Couldn't save the note");
  }
});

/** Take a note off the record. Hidden, never hard-deleted — the record keeps
 *  what was written, and the audit says who removed it. */
router.delete("/review-notes/:id", onNote, async (req: Request, res: Response) => {
  const viewer = viewerOf(res);
  try {
    const note = await loadOwnNote(viewer, req.params["id"], res);
    if (!note) return;
    await db.transaction(async tx => {
      await tx.update(peopleReviewNotesTable).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(peopleReviewNotesTable.id, note.id));
      await audit(tx, viewer, { subjectUserId: note.userId, entryId: note.entryId, action: "note_remove",
        detail: `${note.visibility === "shared" ? "Shared" : "Private"} ${note.kind} removed` });
    });
    res.status(204).send();
  } catch (err) {
    fail(res, "remove note", err, "Couldn't remove the note");
  }
});

export default router;
