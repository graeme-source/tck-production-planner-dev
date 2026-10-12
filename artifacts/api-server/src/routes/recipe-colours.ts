/**
 * GET /api/recipes/colours — every recipe's identity colours in one small,
 * cacheable list: [{ id, color, secondaryColor }]. Objectives A and F.
 *
 * Station, plan and stock screens get the primary colour inside their own
 * payloads already; the optional secondary colour (migration 0185) is looked
 * up here by recipe id instead of being threaded through every one of those
 * endpoints (several live in routes/production-plans.ts, which takes no new
 * code). The frontend's useRecipeColours() caches this once per session.
 * Archived recipes are included so old plans still draw their colours.
 */
import { Router, type IRouter } from "express";
import { db, recipesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/colours", async (_req, res) => {
  const rows = await db
    .select({ id: recipesTable.id, color: recipesTable.color, secondaryColor: recipesTable.secondaryColor })
    .from(recipesTable);
  res.json(rows.map(r => ({ id: r.id, color: r.color ?? null, secondaryColor: r.secondaryColor ?? null })));
});

export default router;
