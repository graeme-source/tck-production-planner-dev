import { db, recipesTable, recipePackSizeOrOne } from "@workspace/db";
import { sql } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { computeCosts } from "../routes/recipes";
import type { ShopifyOrder } from "../services/shopify";
import { getVariantCosts } from "../services/shopify";
import { boxSizeFor, isDigitalLine, isDigitalOnlyOrder, supplyUnitCosting, type VariantCosting } from "./finance/profit-tracker";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RecipeMapping {
  recipeId: number;
  shopifyVariantId: string;
  wonkyVariantId: string | null;
}

export interface RecipeCostInfo {
  recipeId: number;
  name: string;
  servings: number;
  packSize: number;
  packagingCost: number;
  labourCost: number;
  rrp: number;
  rawMaterialCostPerBatch: number;
  totalPackCost: number; // computed
}

export interface CogsResult {
  totalCogs: number;
  ingredientCost: number;
  packagingCost: number;
  labourCost: number;
  shopifyCostItems: number;
  shopifyCostTotal: number;
  unmappedItemCount: number;
  unmappedRevenue: number;
  perRecipe: Array<{
    recipeId: number;
    recipeName: string;
    unitsSold: number;
    unitCost: number;
    totalCost: number;
    revenue: number;
    marginPercent: number | null;
  }>;
}

export interface BoxCounts {
  smallBoxCount: number;
  largeBoxCount: number;
  noShipCount: number;
}

// ── Mapping cache ───────────────────────────────────────────────────────────

let mappingCache: { data: RecipeMapping[]; expiry: number } | null = null;
/** After a link changes, so the next figures use it straight away. */
export function forgetRecipeMappings(): void { mappingCache = null; }
const MAPPING_TTL_MS = 5 * 60 * 1000;

async function loadMappings(): Promise<RecipeMapping[]> {
  if (mappingCache && Date.now() < mappingCache.expiry) return mappingCache.data;

  const rows = await db.execute<{
    recipe_id: number;
    shopify_variant_id: string;
    wonky_variant_id: string | null;
  }>(sql`SELECT recipe_id, shopify_variant_id, wonky_variant_id FROM recipe_shopify_mappings`);

  const data: RecipeMapping[] = rows.rows.map((r: { recipe_id: number; shopify_variant_id: string; wonky_variant_id: string | null }) => ({
    recipeId: r.recipe_id,
    shopifyVariantId: r.shopify_variant_id,
    wonkyVariantId: r.wonky_variant_id,
  }));
  // A recipe's F2F product costs exactly what the recipe costs (Graeme,
  // 25 Nov 2026 — Shopify's cost for some included labour). Migration 0397.
  const f2f = await db.execute<{ id: number; f2f_variant_id: string }>(sql`
    SELECT id, f2f_variant_id FROM recipes WHERE f2f_variant_id IS NOT NULL
  `).catch(() => ({ rows: [] as Array<{ id: number; f2f_variant_id: string }> }));
  for (const r of f2f.rows) data.push({ recipeId: Number(r.id), shopifyVariantId: String(r.f2f_variant_id), wonkyVariantId: null });

  mappingCache = { data, expiry: Date.now() + MAPPING_TTL_MS };
  return data;
}

// ── Recipe cost loading ─────────────────────────────────────────────────────

async function loadRecipeCosts(recipeIds: number[]): Promise<Map<number, RecipeCostInfo>> {
  if (recipeIds.length === 0) return new Map();

  const recipes = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      servings: recipesTable.servings,
      packSize: recipePackSizeOrOne,
      packagingCost: recipesTable.packagingCost,
      labourCost: recipesTable.labourCost,
      rrp: recipesTable.rrp,
    })
    .from(recipesTable)
    .where(inArray(recipesTable.id, recipeIds));

  const rawCosts = await computeCosts(recipeIds);

  const map = new Map<number, RecipeCostInfo>();
  for (const r of recipes) {
    const servings = Number(r.servings);
    const packSize = Number(r.packSize);
    const packagingCost = Number(r.packagingCost);
    const labourCost = Number(r.labourCost);
    const rawMaterialCostPerBatch = rawCosts[r.id] ?? 0;
    const costPerPortion = servings > 0 ? rawMaterialCostPerBatch / servings : 0;
    const packIngredientCost = costPerPortion * packSize;
    const totalPackCost = packIngredientCost + packagingCost + labourCost;

    map.set(r.id, {
      recipeId: r.id,
      name: r.name,
      servings,
      packSize,
      packagingCost,
      labourCost,
      rrp: Number(r.rrp),
      rawMaterialCostPerBatch,
      totalPackCost,
    });
  }
  return map;
}

// ── COGS calculation ────────────────────────────────────────────────────────

const EXCLUDED_FINANCIAL = new Set(["refunded", "voided"]);

function isCountableOrder(o: ShopifyOrder): boolean {
  if (o.cancelled_at) return false;
  if (EXCLUDED_FINANCIAL.has(o.financial_status)) return false;
  return true;
}

