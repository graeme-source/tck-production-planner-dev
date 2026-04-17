import { Router, type IRouter, type Request, type Response } from "express";
import { db, stockEntriesTable, recipesTable, ingredientsTable, storageLocationsTable } from "@workspace/db";
import { productionPlanItemsTable, productionPlansTable } from "@workspace/db";
import { and, desc, eq, gte, lt } from "drizzle-orm";

const router: IRouter = Router();

const LOCATION_DEFS = [
  { key: "production_fridge",  label: "Production Fridge",  zone: "fridge",   icon: "fridge",   itemTypes: ["recipe"] },
  { key: "production_freezer", label: "Production Freezer", zone: "freezer",  icon: "freezer",  itemTypes: ["recipe"] },
  { key: "prep_fridge",        label: "Prep Fridge",        zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_meat_fridge",    label: "Raw Meat Fridge",    zone: "fridge",   icon: "fridge",   itemTypes: ["ingredient"] },
  { key: "raw_freezer",        label: "Raw Freezer",        zone: "freezer",  icon: "freezer",  itemTypes: ["ingredient"] },
  { key: "dry_store",          label: "Dry Store",          zone: "ambient",  icon: "ambient",  itemTypes: ["ingredient"] },
] as const;

interface AggItem {
  stockEntryIds: number[];
  id: number;
  name: string;
  color: string | null;
  qty: number;
  unit: string;
  type: string;
  recipeId: number | null;
  ingredientId: number | null;
  orderPosition: number;
}

router.get("/", async (_req, res) => {
  const rows = await db
    .select({
      id: stockEntriesTable.id,
      location: stockEntriesTable.location,
      itemType: stockEntriesTable.itemType,
      recipeId: stockEntriesTable.recipeId,
      ingredientId: stockEntriesTable.ingredientId,
      quantity: stockEntriesTable.quantity,
      unit: stockEntriesTable.unit,
      checkedAt: stockEntriesTable.checkedAt,
    })
    .from(stockEntriesTable)
    .orderBy(desc(stockEntriesTable.checkedAt));

  // Use latest entry per item+location as the current stock level (snapshot model).
  // Each stock entry represents the cumulative quantity at that point in time.
  const latestSeen = new Set<string>();
  const latestRows = rows.filter(r => {
    const itemId = r.itemType === "recipe" ? `r:${r.recipeId}` : `i:${r.ingredientId}`;
    const key = `${r.location}|${itemId}`;
    if (latestSeen.has(key)) return false;
    latestSeen.add(key);
    return true;
  });

  const positiveRows = latestRows.filter(r => parseFloat(String(r.quantity)) > 0);

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

  const recipeOrder = new Map<number, number>();
  const latestPlans = await db
    .select({ id: productionPlansTable.id })
    .from(productionPlansTable)
    .orderBy(desc(productionPlansTable.planDate))
    .limit(1);
  if (latestPlans.length > 0) {
    const planItems = await db
      .select({ recipeId: productionPlanItemsTable.recipeId, orderPosition: productionPlanItemsTable.orderPosition })
      .from(productionPlanItemsTable)
      .where(eq(productionPlanItemsTable.planId, latestPlans[0].id));
    for (const pi of planItems) recipeOrder.set(pi.recipeId, pi.orderPosition);
  }

  const allDbLocs = await db.select().from(storageLocationsTable);
  const systemDbLocs = allDbLocs.filter(l => l.isSystem);
  const userDbLocs = allDbLocs.filter(l => !l.isSystem);
  const systemByLabel = new Map(systemDbLocs.map(l => [l.name.toLowerCase(), l]));

  const locationMap = new Map<string, {
    key: string;
    label: string;
    zone: string;
    icon: string;
    dbId: number | null;
    totalPacks: number;
    items: AggItem[];
  }>();

  for (const def of LOCATION_DEFS) {
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

  // Build a lookup of allowed item types per location from LOCATION_DEFS
  const allowedTypes = new Map<string, readonly string[]>();
  for (const def of LOCATION_DEFS) allowedTypes.set(def.key, def.itemTypes);

  const aggMap = new Map<string, AggItem>();

  for (const row of positiveRows) {
    const qty = parseFloat(String(row.quantity)) || 0;
    if (qty <= 0) continue;

    // Enforce item-type restrictions: e.g. production_fridge only allows "recipe"
    const allowed = allowedTypes.get(row.location);
    if (allowed && !allowed.includes(row.itemType)) continue;

    let locEntry = locationMap.get(row.location);
    if (!locEntry) {
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

    const aggKey = `${row.location}|${row.itemType}|${id}`;
    const existing = aggMap.get(aggKey);
    if (existing) {
      existing.qty += qty;
      existing.stockEntryIds.push(row.id);
      if (!existing.unit || existing.unit === "packs") {
        existing.unit = row.unit ?? "packs";
      }
    } else {
      const orderPos = (row.itemType === "recipe" && row.recipeId) ? (recipeOrder.get(row.recipeId) ?? 9999) : 9999;
      const item: AggItem = {
        stockEntryIds: [row.id],
        id,
        name,
        color,
        qty,
        unit: row.unit ?? "packs",
        type: row.itemType,
        recipeId: row.recipeId ?? null,
        ingredientId: row.ingredientId ?? null,
        orderPosition: orderPos,
      };
      aggMap.set(aggKey, item);
      locEntry.items.push(item);
    }
  }

  for (const loc of locationMap.values()) {
    loc.items.sort((a, b) => a.orderPosition - b.orderPosition || a.name.localeCompare(b.name));
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

// ── Adjustment history ────────────────────────────────────────────────────────
// Returns the stock_entries snapshots for a given (location, itemType, itemId)
// tuple, limited to the last N days, with a computed delta per row. Used by
// the Stock Control expanded-row panel so the user can reconcile factory
// fridge deductions against fulfilment/wrap counts without needing a separate
// audit-log schema. We fetch one extra row just before the window so the
// first displayed entry has an accurate delta baseline.
router.get("/history", async (req: Request, res: Response) => {
  const location = typeof req.query.location === "string" ? req.query.location : "";
  const itemType = typeof req.query.itemType === "string" ? req.query.itemType : "";
  const itemIdRaw = typeof req.query.itemId === "string" ? req.query.itemId : "";
  const daysRaw = typeof req.query.days === "string" ? req.query.days : "7";

  if (!location || (itemType !== "recipe" && itemType !== "ingredient")) {
    res.status(400).json({ error: "location and itemType (recipe|ingredient) are required" });
    return;
  }
  const itemId = parseInt(itemIdRaw, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    res.status(400).json({ error: "itemId must be a positive integer" });
    return;
  }
  const days = Math.min(Math.max(parseInt(daysRaw, 10) || 7, 1), 90);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const itemFilter = itemType === "recipe"
    ? eq(stockEntriesTable.recipeId, itemId)
    : eq(stockEntriesTable.ingredientId, itemId);

  // Rows inside the window (newest first for display)
  const windowRows = await db
    .select({
      id: stockEntriesTable.id,
      checkedAt: stockEntriesTable.checkedAt,
      quantity: stockEntriesTable.quantity,
      unit: stockEntriesTable.unit,
      notes: stockEntriesTable.notes,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.location, location),
      eq(stockEntriesTable.itemType, itemType),
      itemFilter,
      gte(stockEntriesTable.checkedAt, since),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt));

  // One row immediately before the window (for delta baseline)
  const [baselineRow] = await db
    .select({
      quantity: stockEntriesTable.quantity,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.location, location),
      eq(stockEntriesTable.itemType, itemType),
      itemFilter,
      lt(stockEntriesTable.checkedAt, since),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt))
    .limit(1);

  // Walk ascending to compute deltas, then reverse back to newest-first.
  const ascending = [...windowRows].reverse();
  const baseline = baselineRow ? parseFloat(String(baselineRow.quantity)) : null;
  let prev: number | null = baseline;
  const withDeltas = ascending.map(r => {
    const qty = parseFloat(String(r.quantity));
    const delta = prev === null ? null : qty - prev;
    prev = qty;
    return {
      id: r.id,
      checkedAt: r.checkedAt,
      quantity: qty,
      delta,
      unit: r.unit,
      notes: r.notes,
    };
  });

  res.json({
    location,
    itemType,
    itemId,
    days,
    baselineQuantity: baseline,
    entries: withDeltas.reverse(), // newest first for UI
  });
});

export default router;
