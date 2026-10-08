/**
 * Taking wrapped packs back OUT — the wrapping station's undo, moved out of
 * the frozen production-plans router (Graeme, 2026-10-08). Mounted under
 * /production-plans AHEAD of that router, so the paths are unchanged:
 *
 *   DELETE /production-plans/:id/items/:itemId/fridge    packs (or 8-pack bags) out of the Production Fridge
 *   DELETE /production-plans/:id/items/:itemId/freezer   packs out of the Product Freezer
 *
 * Body (both): { qty, packSize?: 2 | 8, confirm: true, reason, otherText? }.
 * `confirm: true` and a reason are REQUIRED (lib/wrapping-undo.ts,
 * TakeBackOutBody) — the old body { qty } alone is refused with 400, so a
 * single stray tap or replayed request can never move stock. The screen
 * only sends it after its two-step confirmation.
 *
 * Fridge: the plan item's count drops (floor 0), and the recipe's fridge
 * stock goes through adjustFridgeStock — the one chokepoint — taking the
 * packs back from this plan's own julian batch first. The Stock Control
 * history row carries who (session user) and why ("Undo wrapped — Added
 * twice"), and logs what ACTUALLY changed: on 8 Oct the old handler logged
 * "−20" against a fridge that already held 0 for that recipe.
 *
 * Freezer: only the plan item's freezer count moves (as before — that
 * endpoint never wrote stock); the confirmation is required all the same.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, productionPlanItemsTable, productionPlansTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { adjustFridgeStock } from "../lib/fridge-stock";
import { TakeBackOutBody, undoNote } from "../lib/wrapping-undo";

const router: IRouter = Router();

const Params = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

async function findItem(planId: number, itemId: number) {
  const [item] = await db
    .select({ id: productionPlanItemsTable.id, recipeId: productionPlanItemsTable.recipeId })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  return item ?? null;
}

router.delete("/:id/items/:itemId/fridge", validate(TakeBackOutBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const { id: planId, itemId } = params.data;
  const body = req.body as TakeBackOutBody;
  const packSize = body.packSize ?? 2;
  const qty = body.qty;

  const item = await findItem(planId, itemId);
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set(packSize === 8
      ? { fridgeEightPackQty: sql`GREATEST(${productionPlanItemsTable.fridgeEightPackQty} - ${qty}, 0)` }
      : { fridgeQty: sql`GREATEST(${productionPlanItemsTable.fridgeQty} - ${qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({
      fridgeQty: productionPlanItemsTable.fridgeQty,
      fridgeEightPackQty: productionPlanItemsTable.fridgeEightPackQty,
    });

  const [plan] = await db
    .select({ batchNumber: productionPlansTable.batchNumber })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId));

  const result = await adjustFridgeStock({
    recipeId: item.recipeId,
    delta: -qty,
    packSize,
    reason: undoNote(body.reason, body.otherText, packSize),
    source: "wrapping",
    userId: req.session.userId ?? null,
    preferBatchNumber: plan?.batchNumber ?? null,
  });

  console.info("[wrapping-undo]", JSON.stringify({
    planId, itemId, recipeId: item.recipeId, qty, packSize,
    reason: body.reason, userId: req.session.userId ?? null,
    appliedDelta: result.appliedDelta, shortfall: result.aggregateShortfall,
    where: "production fridge",
  }));

  res.json({
    itemId,
    fridgeQty: updated.fridgeQty,
    fridgeEightPackQty: updated.fridgeEightPackQty,
    stockAppliedDelta: result.appliedDelta,
    stockShortfall: result.aggregateShortfall,
  });
});

router.delete("/:id/items/:itemId/freezer", validate(TakeBackOutBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const { id: planId, itemId } = params.data;
  const body = req.body as TakeBackOutBody;

  const item = await findItem(planId, itemId);
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db
    .update(productionPlanItemsTable)
    .set({ freezerQty: sql`GREATEST(${productionPlanItemsTable.freezerQty} - ${body.qty}, 0)` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ freezerQty: productionPlanItemsTable.freezerQty });

  console.info("[wrapping-undo]", JSON.stringify({
    planId, itemId, recipeId: item.recipeId, qty: body.qty,
    reason: body.reason, otherText: body.otherText ?? null, userId: req.session.userId ?? null,
    where: "product freezer",
  }));

  res.json({ itemId, freezerQty: updated.freezerQty });
});

export default router;
