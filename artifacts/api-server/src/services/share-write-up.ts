/**
 * Share MY private write-up of one meeting with the person it's about — every
 * private note I wrote on that entry becomes "shared", which publishes it to
 * their own record. Only the author's own notes: "private" means private from
 * other managers too, so nobody can publish someone else's.
 *
 * Used by "Share write-up" on the record (routes/people-review-notes.ts) and
 * by sharing a performance report attached to the meeting
 * (routes/people-performance.ts — Graeme, 24 Nov 2026: the meeting's notes
 * "all come through to the final report that gets published").
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, peopleReviewNotesTable, peopleRecordAuditTable } from "@workspace/db";

export interface WriteUpSharer { id: number; name: string }

/** Returns how many notes were shared. Audits and rings their bell when any were. */
export async function shareMyWriteUp(sharer: WriteUpSharer, entry: { id: number; userId: number }): Promise<number> {
  const shared = await db.transaction(async tx => {
    const out = await tx.update(peopleReviewNotesTable)
      .set({ visibility: "shared", sharedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(peopleReviewNotesTable.entryId, entry.id),
        eq(peopleReviewNotesTable.authorId, sharer.id),
        eq(peopleReviewNotesTable.visibility, "private"),
        isNull(peopleReviewNotesTable.deletedAt),
      ))
      .returning({ id: peopleReviewNotesTable.id });
    if (out.length > 0) {
      await tx.insert(peopleRecordAuditTable).values({
        viewerId: sharer.id, viewerName: sharer.name, subjectUserId: entry.userId, entryId: entry.id, action: "note_share",
        detail: `Write-up shared with them (${out.length} part${out.length === 1 ? "" : "s"})`,
      });
    }
    return out;
  });
  if (shared.length > 0) await notifyShared(entry.userId, sharer, "a review write-up");
  return shared.length;
}

/** Tell the employee something was shared with them. A missed bell must
 *  never fail the share itself. Says nothing about what's in it. */
export async function notifyShared(subjectUserId: number, sharer: WriteUpSharer, what: string): Promise<void> {
  if (subjectUserId === sharer.id) return;
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${subjectUserId}, ${"review"}, ${`${sharer.name} shared ${what} on your record`.slice(0, 500)}, false)
    `);
  } catch (err) {
    console.warn("[share-write-up] notification insert failed:", err instanceof Error ? err.message : err);
  }
}
