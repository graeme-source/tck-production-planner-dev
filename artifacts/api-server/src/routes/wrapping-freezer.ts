/**
 * POST /production-plans/:id/items/:itemId/freezer — wrapped packs into the
 * Product Freezer. Moved out of the frozen production-plans router (charter
 * rule 4) and mounted AHEAD of it, so the path is unchanged.
 *
 * Body: { qty, eventId? }. eventId is the screen's id for this one tap (the
 * wrap-to-Shopify ledger key); a missing one is made up here.
 *
 * What a freezer add now does (Graeme, 16 Oct 2026), in this order:
 *   1. the plan item's freezer count goes up (as before);
 *   2. the recipe's production_freezer stock goes up and the change is logged
 *      to fridge_stock_changes (location production_freezer, source
 *      wrapping) — until now the stock record never moved, and the wrapping
 *      pace never saw freezer wraps;
 *   3. for a recipe flagged shopify_push_on_wrap, +qty goes to the mapped
 *      Shopify variant through the ledger (lib/shopify-wrap-push.ts). Its
 *      outcome comes back as `shopify` and is shown on the wrapping screen;
 *      a Shopify problem never undoes the stock — the packs ARE in the
 *      freezer — it is recorded and offered for retry.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, productionPlanItemsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";
import { adjustRecipeFreezerStock } from "../lib/fridge-stock";
import { recordWrapPush } from "../lib/shopify-wrap-push";
import { CLIENT_EVENT_ID } from "../lib/shopify-wrap-push-rules";

const router: IRouter = Router();

const Params = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export const FreezerAddBody = z.object({
  qty: z.number().int().min(1).max(10_000),
  eventId: z.string().regex(CLIENT_EVENT_ID).optional(),
});

router.post("/:id/items/:itemId/freezer", validate(FreezerAddBody), async (req: Request, res: Response) => {
  const params = Params.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid plan or item id" }); return; }
  const { id: planId, itemId } = params.data;
  const body = req.body as z.infer<typeof FreezerAddBody>;
  const userId = req.session.userId ?? null;

  const [item] = await db
    .select({ id: productionPlanItemsTable.id, recipeId: productionPlanItemsTable.recipeId })
    .from(productionPlanItemsTable)
    .where(and(eq(productionPlanItemsTable.id, itemId), eq(productionPlanItemsTable.planId, planId)));
  if (!item) { res.status(404).json({ error: "Plan item not found" }); return; }

  const [updated] = await db.update(productionPlanItemsTable)
    .set({ freezerQty: sql`${productionPlanItemsTable.freezerQty} + ${body.qty}` })
    .where(eq(productionPlanItemsTable.id, itemId))
    .returning({ freezerQty: productionPlanItemsTable.freezerQty });

  let stock: { newQty: number } | null = null;
  try {
    stock = await adjustRecipeFreezerStock({ recipeId: item.recipeId, delta: body.qty, note: "Wrapped into the Product Freezer", userId });
  } catch (err) {
    // The plan count already moved; say so loudly rather than hide it.
    console.error("[wrapping-freezer] freezer stock write failed:", err);
  }

  const shopify = await recordWrapPush({
    kind: "wrap", planId, planItemId: itemId, recipeId: item.recipeId,
    packs: body.qty, clientEventId: body.eventId ?? randomUUID(), userId,
  }).catch(err => {
    console.error("[wrapping-freezer] Shopify ledger write failed:", err);
    return { status: "failed" as const, error: "Couldn't record the Shopify update — tell a manager.", id: null, delta: body.qty };
  });

  res.json({
    itemId,
    freezerQty: updated.freezerQty,
    freezerStock: stock?.newQty ?? null,
    stockError: stock ? null : "The freezer stock record didn't update — tell a manager.",
    shopify: shopify ? { id: shopify.id, status: shopify.status, delta: shopify.delta, error: shopify.error } : null,
  });
});

export default router;
