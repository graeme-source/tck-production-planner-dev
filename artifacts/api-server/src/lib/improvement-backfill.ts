import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { queueReviewTodo } from "./improvement-review-todo";

const GUARD_KEY = "improvement_auto_submit_backfill_v1";

/**
 * One-time repair for improvements that were finished but never sent.
 *
 * Until 2026-09-04 a photo and a separate "I've done this" tap were two
 * steps, and people only did the first — Lorna's ice shelf sat in "to do"
 * for a day while she believed it was done. A title and one photo is now the
 * submission in its own right (routes/improvements.ts, on upload), and this
 * brings the ones already stuck into line with that rule.
 *
 * Deliberately quiet: no celebration push for work that's days old. It does
 * queue the founder's review task, because that's the whole point — the
 * backlog needs looking at.
 *
 * Guarded on _migrations_done so it runs once, ever.
 */
export async function backfillAutoSubmittedImprovements(): Promise<void> {
  try {
    const done = await db.execute<{ key: string }>(
      sql`SELECT key FROM _migrations_done WHERE key = ${GUARD_KEY}`,
    );
    if ((done.rows ?? []).length > 0) return;

    // "To do" is every status except the three that mean it has moved on —
    // the dead July-2026 values (acknowledged, in_development, …) all read
    // as to-do, same as stageOf() in lib/db.
    //
    // An AFTER shot (or an unlabelled one from before the before/after
    // split) only — same rule as isCompletionMedia. A before-only row is an
    // idea somebody logged and hasn't done yet: #44, the movable nozzle hose,
    // is exactly that, and sweeping it into the approval queue would be wrong.
    const updated = await db.execute<{ id: number; title: string }>(sql`
      UPDATE improvement_submissions s
         SET progress_status = 'awaiting_approval',
             done_at         = COALESCE(s.done_at, NOW()),
             credited_to     = COALESCE(s.credited_to, s.submitted_by),
             credited_to_name = COALESCE(s.credited_to_name, s.submitted_by_name),
             review_note     = NULL,
             updated_at      = NOW()
       WHERE s.progress_status NOT IN ('complete', 'awaiting_approval', 'rejected')
         AND EXISTS (
               SELECT 1 FROM improvement_attachments a
                WHERE a.improvement_id = s.id
                  AND (a.phase IS NULL OR a.phase = 'after')
             )
      RETURNING s.id, s.title
    `);

    const rows = updated.rows ?? [];
    for (const r of rows) {
      await queueReviewTodo(Number(r.id), String(r.title));
    }

    await db.execute(sql`INSERT INTO _migrations_done (key) VALUES (${GUARD_KEY}) ON CONFLICT DO NOTHING`);
    console.log(
      rows.length > 0
        ? `[Improvements] Backfill: sent ${rows.length} finished improvement(s) for approval — ${rows.map(r => `#${r.id} ${r.title}`).join(", ")}`
        : "[Improvements] Backfill: nothing was stuck.",
    );
  } catch (err) {
    console.error("[Improvements] Auto-submit backfill failed (non-fatal):", err);
  }
}
