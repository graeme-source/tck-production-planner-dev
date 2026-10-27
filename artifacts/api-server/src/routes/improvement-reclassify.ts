/**
 * Change an idea into an improvement by hand, and sort its photos into
 * before and after (Graeme, 27 Oct 2026; Objective E): "someone has uploaded
 * an idea, but really it's an improvement. They've put two before photos
 * when really it should be before and after."
 *
 *   POST /api/improvements/:id/reclassify
 *     { kind: "improvement" | "idea", photos?: [{ id, role: "before" | "after" }] }
 *
 * Manager or admin only (guarded on the route, NOT the router: this router
 * is mounted at /improvements ahead of the main improvements router, so a
 * router-wide guard would lock everyone else out of the whole page).
 *
 *   kind "improvement" on an idea  — moves the photos, then sends it through
 *     submitForApproval: the SAME path as the after-photo upload and
 *     "I've done this". Credit, the approval step (if switched on) and the
 *     team celebration behave exactly as if it had been logged right first
 *     time. Nothing extra is awarded.
 *   kind "improvement" on an improvement — just re-sorts the photos.
 *   kind "idea" on an improvement  — the undo for a mistake: back to "to do",
 *     every photo back to before, done/approval stamps cleared. An approved
 *     one stops counting on the Leaner-board (credit only counts when
 *     approved — countsForCredit).
 *
 * Every change leaves a line in the improvement's Comments & photos
 * timeline under the manager's name — who changed it, and when.
 * The rules are pure in @workspace/db (improvement-reclassify.ts).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db, improvementSubmissionsTable, improvementCommentsTable, usersTable,
  planReclassify, reclassifyTimelineNote, stageOf, STAGE_LABEL,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { submitForApproval, refreshStitchedClip } from "./improvements";

const router: IRouter = Router();

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

const bodySchema = z.object({
  kind: z.enum(["improvement", "idea"]),
  photos: z.array(z.object({
    id: z.number().int().positive(),
    role: z.enum(["before", "after"]),
  })).max(100).optional(),
});

router.post("/:id/reclassify", requireManagerOrAdmin, validate(bodySchema), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid improvement" }); return; }
  const userId = req.session.userId ?? null;
  const { kind, photos } = req.body as z.infer<typeof bodySchema>;

  try {
    const [row] = await db.select().from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    if (!row) { res.status(404).json({ error: "This one's gone — it may have been deleted." }); return; }

    // The improvement's own evidence only: never a photo posted in its
    // comments, never the generated before/after clip.
    const evidence = rowsOf<{ id: number; phase: string | null }>(await db.execute(sql`
      SELECT id, phase FROM improvement_attachments
       WHERE improvement_id = ${id} AND comment_id IS NULL
         AND (phase IS NULL OR phase <> 'stitched')
       ORDER BY id
    `)).map(p => ({ id: Number(p.id), phase: p.phase }));

    const plan = planReclassify({ kind, currentStatus: row.progressStatus, evidence, assignments: photos });
    if (!plan.ok) { res.status(400).json({ error: plan.error }); return; }

    if (plan.statusChange === "none" && plan.changed.length === 0) {
      const stage = stageOf(row.progressStatus);
      res.json({ id, stage, stageLabel: STAGE_LABEL[stage], beforeCount: plan.beforeCount, afterCount: plan.afterCount, changed: false });
      return;
    }

    let userName: string | null = null;
    if (userId) {
      const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
      userName = user?.name ?? null;
    }

    await db.transaction(async tx => {
      for (const p of plan.changed) {
        await tx.execute(sql`
          UPDATE improvement_attachments SET phase = ${p.phase}
           WHERE id = ${p.id} AND improvement_id = ${id} AND comment_id IS NULL
        `);
      }
      if (plan.statusChange === "to_idea") {
        // Back to "to do": nothing about it is finished any more. Who is
        // credited stays — they get it again when it's genuinely done.
        await tx.update(improvementSubmissionsTable).set({
          progressStatus: "submitted_for_review",
          doneAt: null,
          approvedAt: null,
          approvedBy: null,
          approvedByName: null,
          reviewNote: null,
          updatedAt: new Date(),
        }).where(eq(improvementSubmissionsTable.id, id));
        // Nothing left to review — close this feature's own review task.
        await tx.execute(sql`
          UPDATE todo_tasks SET status = 'done', completed_at = NOW(), updated_at = NOW()
           WHERE improvement_id = ${id} AND created_by_name = 'Improvement review' AND status = 'open'
        `);
      } else if (plan.changed.length > 0) {
        await tx.update(improvementSubmissionsTable).set({ updatedAt: new Date() })
          .where(eq(improvementSubmissionsTable.id, id));
      }
      // Who changed it, in the timeline.
      await tx.insert(improvementCommentsTable).values({
        improvementId: id, userId, userName, comment: reclassifyTimelineNote(plan),
      });
    });

    // Finished: the same path as the after-photo upload and "I've done
    // this" — credit to whoever logged it, the approval step if it's on,
    // and the team celebration for a first completion.
    if (plan.statusChange === "to_improvement") {
      await submitForApproval(row, userId);
    }

    // The joined before/after clip was built from the old halves.
    if (plan.changed.length > 0 || plan.statusChange === "to_idea") {
      await refreshStitchedClip(id, "after reclassify");
    }

    console.log(`[Improvements] #${id} reclassified (${plan.statusChange}, ${plan.changed.length} photo(s) moved) by user ${userId}`);
    const [after] = await db.select({ progressStatus: improvementSubmissionsTable.progressStatus })
      .from(improvementSubmissionsTable).where(eq(improvementSubmissionsTable.id, id));
    const stage = stageOf(after?.progressStatus ?? row.progressStatus);
    res.json({
      id, stage, stageLabel: STAGE_LABEL[stage],
      beforeCount: plan.beforeCount, afterCount: plan.afterCount,
      removedCredit: plan.removesCredit, changed: true,
    });
  } catch (err) {
    console.error(`[Improvements] reclassify #${id} failed:`, err);
    res.status(500).json({ error: "Couldn't save the change — try again." });
  }
});

export default router;