export async function calculateCogs(orders: ShopifyOrder[]): Promise<CogsResult> {
  const mappings = await loadMappings();

  // Build variant_id -> recipeId lookup
  const variantToRecipe = new Map<string, number>();
  for (const m of mappings) {
    variantToRecipe.set(m.shopifyVariantId, m.recipeId);
    if (m.wonkyVariantId) {
      variantToRecipe.set(m.wonkyVariantId, m.recipeId);
    }
  }

  // Collect all recipe IDs we need costs for
  const neededRecipeIds = new Set<number>();
  const countableOrders = orders.filter(isCountableOrder);

  for (const order of countableOrders) {
    for (const item of order.line_items) {
      const vid = item.variant_id != null ? String(item.variant_id) : null;
      if (vid && variantToRecipe.has(vid)) {
        neededRecipeIds.add(variantToRecipe.get(vid)!);
      }
    }
  }

  const recipeCosts = await loadRecipeCosts([...neededRecipeIds]);

  // First pass: accumulate recipe-mapped items + collect unmapped variant IDs
  const perRecipeAccum = new Map<number, { unitsSold: number; totalCost: number; revenue: number }>();
  let totalIngredientCost = 0;
  let totalPackagingCost = 0;
  let totalLabourCost = 0;
  let unmappedItemCount = 0;
  let unmappedRevenue = 0;

  // Track unmapped items for Shopify cost fallback
  const unmappedVariantItems: Array<{ variantId: string; quantity: number; revenue: number; title: string }> = [];

  for (const order of countableOrders) {
    for (const item of order.line_items) {
      // Digital products cost nothing to make — not "unmapped" (25 Nov 2026).
      if (isDigitalLine({ requiresShipping: item.requires_shipping, giftCard: item.gift_card })) continue;
      const vid = item.variant_id != null ? String(item.variant_id) : null;
      const recipeId = vid ? variantToRecipe.get(vid) : undefined;
      const itemRevenue = parseFloat(item.price) * item.quantity;

      if (!recipeId || !recipeCosts.has(recipeId)) {
        if (vid) {
          unmappedVariantItems.push({ variantId: vid, quantity: item.quantity, revenue: itemRevenue, title: item.title });
        } else {
          unmappedItemCount += item.quantity;
          unmappedRevenue += itemRevenue;
        }
        continue;
      }

      const cost = recipeCosts.get(recipeId)!;
      const costPerPortion = cost.servings > 0 ? cost.rawMaterialCostPerBatch / cost.servings : 0;
      const packIngredientCost = costPerPortion * cost.packSize;
      const itemIngredientCost = packIngredientCost * item.quantity;
      const itemPackagingCost = cost.packagingCost * item.quantity;
      const itemLabourCost = cost.labourCost * item.quantity;

      totalIngredientCost += itemIngredientCost;
      totalPackagingCost += itemPackagingCost;
      totalLabourCost += itemLabourCost;

      const accum = perRecipeAccum.get(recipeId) ?? { unitsSold: 0, totalCost: 0, revenue: 0 };
      accum.unitsSold += item.quantity;
      accum.totalCost += cost.totalPackCost * item.quantity;
      accum.revenue += itemRevenue;
      perRecipeAccum.set(recipeId, accum);
    }
  }

  // Shopify cost fallback for unmapped items
  let shopifyCostItems = 0;
  let shopifyCostTotal = 0;

  if (unmappedVariantItems.length > 0) {
    const uniqueVariantIds = [...new Set(unmappedVariantItems.map(i => i.variantId))];
    try {
      // Supplies mapped to the Shopify product first (25 Nov 2026), then Shopify's cost.
      const supplies = await loadSupplyCostsByVariant(uniqueVariantIds);
      const variantCosts = await getVariantCosts(uniqueVariantIds.filter(v => !supplies.has(v)));
      for (const [vid, c] of supplies) variantCosts.set(vid, c.food + c.packaging);
      for (const item of unmappedVariantItems) {
        const cost = variantCosts.get(item.variantId);
        if (cost != null && cost > 0) {
          shopifyCostItems += item.quantity;
          shopifyCostTotal += cost * item.quantity;
        } else {
          // No cost in Shopify either — truly unmapped
          unmappedItemCount += item.quantity;
          unmappedRevenue += item.revenue;
        }
      }
    } catch (err) {
      console.warn("[pnl-calculator] Shopify cost fallback failed:", err);
      // Fall back to unmapped
      for (const item of unmappedVariantItems) {
        unmappedItemCount += item.quantity;
        unmappedRevenue += item.revenue;
      }
    }
  }

  const totalCogs = totalIngredientCost + totalPackagingCost + totalLabourCost + shopifyCostTotal;

  const perRecipe = [...perRecipeAccum.entries()].map(([recipeId, accum]) => {
    const cost = recipeCosts.get(recipeId)!;
    const marginPercent = accum.revenue > 0
      ? ((accum.revenue - accum.totalCost) / accum.revenue) * 100
      : null;
    return {
      recipeId,
      recipeName: cost.name,
      unitsSold: accum.unitsSold,
      unitCost: cost.totalPackCost,
      totalCost: accum.totalCost,
      revenue: accum.revenue,
      marginPercent,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  return {
    totalCogs,
    ingredientCost: totalIngredientCost,
    packagingCost: totalPackagingCost,
    labourCost: totalLabourCost,
    shopifyCostItems,
    shopifyCostTotal,
    unmappedItemCount,
    unmappedRevenue,
    perRecipe,
  };
}

// ── Box sizing (reuses fulfilment.ts logic) ─────────────────────────────────

export function classifyBoxes(
  orders: ShopifyOrder[],
  weightThresholdGrams: number,
): BoxCounts {
  let smallBoxCount = 0;
  let largeBoxCount = 0;
  let noShipCount = 0;

  const countable = orders.filter(isCountableOrder);

  for (const order of countable) {
    // One rule, shared with the profit tracker (lib/finance/profit-tracker.ts).
    // Digital-only orders (memberships, gift cards) ship nothing (25 Nov 2026).
    const digitalOnly = isDigitalOnlyOrder((order.line_items ?? []).map(li => ({
      quantity: li.current_quantity ?? li.quantity, requiresShipping: li.requires_shipping, giftCard: li.gift_card,
    })));
    const size = digitalOnly ? "none" : boxSizeFor(order.tags, order.total_weight ?? 0, weightThresholdGrams);
    if (size === "none") noShipCount++;
    else if (size === "large") largeBoxCount++;
    else smallBoxCount++;
  }

  return { smallBoxCount, largeBoxCount, noShipCount };
}

// ── Per-variant costing for the profit tracker ─────────────────────────────

/** Supplies (ingredients) mapped to a Shopify variant, costed per unit sold. */
async function loadSupplyCostsByVariant(variantIds: readonly string[]): Promise<Map<string, VariantCosting>> {
  const out = new Map<string, VariantCosting>();
  if (variantIds.length === 0) return out;
  const r = await db.execute<{ vid: string; name: string; cost_per_pack: string | null; units: string | null; category: string | null }>(sql`
    SELECT shopify_variant_id AS vid, name, cost_per_pack::text, shopify_units_per_pack::text AS units, category
      FROM ingredients
     WHERE shopify_variant_id IN (${sql.join(variantIds.map(v => sql`${v}`), sql`, `)})
  `);
  for (const row of r.rows ?? []) {
    const c = supplyUnitCosting({ name: row.name, costPerPack: row.cost_per_pack != null ? Number(row.cost_per_pack) : null, unitsPerPack: row.units != null ? Number(row.units) : null, category: row.category });
    if (c) out.set(String(row.vid), c);
  }
  return out;
}

/**
 * What one unit of each variant costs, split the way QuickBooks splits it:
 * food (recipe ingredients, or Shopify's cost for bought-in items) and the
 * recipe's own packaging. The same recipe mapping and costings as
 * calculateCogs. Variants with neither are left out (uncosted).
 */
export async function loadVariantCosting(
  items: ReadonlyArray<{ variantId: string; title: string }>,
): Promise<Map<string, VariantCosting>> {
  const mappings = await loadMappings();
  const variantToRecipe = new Map<string, number>();
  for (const m of mappings) {
    variantToRecipe.set(m.shopifyVariantId, m.recipeId);
    if (m.wonkyVariantId) variantToRecipe.set(m.wonkyVariantId, m.recipeId);
  }
  const wanted = new Map(items.map(i => [i.variantId, i.title]));
  const recipeIds = [...new Set([...wanted.keys()].map(v => variantToRecipe.get(v)).filter((x): x is number => x != null))];
  const recipeCosts = await loadRecipeCosts(recipeIds);

  const out = new Map<string, VariantCosting>();
  const unmapped: string[] = [];
  for (const vid of wanted.keys()) {
    const rid = variantToRecipe.get(vid);
    const c = rid != null ? recipeCosts.get(rid) : undefined;
    if (!c) { unmapped.push(vid); continue; }
    const perPortion = c.servings > 0 ? c.rawMaterialCostPerBatch / c.servings : 0;
    out.set(vid, { name: c.name, food: perPortion * c.packSize, packaging: c.packagingCost, isPack: true });
  }
  // A supply mapped to the Shopify product (Stock → the supply's Shopify
  // link) is costed from the app — pack cost ÷ units per pack — before
  // Shopify's own "cost per item" (Graeme, 25 Nov 2026: the order insert).
  const supplies = unmapped.length > 0 ? await loadSupplyCostsByVariant(unmapped) : new Map<string, VariantCosting>();
  for (const [vid, c] of supplies) out.set(vid, c);
  const stillUnmapped = unmapped.filter(v => !supplies.has(v));
  if (stillUnmapped.length > 0) {
    try {
      const costs = await getVariantCosts(stillUnmapped);
      for (const vid of stillUnmapped) {
        const cost = costs.get(vid);
        if (cost != null && cost > 0) out.set(vid, { name: wanted.get(vid) || "Unknown item", food: cost, packaging: 0, isPack: false });
      }
    } catch (err) {
      console.warn("[pnl-calculator] Shopify cost lookup failed:", err instanceof Error ? err.message : err);
    }
  }
  return out;
}
