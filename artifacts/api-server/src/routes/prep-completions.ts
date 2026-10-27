/**
 * Prep ticks — POST /production-plans/:id/prep-completions, moved out of the
 * frozen production-plans router (Graeme, 27 Oct 2026: "no completing prep
 * without opening the item"; Objectives C and I). Mounted ahead of it, so
 * every screen that ticks prep keeps calling the same path with the same
 * body and gets the same answers: 201 with the row, 409 "Already completed",
 * 409 on a draft plan. The undo endpoints stay where they were.
 *
 * What's new: after answering, the tick is recorded for timing
 * (services/prep-session-store.ts recordTickTiming) — linked to the
 * person's open session on the item, or, with nothing open, FLAGGED as
 * completed without opening. Flag-and-allow: the tick has already been
 * saved and answered, so timing can never block or slow prep, and a
 * timing failure is only logged.
 *
 * Body (zod): { ingredientId, recipeId, tinNumber, isSubRecipe?, subRecipeOriginId? }
 *   ingredientId is the sub-recipe's id when isSubRecipe is true (as before).
 *   subRecipeOriginId: the sub-recipe an ingredient came in through (cheddar
 *   via Breadcrumb Topping), stored in prep_completions.sub_recipe_id.
 * It records who did the work, so it sits in the daily PIN lock
 * (lib/pin-enforce.ts, "prep tick").
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { isPrepTin } from "../lib/prep-session-rules";
import { recordTickTiming } from "../services/prep-session-store";

const router: IRouter = Router();

const id = z.number().int().positive();
const TickBody = z.object({
  ingredientId: id,
  recipeId: id,
  tinNumber: z.number().int().min(0).max(10_000),
  isSubRecipe: z.boolean().optional(),
  subRecipeOriginId: id.nullish(),
});
const Params = z.object({ id: z.coerce.number().int().positive() });

const DRAFT_COMPLETION_ERROR = "Plan is a draft — activate before recording completions.";

async function planIsDraft(planId: number): Promise<boolean> {
  const r = await db.execute<{ status: string }>(sql`SELECT status FROM production_plans WHERE id = ${planId}`);
  return r.rows[0]?.status === "draft";
}

async function nameOf(userId: number | null): Promise<string | null> {
  if (userId == null) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}

router.post("/:id/prep-completions", validate(TickBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const planId = params.data.id;
  const { ingredientId, recipeId, tinNumber, isSubRecipe, subRecipeOriginId } = req.body as z.infer<typeof TickBody>;
  if (await planIsDraft(planId)) { res.status(409).json({ error: DRAFT_COMPLETION_ERROR }); return; }
  const userId = req.session.userId ?? null;

  // Raw SQL, exactly as before, so an origin-tagged ingredient tick keeps its
  // sub_recipe_id and the partial unique indexes (uq_prep_completion_ing /
  // _sub) decide what counts as "already completed".
  const result = await db.execute(isSubRecipe ? sql`
    INSERT INTO prep_completions (plan_id, sub_recipe_id, recipe_id, tin_number, user_id, completed_at)
    VALUES (${planId}, ${ingredientId}, ${recipeId}, ${tinNumber}, ${userId}, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id, sub_recipe_id AS "ingredientId", recipe_id AS "recipeId",
              tin_number AS "tinNumber", user_id AS "userId", completed_at AS "completedAt"
  ` : sql`
    INSERT INTO prep_completions (plan_id, ingredient_id, sub_recipe_id, recipe_id, tin_number, user_id, completed_at)
    VALUES (${planId}, ${ingredientId}, ${subRecipeOriginId ?? null}, ${recipeId}, ${tinNumber}, ${userId}, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id, ingredient_id AS "ingredientId", sub_recipe_id AS "subRecipeOriginId",
              recipe_id AS "recipeId", tin_number AS "tinNumber",
              user_id AS "userId", completed_at AS "completedAt"
  `);
  const row = result.rows[0] as (Record<string, unknown> & { id: number }) | undefined;
  if (!row) { res.status(409).json({ error: "Already completed" }); return; }
  res.status(201).json({ ...row, isSubRecipe: !!isSubRecipe, userName: await nameOf(userId) });

  // After answering: time the tick, or flag it as completed without opening.
  if (isPrepTin(tinNumber)) {
    recordTickTiming(row.id).catch(err => {
      console.warn("[prep-completions] timing not recorded for tick", row.id, err instanceof Error ? err.message : err);
    });
  }
});

export default router;
