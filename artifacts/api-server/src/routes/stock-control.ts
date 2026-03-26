import { Router, type IRouter } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable, storageLocationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

// Location metadata — matches the `location` field values stored in stock_entries
const LOCATION_DEFS = [
  { key: "production_fridge",  label: "Production Fridge",  zone: "fridge",   icon: "fridge",   itemTypes: ["recipe"] },
  { key: "production_freezer", label: "Production Freezer", zone: "freezer",  icon: "freezer",  itemTypes: ["recipe"] },
  { key: "prep_fridge",        label: "Prep Fridge",        zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_meat_fridge",    label: "Raw Meat Fridge",    zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_freezer",        label: "Raw Freezer",        zone: "freezer",  icon: "freezer",  itemTypes: ["ingredient"] },
  { key: "dry_store",          label: "Dry Store",          zone: "ambient",  icon: "ambient",  itemTypes: ["ingredient"] },
] as const;

// GET /api/stock-control
// Returns a summary per storage location with per-recipe/ingredient breakdowns.
router.get("/", async (_req, res) => {
  // Fetch all non-zero stock entries, summing per (location, item_type, recipe_id/ingredient_id)
  const rows = await db.execute<{
    location: string;
    item_type: string;
    recipe_id: number | null;
    ingredient_id: number | null;
    total_qty: string;
    unit: string;
  }>(sql`
    SELECT
      location,
      item_type,
      recipe_id,
      ingredient_id,
      SUM(quantity) AS total_qty,
      MAX(unit) AS unit
    FROM stock_entries
    WHERE quantity::numeric > 0
    GROUP BY location, item_type, recipe_id, ingredient_id
    HAVING SUM(quantity) > 0
  `);

  // Build recipe & ingredient name maps for the IDs that appear
  const recipeIds = [...new Set(rows.rows.filter(r => r.recipe_id).map(r => r.recipe_id as number))];
  const ingredientIds = [...new Set(rows.rows.filter(r => r.ingredient_id).map(r => r.ingredient_id as number))];

  const recipeNames = new Map<number, { name: string; color: string | null }>();
  if (recipeIds.length > 0) {
    const recs = await db
      .select({ id: recipesTable.id, name: recipesTable.name, color: recipesTable.color })
      .from(recipesTable);
    for (const r of recs) recipeNames.set(r.id, { name: r.name, color: r.color ?? null });
  }

  const ingredientNames = new Map<number, string>();
  if (ingredientIds.length > 0) {
    const ings = await db
      .select({ id: ingredientsTable.id, name: ingredientsTable.name })
      .from(ingredientsTable);
    for (const i of ings) ingredientNames.set(i.id, i.name);
  }

  // Aggregate rows into the location structure
  const locationMap = new Map<string, {
    key: string;
    label: string;
    zone: string;
    icon: string;
    totalPacks: number;
    items: Array<{
      id: number;
      name: string;
      color: string | null;
      qty: number;
      unit: string;
      type: string;
    }>;
  }>();

  for (const def of LOCATION_DEFS) {
    locationMap.set(def.key, {
      key: def.key,
      label: def.label,
      zone: def.zone,
      icon: def.icon,
      totalPacks: 0,
      items: [],
    });
  }

  for (const row of rows.rows) {
    const qty = parseFloat(row.total_qty) || 0;
    if (qty <= 0) continue;

    let locEntry = locationMap.get(row.location);
    if (!locEntry) {
      // Unknown location — add it dynamically
      locEntry = {
        key: row.location,
        label: row.location.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        zone: "unknown",
        icon: "ambient",
        totalPacks: 0,
        items: [],
      };
      locationMap.set(row.location, locEntry);
    }

    let name = "Unknown";
    let color: string | null = null;
    let id = 0;

    if (row.item_type === "recipe" && row.recipe_id) {
      const rec = recipeNames.get(row.recipe_id);
      name = rec?.name ?? `Recipe #${row.recipe_id}`;
      color = rec?.color ?? null;
      id = row.recipe_id;
    } else if (row.ingredient_id) {
      name = ingredientNames.get(row.ingredient_id) ?? `Ingredient #${row.ingredient_id}`;
      id = row.ingredient_id;
    }

    locEntry.totalPacks += qty;
    locEntry.items.push({
      id,
      name,
      color,
      qty,
      unit: row.unit ?? "packs",
      type: row.item_type,
    });
  }

  // Sort items within each location by qty desc
  for (const loc of locationMap.values()) {
    loc.items.sort((a, b) => b.qty - a.qty);
  }

  // Also include user-created storage locations (not system) from the DB
  const userLocations = await db
    .select()
    .from(storageLocationsTable)
    .where(eq(storageLocationsTable.isSystem, false));

  for (const ul of userLocations) {
    const key = `sl_${ul.id}`;
    if (!locationMap.has(key)) {
      locationMap.set(key, {
        key,
        label: ul.name,
        zone: ul.zone,
        icon: ul.zone === "freezer" ? "freezer" : ul.zone === "fridge" ? "fridge" : "ambient",
        totalPacks: 0,
        items: [],
      });
    }
  }

  const productionFridgeTotal = locationMap.get("production_fridge")?.totalPacks ?? 0;

  res.json({
    productionFridgeTotal: Math.round(productionFridgeTotal),
    locations: [...locationMap.values()].filter(l =>
      l.items.length > 0 ||
      LOCATION_DEFS.some(d => d.key === l.key) ||
      l.key.startsWith("sl_")
    ),
  });
});

export default router;
