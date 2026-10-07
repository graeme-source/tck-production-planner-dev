// 8-pack bags in the production fridge, as real stock (Graeme, 2026-10-07).
//
//   GET /api/eight-pack-stock               → bags on hand per recipe
//   PUT /api/eight-pack-stock/:recipeId     → set the counted number
//
// Every write goes through adjustFridgeStock (pack size 8), so stock_entries,
// fridge_stock_batches and the fridge_stock_changes history stay in step
// exactly as they do for 2-packs. Wrapping adds bags; Shopify despatch takes
// them out (inventory-sync.ts); this endpoint is the hand count in between.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, stockEntriesTable, recipesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { adjustFridgeStock } from "../lib/fridge-stock";
import { EIGHT_PACK_SIZE } from "../lib/eight-pack-bags";

const router: IRouter = Router();

async function readBags(recipeId: number): Promise<{ quantity: number; checkedAt: Date } | null> {
  const [row] = await db
    .select({ quantity: stockEntriesTable.quantity, checkedAt: stockEntriesTable.checkedAt })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.recipeId, recipeId),
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
      eq(stockEntriesTable.packSize, EIGHT_PACK_SIZE),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt))
    .limit(1);
  return row ? { quantity: Math.max(0, Number(row.quantity) || 0), checkedAt: row.checkedAt } : null;
}

router.get("/", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      recipeId: stockEntriesTable.recipeId,
      quantity: stockEntriesTable.quantity,
      checkedAt: stockEntriesTable.checkedAt,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
      eq(stockEntriesTable.packSize, EIGHT_PACK_SIZE),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt));
  const seen = new Set<number>();
  const bags: Array<{ recipeId: number; bags: number; checkedAt: string }> = [];
  for (const r of rows) {
    if (r.recipeId == null || seen.has(r.recipeId)) continue;
    seen.add(r.recipeId);
    bags.push({ recipeId: r.recipeId, bags: Math.max(0, Math.round(Number(r.quantity) || 0)), checkedAt: r.checkedAt.toISOString() });
  }
  res.json({ bags });
});

const SetBagsBody = z.object({
  quantity: z.number().int().min(0).max(10_000),
  note: z.string().max(300).optional(),
});

router.put("/:recipeId", validate(SetBagsBody), async (req: Request, res: Response) => {
  const recipeId = Number(req.params.recipeId);
  if (!Number.isInteger(recipeId) || recipeId <= 0) {
    res.status(400).json({ error: "recipeId must be a positive integer" });
    return;
  }
  const [recipe] = await db.select({ id: recipesTable.id }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

  const { quantity, note } = req.body as z.infer<typeof SetBagsBody>;
  const current = await readBags(recipeId);
  const delta = quantity - (current ? Math.round(current.quantity) : 0);
  // A zero delta (count matches the record) is a no-op in the chokepoint.
  await adjustFridgeStock({
    recipeId,
    delta,
    packSize: EIGHT_PACK_SIZE,
    reason: note?.trim() || "Counted 8-pack bags (Stock Control)",
    source: "manual",
    userId: req.session.userId ?? null,
  });
  const after = await readBags(recipeId);
  res.json({ recipeId, bags: after ? Math.round(after.quantity) : 0, delta });
});

export default router;
