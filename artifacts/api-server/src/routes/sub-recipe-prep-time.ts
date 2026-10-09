/**
 * Standard prep time per sub-recipe (Graeme, 2026-10-09; Objectives C/E) —
 * mounted at /api/sub-recipes beside the main sub-recipes router.
 *
 *   GET /:id/standard-prep-minutes   anyone signed in
 *   PUT /:id/standard-prep-minutes   managers and admins; { standardPrepMinutes: 1–1440 | null }
 *
 * Minutes to make ONE batch (the sub-recipe's yield). Only pre-fills "How
 * long to make it again?" when the sub-recipe is wasted (migration 0153).
 * Its own endpoint so the field autosaves on its own, without the big
 * sub-recipe save.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, subRecipesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

const router: IRouter = Router();

function idOf(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid sub-recipe" }); return null; }
  return id;
}

router.get("/:id/standard-prep-minutes", async (req: Request, res: Response) => {
  const id = idOf(req, res);
  if (id == null) return;
  const [row] = await db.select({ standardPrepMinutes: subRecipesTable.standardPrepMinutes })
    .from(subRecipesTable).where(eq(subRecipesTable.id, id));
  if (!row) { res.status(404).json({ error: "Sub-recipe not found" }); return; }
  res.json({ standardPrepMinutes: row.standardPrepMinutes ?? null });
});

const Body = z.object({
  standardPrepMinutes: z.number().int("Whole minutes").min(1, "At least 1 minute").max(1440, "At most 24 hours").nullable(),
});

router.put("/:id/standard-prep-minutes", requireManagerOrAdmin, validate(Body), async (req: Request, res: Response) => {
  const id = idOf(req, res);
  if (id == null) return;
  const { standardPrepMinutes } = req.body as z.infer<typeof Body>;
  const [row] = await db.update(subRecipesTable).set({ standardPrepMinutes })
    .where(eq(subRecipesTable.id, id)).returning({ standardPrepMinutes: subRecipesTable.standardPrepMinutes });
  if (!row) { res.status(404).json({ error: "Sub-recipe not found" }); return; }
  res.json({ standardPrepMinutes: row.standardPrepMinutes ?? null });
});

export default router;
