/**
 * /api/dpt-schedules — scheduled DPT rules (lib/dpt-schedules.ts, migration
 * 0264). Same access as DPT itself (managers and admins).
 *
 *   GET    /           every rule with its recipe name, newest start first
 *   POST   /           { recipeId, startsOn, endsOn?, extraBatches, reason? }
 *   POST   /:id/end    end it now (plans from today on stop following it)
 *   DELETE /:id        remove a rule that hasn't started yet
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@workspace/db";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function nameOf(userId: number | undefined): Promise<string | null> {
  if (!userId) return null;
  const r = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${userId}`);
  return r.rows[0]?.name ?? null;
}

router.get("/", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT s.id, s.recipe_id AS "recipeId", r.name AS "recipeName",
           to_char(s.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(s.ends_on, 'YYYY-MM-DD') AS "endsOn",
           s.extra_batches AS "extraBatches", s.reason, s.created_by_name AS "createdBy", s.created_at AS "createdAt",
           s.ended_at AS "endedAt", s.ended_by_name AS "endedBy"
      FROM dpt_schedules s JOIN recipes r ON r.id = s.recipe_id
     ORDER BY s.starts_on DESC, s.id DESC
  `);
  res.json({ today: londonDateString(), schedules: rows.rows });
});

const createBody = z.object({
  recipeId: z.number().int().positive(),
  startsOn: DATE,
  endsOn: DATE.nullish(),
  extraBatches: z.number().int().min(0).max(50),
  reason: z.string().trim().max(300).nullish(),
}).refine(b => !b.endsOn || b.endsOn >= b.startsOn, { message: "The end date is before the start date" });

router.post("/", validate(createBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof createBody>;
  const recipe = await db.execute<{ id: number }>(sql`SELECT id FROM recipes WHERE id = ${b.recipeId}`);
  if (!recipe.rows[0]) { res.status(400).json({ error: "That recipe doesn't exist" }); return; }
  const by = await nameOf(req.session.userId);
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO dpt_schedules (recipe_id, starts_on, ends_on, extra_batches, reason, created_by, created_by_name)
    VALUES (${b.recipeId}, ${b.startsOn}, ${b.endsOn ?? null}, ${b.extraBatches}, ${b.reason || null}, ${req.session.userId ?? null}, ${by})
    RETURNING id
  `);
  res.status(201).json({ id: rows.rows[0].id });
});

const noBody = z.object({}).passthrough();

router.post("/:id/end", validate(noBody), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Rule not found" }); return; }
  const by = await nameOf(req.session.userId);
  // Ends from today: plans for today onwards stop following it.
  const today = londonDateString();
  const rows = await db.execute(sql`
    UPDATE dpt_schedules SET ended_at = NOW(), ended_by_name = ${by},
           ends_on = LEAST(COALESCE(ends_on, ${today}::date), (${today}::date - 1))
     WHERE id = ${id} AND ended_at IS NULL RETURNING id
  `);
  if (!rows.rows[0]) { res.status(404).json({ error: "Rule not found or already ended" }); return; }
  res.json({ ok: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(404).json({ error: "Rule not found" }); return; }
  // Only a rule that hasn't started yet — a started one is history (plans
  // were made with it), so it's ended instead.
  const rows = await db.execute(sql`DELETE FROM dpt_schedules WHERE id = ${id} AND starts_on > ${londonDateString()}::date RETURNING id`);
  if (!rows.rows[0]) { res.status(400).json({ error: "A rule that has started can only be ended, not deleted" }); return; }
  res.json({ ok: true });
});

export default router;
