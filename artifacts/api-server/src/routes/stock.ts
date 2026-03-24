import { Router, type IRouter } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable, stockItemsTable } from "@workspace/db";
import { eq, and, desc, notInArray } from "drizzle-orm";
import { CreateStockEntryBody, UpdateStockEntryBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";

const FREEZER_LOCATIONS = ["production_freezer", "raw_freezer"];

const router: IRouter = Router();

router.get("/factory-numbers", async (_req, res) => {
  const coreRecipes = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      isCoreMenu: recipesTable.isCoreMenu,
      packSize: recipesTable.packSize,
    })
    .from(recipesTable)
    .where(eq(recipesTable.isCoreMenu, true))
    .orderBy(recipesTable.name);

  const stockRows = await db
    .select({
      id: stockEntriesTable.id,
      recipeId: stockEntriesTable.recipeId,
      quantity: stockEntriesTable.quantity,
      checkedAt: stockEntriesTable.checkedAt,
      notes: stockEntriesTable.notes,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "recipe"),
      eq(stockEntriesTable.location, "production_fridge"),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt));

  const latestByRecipe: Record<number, { id: number; quantity: number; checkedAt: Date; notes: string | null }> = {};
  for (const row of stockRows) {
    if (row.recipeId != null && !latestByRecipe[row.recipeId]) {
      latestByRecipe[row.recipeId] = {
        id: row.id,
        quantity: Number(row.quantity),
        checkedAt: row.checkedAt,
        notes: row.notes,
      };
    }
  }

  const result = coreRecipes.map(r => {
    const stock = latestByRecipe[r.id];
    return {
      recipeId: r.id,
      recipeName: r.name,
      factoryNumber: stock ? stock.quantity : 0,
      lastChecked: stock ? stock.checkedAt.toISOString() : null,
      stockEntryId: stock ? stock.id : null,
    };
  });

  res.json(result);
});

router.get("/", async (req, res) => {
  const excludeFrozen = req.query.excludeFrozen === "true";
  const conditions = excludeFrozen ? [notInArray(stockEntriesTable.location, FREEZER_LOCATIONS)] : [];
  const rows = await db
    .select({
      id: stockEntriesTable.id,
      recipeId: stockEntriesTable.recipeId,
      recipeName: recipesTable.name,
      recipeColor: recipesTable.color,
      ingredientId: stockEntriesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      stockItemId: stockEntriesTable.stockItemId,
      stockItemName: stockItemsTable.name,
      itemType: stockEntriesTable.itemType,
      quantity: stockEntriesTable.quantity,
      unit: stockEntriesTable.unit,
      location: stockEntriesTable.location,
      checkedAt: stockEntriesTable.checkedAt,
      notes: stockEntriesTable.notes,
    })
    .from(stockEntriesTable)
    .leftJoin(recipesTable, eq(stockEntriesTable.recipeId, recipesTable.id))
    .leftJoin(ingredientsTable, eq(stockEntriesTable.ingredientId, ingredientsTable.id))
    .leftJoin(stockItemsTable, eq(stockEntriesTable.stockItemId, stockItemsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(stockEntriesTable.checkedAt);
  res.json(rows.map(r => ({ ...r, quantity: Number(r.quantity), checkedAt: r.checkedAt.toISOString() })));
});

router.post("/", validate(CreateStockEntryBody), async (req, res) => {
  const { recipeId, ingredientId, stockItemId, itemType, quantity, unit, location, notes } = req.body;
  const [row] = await db.insert(stockEntriesTable).values({
    recipeId: recipeId ?? null,
    ingredientId: ingredientId ?? null,
    stockItemId: stockItemId ?? null,
    itemType,
    quantity: String(quantity),
    unit,
    location: location ?? "production_fridge",
    notes,
  }).returning();
  res.status(201).json({ ...row, quantity: Number(row.quantity), checkedAt: row.checkedAt.toISOString() });
});

router.put("/:id", validate(UpdateStockEntryBody), async (req, res) => {
  const id = Number(req.params.id);
  const { recipeId, ingredientId, stockItemId, itemType, quantity, unit, location, notes } = req.body;
  const [row] = await db.update(stockEntriesTable).set({
    recipeId: recipeId ?? null,
    ingredientId: ingredientId ?? null,
    stockItemId: stockItemId ?? null,
    itemType,
    quantity: String(quantity),
    unit,
    location: location ?? "production_fridge",
    notes,
  }).where(eq(stockEntriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, quantity: Number(row.quantity), checkedAt: row.checkedAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(stockEntriesTable).where(eq(stockEntriesTable.id, id));
  res.status(204).send();
});

export default router;
