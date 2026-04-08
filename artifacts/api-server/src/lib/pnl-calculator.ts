import { db, recipesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import { computeCosts } from "../routes/recipes";
import type { ShopifyOrder } from "../services/shopify";

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
      packSize: recipesTable.packSize,
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

  // Accumulate per-recipe totals
  const perRecipeAccum = new Map<number, { unitsSold: number; totalCost: number; revenue: number }>();
  let totalIngredientCost = 0;
  let totalPackagingCost = 0;
  let totalLabourCost = 0;
  let unmappedItemCount = 0;
  let unmappedRevenue = 0;

  for (const order of countableOrders) {
    for (const item of order.line_items) {
      const vid = item.variant_id != null ? String(item.variant_id) : null;
      const recipeId = vid ? variantToRecipe.get(vid) : undefined;
      const itemRevenue = parseFloat(item.price) * item.quantity;

      if (!recipeId || !recipeCosts.has(recipeId)) {
        unmappedItemCount += item.quantity;
        unmappedRevenue += itemRevenue;
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

  const totalCogs = totalIngredientCost + totalPackagingCost + totalLabourCost;

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
    const tags = order.tags.split(",").map(t => t.trim().toLowerCase());
    const weightG = order.total_weight ?? 0;

    // Digital products (gift cards, memberships) have 0 weight and no shipping
    if (weightG === 0 && !tags.includes("large box") && !tags.includes("small box") && !tags.includes("wholesale")) {
      noShipCount++;
      continue;
    }

    const hasLargeTag = tags.includes("large box") || tags.includes("wholesale");
    const hasSmallTag = tags.includes("small box");
    const isLargeBox = hasLargeTag || (!hasSmallTag && weightG >= weightThresholdGrams);

    if (isLargeBox) {
      largeBoxCount++;
    } else {
      smallBoxCount++;
    }
  }

  return { smallBoxCount, largeBoxCount, noShipCount };
}
