/**
 * Ticks for LINKED prep rows — derived tasks like pasta cooking water and
 * salt that aren't recipe ingredients but are still work someone does and
 * wants to strike off (Graeme, 2026-09-09).
 *
 * Lives in its own file (and its own tiny table) rather than inside the
 * prep-completions machinery: the charter forbids growing
 * routes/production-plans.ts, and these rows have no ingredient/recipe ids
 * for prep_completions' columns anyway. Keys are minted server-side where
 * the linked row is built (e.g. "pasta_water:<ingredientId>").
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/** Draft plans don't take ticks — same rule as ordinary prep completions. */
async function planIsDraft(planId: number): Promise<boolean> {
  const rows = await db.execute<{ status: string }>(sql`
    SELECT status FROM production_plans WHERE id = ${planId}
  `);
  return rows.rows[0]?.status === "draft";
}

const keySchema = z.object({ key: z.string().min(1).max(200) });

// GET /:planId — every linked tick on the plan, with who ticked it.
router.get("/:planId", requireAuth, async (req, res) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const rows = await db.execute<{
    id: number; linked_key: string; user_id: number | null; user_name: string | null; completed_at: string;
  }>(sql`
    SELECT c.id, c.linked_key, c.user_id, u.name AS user_name, c.completed_at
    FROM prep_linked_completions c
    LEFT JOIN app_users u ON u.id = c.user_id
    WHERE c.plan_id = ${planId}
  `);
  res.json(rows.rows.map(r => ({
    id: r.id, key: r.linked_key, userId: r.user_id, userName: r.user_name, completedAt: r.completed_at,
  })));
});

// POST /:planId — tick. Idempotent: a second tick of the same key answers
// with the existing state rather than an error, so two iPads can't fight.
router.post("/:planId", requireAuth, validate(keySchema), async (req, res) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  if (await planIsDraft(planId)) { res.status(409).json({ error: "This plan is still a draft — activate it before ticking prep." }); return; }
  const { key } = req.body as z.infer<typeof keySchema>;
  await db.execute(sql`
    INSERT INTO prep_linked_completions (plan_id, linked_key, user_id)
    VALUES (${planId}, ${key}, ${req.session.userId})
    ON CONFLICT (plan_id, linked_key) DO NOTHING
  `);
  res.status(201).json({ ok: true });
});

// DELETE /:planId — untick.
router.delete("/:planId", requireAuth, validate(keySchema), async (req, res) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { key } = req.body as z.infer<typeof keySchema>;
  await db.execute(sql`
    DELETE FROM prep_linked_completions WHERE plan_id = ${planId} AND linked_key = ${key}
  `);
  res.json({ ok: true });
});

export default router;
