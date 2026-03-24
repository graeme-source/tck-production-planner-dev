import { Router, type IRouter } from "express";
import { db, stockTransfersTable, stockEntriesTable, ingredientsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

const CreateTransferBody = z.object({
  ingredientId: z.number().int().positive().nullable(),
  fromLocation: z.string().min(1),
  toLocation: z.string().min(1),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  notes: z.string().nullish(),
});

router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db
    .select({
      id: stockTransfersTable.id,
      ingredientId: stockTransfersTable.ingredientId,
      ingredientName: ingredientsTable.name,
      fromLocation: stockTransfersTable.fromLocation,
      toLocation: stockTransfersTable.toLocation,
      quantity: stockTransfersTable.quantity,
      unit: stockTransfersTable.unit,
      transferredAt: stockTransfersTable.transferredAt,
      userId: stockTransfersTable.userId,
      notes: stockTransfersTable.notes,
    })
    .from(stockTransfersTable)
    .leftJoin(ingredientsTable, eq(stockTransfersTable.ingredientId, ingredientsTable.id))
    .orderBy(desc(stockTransfersTable.transferredAt))
    .limit(limit);

  res.json(rows.map(r => ({
    ...r,
    quantity: Number(r.quantity),
    transferredAt: r.transferredAt.toISOString(),
  })));
});

router.post("/", validate(CreateTransferBody), async (req, res) => {
  const { ingredientId, fromLocation, toLocation, quantity, unit, notes } = req.body;

  if (fromLocation === toLocation) {
    res.status(400).json({ error: "From and To locations must be different" });
    return;
  }

  const userId = (req.session as Record<string, unknown>).userId as number | undefined;

  const [row] = await db.insert(stockTransfersTable).values({
    ingredientId: ingredientId || null,
    fromLocation,
    toLocation,
    quantity: String(quantity),
    unit,
    userId: userId || null,
    notes: notes || null,
  }).returning();

  await db.insert(stockEntriesTable).values({
    ingredientId: ingredientId || null,
    recipeId: null,
    itemType: "ingredient",
    quantity: String(-quantity),
    unit,
    location: fromLocation,
    notes: `Transfer out to ${toLocation}`,
  });

  await db.insert(stockEntriesTable).values({
    ingredientId: ingredientId || null,
    recipeId: null,
    itemType: "ingredient",
    quantity: String(quantity),
    unit,
    location: toLocation,
    notes: `Transfer in from ${fromLocation}`,
  });

  res.status(201).json({
    ...row,
    quantity: Number(row.quantity),
    transferredAt: row.transferredAt.toISOString(),
    ingredientName: null,
  });
});

export default router;
