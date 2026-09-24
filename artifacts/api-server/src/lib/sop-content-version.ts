/**
 * An SOP's steps changed — bump its content version so everyone who
 * reviewed the old version is flagged for a refresher (station SOP
 * training, migration 0117).
 *
 * Only step content counts: text, photos, videos, order. Title, station and
 * tag edits keep bumping updated_at on their own and deliberately leave the
 * version alone. Callers only call this when something really changed — an
 * autosave that re-sends identical text must not send the team back to
 * re-read it.
 *
 * Whoever made the change has, by definition, seen it: they're recorded as
 * reviewed at the new version. Consecutive edits by the same author within
 * an hour move one audit row forward rather than writing a row per save.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function markSopContentChanged(sopId: number | null | undefined, userId: number | null | undefined): Promise<void> {
  if (!sopId) return;
  const bumped = await db.execute<{ content_version: number }>(sql`
    UPDATE standards_sops
    SET content_version = content_version + 1, content_changed_at = NOW(), updated_at = NOW()
    WHERE id = ${sopId}
    RETURNING content_version
  `);
  const version = (bumped.rows ?? [])[0]?.content_version;
  if (version == null || !userId) return;

  const moved = await db.execute(sql`
    UPDATE sop_reviews SET content_version = ${version}, reviewed_at = NOW()
    WHERE id = (
      SELECT id FROM sop_reviews
      WHERE sop_id = ${sopId} AND user_id = ${userId} AND source = 'author'
        AND reviewed_at > NOW() - INTERVAL '1 hour'
      ORDER BY id DESC LIMIT 1
    )
  `);
  if (!moved.rowCount) {
    await db.execute(sql`
      INSERT INTO sop_reviews (sop_id, user_id, content_version, source)
      VALUES (${sopId}, ${userId}, ${version}, 'author')
    `);
  }
  await db.execute(sql`DELETE FROM sop_review_windows WHERE sop_id = ${sopId} AND user_id = ${userId}`);
}

/** The SOP a step belongs to. */
export async function sopIdForStep(stepId: number): Promise<number | null> {
  const r = await db.execute<{ sop_id: number }>(sql`SELECT sop_id FROM sop_steps WHERE id = ${stepId}`);
  return (r.rows ?? [])[0]?.sop_id ?? null;
}
