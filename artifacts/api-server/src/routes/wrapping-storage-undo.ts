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
 * Freezer: the plan item's freezer count drops, the recipe's
 * production_freezer stock drops and is logged (16 Oct 2026 — it never
 * moved before), and a recipe flagged shopify_push_on_wrap gets the packs
 * taken off its Shopify variant again (lib/shopify-wrap-push.ts).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, productionPlanItemsTable, productionPlansTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { randomUUID } from "node:crypto";
import { adjustFridgeStock, adjustRecipeFreezerStock } from "../lib/fridge-stock";
import { recordWrapPush } from "../lib/shopify-wrap-push";
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
  const userId = req.session.userId ?? null;

  const item = await findItem(planId, itemId);
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  // Read-and-decrement in one statement so the packs actually removed (the
  // count floors at 0) are known exactly — that is what stock and Shopify
  // get back, never more than went in.
  const moved = await db.execute<{ before: number; after: number }>(sql`
    WITH prev AS (SELECT freezer_qty FROM production_plan_items WHERE id = ${itemId} FOR UPDATE)
    UPDATE production_plan_items i
       SET freezer_qty = GREATEST(prev.freezer_qty - ${body.qty}, 0)
      FROM prev
     WHERE i.id = ${itemId}
    RETURNING prev.freezer_qty AS before, i.freezer_qty AS after
  `);
  const before = Number(moved.rows[0]?.before ?? 0);
  const after = Number(moved.rows[0]?.after ?? 0);
  const removed = Math.max(0, before - after);

  // Freezer stock + the change log, like the fridge (Graeme, 16 Oct 2026).
  let stock: { newQty: number; appliedDelta: number; shortfall: number } | null = null;
  if (removed > 0) {
    try {
      stock = await adjustRecipeFreezerStock({
        recipeId: item.recipeId, delta: -removed, note: undoNote(body.reason, body.otherText, 2), userId,
      });
    } catch (err) {
      console.error("[wrapping-undo] freezer stock write failed:", err);
    }
  }

  // Recipes that push to Shopify on wrap get the packs taken off again.
  const shopify = removed > 0
    ? await recordWrapPush({
        kind: "take_back", planId, planItemId: itemId, recipeId: item.recipeId,
        packs: removed, clientEventId: body.eventId ?? randomUUID(), userId,
      }).catch(err => {
        console.error("[wrapping-undo] Shopify ledger write failed:", err);
        return null;
      })
    : null;

  console.info("[wrapping-undo]", JSON.stringify({
    planId, itemId, recipeId: item.recipeId, qty: body.qty, removed,
    reason: body.reason, otherText: body.otherText ?? null, userId,
    stockAppliedDelta: stock?.appliedDelta ?? null, shopify: shopify?.status ?? null,
    where: "product freezer",
  }));

  res.json({
    itemId,
    freezerQty: after,
    removed,
    freezerStock: stock?.newQty ?? null,
    shopify: shopify ? { id: shopify.id, status: shopify.status, delta: shopify.delta, error: shopify.error } : null,
  });
});

export default router;
