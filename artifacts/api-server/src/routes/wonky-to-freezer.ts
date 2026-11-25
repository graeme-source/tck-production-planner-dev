/**
 * POST /production-plans/:id/wonky-to-freezer — the Wonky Rack's "transfer
 * to the Product Freezer": every wonky pack on the plan goes into freezer
 * stock in one go. Moved out of the frozen production-plans router
 * (charter rule 4, 25 Nov 2026) and mounted AHEAD of it, so the path is
 * unchanged.
 *
 * For each plan item with wonky packs:
 *   1. ONE atomic update moves the item's wonly_count into freezer_qty and
 *      zeroes it — guarded on the count read, so two taps at once can't both
 *      transfer the same packs (the old read-then-write could);
 *   2. the recipe's production_freezer stock goes up (addRecipeFreezerStock —
 *      the same plain aggregate upsert as before);
 *   3. with F2F freezer pushes switched on (lib/f2f-freezer-push.ts), the
 *      packs are added to the recipe's F2F product in Shopify — the SAME
 *      F2F product as its other freezer packs. The screen has already shown
 *      "These will be added to Shopify: …" and the person confirmed
 *      (f2fConfirmed). A Shopify problem never undoes the transfer.
 *
 * Body (optional): { eventId?, f2fConfirmed? }. eventId is the screen's id
 * for this tap — the ledger key, so a repeat can't add to Shopify twice.
 * Returns { transferred: [{ itemId, recipeId, recipeName, qty }], totalQty,
 * f2f: { pushes, skipped, errors } | null }.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { addRecipeFreezerStock } from "../lib/fridge-stock";
import { RECORD_FAILED_MESSAGE, planF2fMove, pushF2fMove, type F2fMoveResult } from "../lib/f2f-freezer-push";
import { CLIENT_EVENT_ID } from "../lib/f2f-freezer-push-rules";

const router: IRouter = Router();

const Params = z.object({ id: z.coerce.number().int().positive() });
export const WonkyToFreezerBody = z.object({
  eventId: z.string().regex(CLIENT_EVENT_ID).optional(),
  f2fConfirmed: z.boolean().optional(),
}).optional();

router.post("/:id/wonky-to-freezer", validate(WonkyToFreezerBody), async (req: Request, res: Response) => {
  const parsed = Params.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const planId = parsed.data.id;
  const body = (req.body ?? {}) as NonNullable<z.infer<typeof WonkyToFreezerBody>>;
  const userId = req.session.userId ?? null;
  try {
    const items = await db
      .select({
        id: productionPlanItemsTable.id,
        recipeId: productionPlanItemsTable.recipeId,
        wonlyCount: productionPlanItemsTable.wonlyCount,
        recipeName: recipesTable.name,
      })
      .from(productionPlanItemsTable)
      .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .where(and(eq(productionPlanItemsTable.planId, planId), sql`${productionPlanItemsTable.wonlyCount} > 0`));

    const transferred: Array<{ itemId: number; recipeId: number | null; recipeName: string | null; qty: number }> = [];
    for (const item of items) {
      const qty = Number(item.wonlyCount) || 0;
      if (qty <= 0) continue;
      const [moved] = await db.update(productionPlanItemsTable)
        .set({ freezerQty: sql`${productionPlanItemsTable.freezerQty} + ${qty}`, wonlyCount: 0 })
        .where(and(eq(productionPlanItemsTable.id, item.id), eq(productionPlanItemsTable.wonlyCount, qty)))
        .returning({ id: productionPlanItemsTable.id });
      if (!moved) continue; // someone else moved them (or the count changed) — not ours to move
      if (item.recipeId) await addRecipeFreezerStock(item.recipeId, qty, "Wonky Rack → Product Freezer");
      transferred.push({ itemId: item.id, recipeId: item.recipeId, recipeName: item.recipeName ?? null, qty });
    }

    // F2F → Shopify (switched off = nothing here, exactly as before).
    let f2f: F2fMoveResult | null = null;
    try {
      const plan = await planF2fMove("wonky", transferred.flatMap(t => t.recipeId ? [{ recipeId: t.recipeId, packs: t.qty, planItemId: t.itemId }] : []));
      if (plan.enabled) f2f = await pushF2fMove({ plan, source: "wonky", clientEventId: body.eventId ?? randomUUID(), confirmed: body.f2fConfirmed === true, planId, userId });
    } catch (err) {
      console.error("[wonky-to-freezer] F2F Shopify step failed:", err);
      f2f = { pushes: [], skipped: [], errors: [RECORD_FAILED_MESSAGE] };
    }

    res.json({ transferred, totalQty: transferred.reduce((s, t) => s + t.qty, 0), f2f });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
