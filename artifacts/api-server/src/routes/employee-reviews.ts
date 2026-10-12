/**
 * YOUR OWN record, as you see it (Graeme, 2026-09-03; rebuilt 2026-10-12).
 *
 *   GET /api/employee-reviews/me   the reviews with something shared with
 *                                  you, and what was agreed
 *
 * Reviews used to live here as their own meetings + notes. Since migration
 * 0178 (one review, classified) every review is an entry on the employment
 * record (routes/people-reviews.ts — People access, never your own record)
 * and its write-up is in people_review_notes. This file is now only the
 * employee's read-only window onto that, with the same privacy rule as
 * ever, applied HERE before anything is sent: visibleNotes() — a note is
 * private to whoever wrote it until shared; a shared one is yours to read.
 * You get the day of each review and what was shared from it — never its
 * classification, summary, stage or anything else on the entry. It is a
 * record of what was said, not a conversation: nothing here writes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db, usersTable, peopleRecordEntriesTable, peopleReviewNotesTable, visibleNotes,
} from "@workspace/db";
import { ownRecordView, type MeetingStatus } from "@workspace/people-reviews";
import { hasPeopleAccess } from "../lib/people-access";

const router: IRouter = Router();

router.get("/me", async (req: Request, res: Response) => {
  const id = req.session.userId;
  if (!id) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const [me] = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
      .from(usersTable).where(eq(usersTable.id, id));
    if (!me) { res.status(401).json({ error: "Not authenticated" }); return; }

    const [entries, allNotes] = await Promise.all([
      db.select({
        id: peopleRecordEntriesTable.id, entryDate: peopleRecordEntriesTable.entryDate,
        meetingDate: peopleRecordEntriesTable.meetingDate, meetingStatus: peopleRecordEntriesTable.meetingStatus,
        heldAt: peopleRecordEntriesTable.heldAt,
      }).from(peopleRecordEntriesTable).where(eq(peopleRecordEntriesTable.userId, id)),
      db.select().from(peopleReviewNotesTable)
        .where(and(eq(peopleReviewNotesTable.userId, id), isNull(peopleReviewNotesTable.deletedAt))),
    ]);

    // THE line that matters: only what this person may read leaves here.
    const notes = visibleNotes(allNotes, { id, role: me.role, hasPeopleAccess: await hasPeopleAccess(id) }, id)
      .map(n => ({
        id: n.id, entryId: n.entryId, kind: n.kind, title: n.title, body: n.body, visibility: n.visibility,
        dueDate: n.dueDate, doneAt: n.doneAt ? n.doneAt.toISOString() : null, authorName: n.authorName,
        createdAt: n.createdAt.toISOString(),
      }));
    const view = ownRecordView(entries.map(e => ({
      id: e.id, entryDate: e.entryDate, meetingDate: e.meetingDate,
      meetingStatus: (e.meetingStatus as MeetingStatus | null) ?? null,
      heldAt: e.heldAt ? e.heldAt.toISOString() : null,
    })), notes);
    res.json({ name: me.name, ...view });
  } catch (err) {
    console.error("[EmployeeReviews] my record error:", err);
    res.status(500).json({ error: "Failed to load your record" });
  }
});

export default router;
