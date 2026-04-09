import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable, stockItemsTable, usersTable } from "@workspace/db";
import { eq, and, desc, notInArray } from "drizzle-orm";
import { CreateStockEntryBody, UpdateStockEntryBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { FACTORY_NUMBER_CORE_MENU_ONLY } from "../lib/inventory-sync";

const FREEZER_LOCATIONS = ["production_freezer", "raw_freezer"];

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session.userRole === "admin") { next(); return; }
  if (req.session.userId && !req.session.userRole) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.session.userId));
    if (user) {
      req.session.userRole = user.role as "admin" | "manager" | "viewer";
      if (user.role === "admin") { next(); return; }
    }
  }
  res.status(403).json({ error: "Admin access required" });
}

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

// ─── Factory number accounting loop ──────────────────────────────────

/**
 * Returns the runtime config for the factory-number feature, so the
 * frontend can adjust its UI (column header badge text). Kept separate
 * from the /factory-numbers data endpoint so both can be cached/used
 * independently.
 */
router.get("/factory-number-config", async (_req, res) => {
  res.json({ coreMenuOnly: FACTORY_NUMBER_CORE_MENU_ONLY });
});

/**
 * One-off admin reset for the production fridge stock counters.
 *
 * Inserts a fresh row with quantity=0 at location='production_fridge'
 * for every recipe in scope (core-menu only while the feature flag is
 * on). Because /calculate reads the LATEST stock_entries row per
 * recipe, adding a new zero row effectively resets the visible value
 * without destroying historical data — the old rows are still there
 * for audit, just no longer latest.
 *
 * Intended to be run once to clear the accumulated bloat before the
 * closed fulfilment-decrement loop goes live. Re-running is safe
 * (creates additional zero rows).
 */
router.post("/reset-fridge-stock", requireAdmin, async (_req, res) => {
  const whereConds = FACTORY_NUMBER_CORE_MENU_ONLY
    ? [eq(recipesTable.isCoreMenu, true)]
    : [];
  const recipes = await db
    .select({ id: recipesTable.id, name: recipesTable.name })
    .from(recipesTable)
    .where(whereConds.length ? and(...whereConds) : undefined)
    .orderBy(recipesTable.name);

  if (recipes.length === 0) {
    res.json({ reset: [], count: 0, coreMenuOnly: FACTORY_NUMBER_CORE_MENU_ONLY });
    return;
  }

  const now = new Date();
  await db.insert(stockEntriesTable).values(
    recipes.map(r => ({
      recipeId: r.id,
      itemType: "recipe",
      quantity: "0",
      unit: "packs",
      location: "production_fridge",
      checkedAt: now,
      notes: "Factory number reset",
    }))
  );

  res.json({
    reset: recipes.map(r => ({ recipeId: r.id, recipeName: r.name })),
    count: recipes.length,
    coreMenuOnly: FACTORY_NUMBER_CORE_MENU_ONLY,
    resetAt: now.toISOString(),
  });
});

export default router;
