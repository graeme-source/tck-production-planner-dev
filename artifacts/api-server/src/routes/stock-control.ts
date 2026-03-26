import { Router, type IRouter } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable, storageLocationsTable } from "@workspace/db";

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
// Returns individual stock entries per location with their IDs for edit/delete.
router.get("/", async (_req, res) => {
  // Fetch all positive stock entries with their IDs
  const rows = await db
    .select({
      id: stockEntriesTable.id,
      location: stockEntriesTable.location,
      itemType: stockEntriesTable.itemType,
      recipeId: stockEntriesTable.recipeId,
      ingredientId: stockEntriesTable.ingredientId,
      quantity: stockEntriesTable.quantity,
      unit: stockEntriesTable.unit,
    })
    .from(stockEntriesTable);

  // Filter to positive quantities
  const positiveRows = rows.filter(r => parseFloat(String(r.quantity)) > 0);

  // Build recipe & ingredient name maps
  const recipeIds = [...new Set(positiveRows.filter(r => r.recipeId).map(r => r.recipeId as number))];
  const ingredientIds = [...new Set(positiveRows.filter(r => r.ingredientId).map(r => r.ingredientId as number))];

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

  // Fetch all DB locations upfront (both system and user-defined)
  const allDbLocs = await db.select().from(storageLocationsTable);
  const systemDbLocs = allDbLocs.filter(l => l.isSystem);
  const userDbLocs = allDbLocs.filter(l => !l.isSystem);

  // Build a lookup: normalised default label → DB record (for system locs)
  const systemByLabel = new Map(systemDbLocs.map(l => [l.name.toLowerCase(), l]));

  // Aggregate rows into the location structure
  const locationMap = new Map<string, {
    key: string;
    label: string;
    zone: string;
    icon: string;
    dbId: number | null;
    totalPacks: number;
    items: Array<{
      stockEntryId: number;
      id: number;
      name: string;
      color: string | null;
      qty: number;
      unit: string;
      type: string;
      recipeId: number | null;
      ingredientId: number | null;
    }>;
  }>();

  // Pre-populate system (hardcoded) locations
  for (const def of LOCATION_DEFS) {
    // Allow DB-stored name/zone to override the hardcoded defaults
    const dbLoc = systemByLabel.get(def.label.toLowerCase());
    locationMap.set(def.key, {
      key: def.key,
      label: dbLoc?.name ?? def.label,
      zone: dbLoc?.zone ?? def.zone,
      icon: def.icon,
      dbId: dbLoc?.id ?? null,
      totalPacks: 0,
      items: [],
    });
  }

  // Pre-populate user-defined locations so stock rows referencing sl_<id> keys
  // get correct metadata (label, zone, dbId) rather than an "unknown" placeholder
  for (const ul of userDbLocs) {
    const key = `sl_${ul.id}`;
    locationMap.set(key, {
      key,
      label: ul.name,
      zone: ul.zone,
      icon: ul.zone === "freezer" ? "freezer" : ul.zone === "fridge" ? "fridge" : "ambient",
      dbId: ul.id,
      totalPacks: 0,
      items: [],
    });
  }

  for (const row of positiveRows) {
    const qty = parseFloat(String(row.quantity)) || 0;
    if (qty <= 0) continue;

    let locEntry = locationMap.get(row.location);
    if (!locEntry) {
      // Truly unknown location key — add it dynamically as a fallback
      locEntry = {
        key: row.location,
        label: row.location.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        zone: "unknown",
        icon: "ambient",
        dbId: null,
        totalPacks: 0,
        items: [],
      };
      locationMap.set(row.location, locEntry);
    }

    let name = "Unknown";
    let color: string | null = null;
    let id = 0;

    if (row.itemType === "recipe" && row.recipeId) {
      const rec = recipeNames.get(row.recipeId);
      name = rec?.name ?? `Recipe #${row.recipeId}`;
      color = rec?.color ?? null;
      id = row.recipeId;
    } else if (row.ingredientId) {
      name = ingredientNames.get(row.ingredientId) ?? `Ingredient #${row.ingredientId}`;
      id = row.ingredientId;
    }

    locEntry.totalPacks += qty;
    locEntry.items.push({
      stockEntryId: row.id,
      id,
      name,
      color,
      qty,
      unit: row.unit ?? "packs",
      type: row.itemType,
      recipeId: row.recipeId ?? null,
      ingredientId: row.ingredientId ?? null,
    });
  }

  // Sort items within each location by qty desc
  for (const loc of locationMap.values()) {
    loc.items.sort((a, b) => b.qty - a.qty);
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
