/**
 * Loads what the slow-meat tray limit needs from the database: the two
 * settings and, per recipe, how many kg of each slow meat ONE batch puts on
 * the Raw Meat station's trays. The arithmetic itself is the shared pure
 * package @workspace/slow-meat.
 *
 * Weights are built from the same pieces the Raw Meat station uses
 * (GET /production-plans/:id/prep-requirements-by-recipe?station=prep_meat):
 *   - resolveRecipeIngredients + aggregateIngredients (sub-recipes included,
 *     e.g. the slow-cook beef sub-recipe), toppings skipped
 *   - raw = cooked ÷ processing ratio, grams converted to kg
 *   - plus every marinade on that meat, from loadRawMeatMarinades
 *   - category raw_meat only; fried-chicken recipes excluded (they prep
 *     elsewhere, exactly as the station excludes them)
 */
import { db, appSettingsTable, recipesTable, productionPlanItemsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  SLOW_MEAT_SETTING_KEYS,
  parseSlowMeatSettings,
  isSlowMeat,
  type RecipeMeatProfile,
  type RecipeMeatUse,
  type SlowMeatSettings,
  type PlanLine,
} from "@workspace/slow-meat";
import { resolveRecipeIngredients, aggregateIngredients } from "./ingredient-resolver";
import { loadRawMeatMarinades } from "./raw-meat-marinades";
import { FRIED_CHICKEN_CATEGORY } from "../routes/fried-chicken";

export async function loadSlowMeatSettings(): Promise<SlowMeatSettings> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [SLOW_MEAT_SETTING_KEYS.minCookMinutes, SLOW_MEAT_SETTING_KEYS.trayLimit]));
  const map = new Map(rows.map(r => [r.key, r.value]));
  return parseSlowMeatSettings({
    minCookMinutes: map.get(SLOW_MEAT_SETTING_KEYS.minCookMinutes) ?? null,
    trayLimit: map.get(SLOW_MEAT_SETTING_KEYS.trayLimit) ?? null,
  });
}

export async function saveSlowMeatSettings(s: SlowMeatSettings): Promise<void> {
  for (const [key, value] of [
    [SLOW_MEAT_SETTING_KEYS.minCookMinutes, String(s.minCookMinutes)],
    [SLOW_MEAT_SETTING_KEYS.trayLimit, String(s.trayLimit)],
  ] as const) {
    await db.insert(appSettingsTable).values({ key, value })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
}

/** One recipe's slow meats per batch, or null when it uses none. */
async function loadRecipeProfile(
  recipe: { id: number; name: string; portionsPerBatch: number | null },
  minCookMinutes: number,
): Promise<RecipeMeatProfile | null> {
  const portionsPerBatch = Number(recipe.portionsPerBatch) || 10;
  const resolved = await resolveRecipeIngredients(recipe.id, portionsPerBatch, { skipToppings: true });
  const agg = aggregateIngredients(resolved);
  const slow = [...agg.values()].filter(i => i.category === "raw_meat" && isSlowMeat(i.estimatedCookTimeMin, minCookMinutes));
  if (slow.length === 0) return null;

  // Raw quantity per batch in the ingredient's own unit (what the station
  // calls rawQty, for one batch).
  const rawPerBatch = new Map<number, number>();
  for (const i of agg.values()) {
    rawPerBatch.set(i.ingredientId, i.processingRatio ? i.quantityPerBatch / i.processingRatio : i.quantityPerBatch);
  }
  const marinades = await loadRawMeatMarinades({
    recipeId: recipe.id,
    portionsPerBatch,
    batchesTarget: 1,
    // Same figure the station hands the legacy grams-per-kg table, so the
    // two tray counts can't drift apart.
    legacyRawMeatKgFor: id => (rawPerBatch.get(id) ?? 0) / 1000,
  });

  const meats: RecipeMeatUse[] = slow.map(i => {
    const raw = rawPerBatch.get(i.ingredientId) ?? 0;
    const meatKg = i.unit === "g" ? raw / 1000 : raw;
    const marinadeKg = marinades
      .filter(m => m.rawMeatIngredientId === i.ingredientId)
      .reduce((s, m) => s + m.exactGrams, 0) / 1000;
    return {
      ingredientId: i.ingredientId,
      ingredientName: i.ingredientName,
      cookTimeMin: i.estimatedCookTimeMin,
      trayCapacityKg: i.rawMeatTrayCapacityKg,
      kgPerBatch: meatKg + marinadeKg,
    };
  });
  return { recipeId: recipe.id, recipeName: recipe.name.trim(), meats };
}

/** Slow-meat profiles for the given recipes (all recipes when omitted).
 *  Recipes with no slow meat are left out. */
export async function loadSlowMeatProfiles(
  settings: SlowMeatSettings,
  recipeIds?: number[],
): Promise<RecipeMeatProfile[]> {
  if (recipeIds && recipeIds.length === 0) return [];
  const base = db
    .select({ id: recipesTable.id, name: recipesTable.name, portionsPerBatch: recipesTable.portionsPerBatch, category: recipesTable.category })
    .from(recipesTable);
  const recipes = recipeIds ? await base.where(inArray(recipesTable.id, recipeIds)) : await base;
  const out: RecipeMeatProfile[] = [];
  for (const r of recipes) {
    if (r.category === FRIED_CHICKEN_CATEGORY) continue;
    const p = await loadRecipeProfile(r, settings.minCookMinutes);
    if (p) out.push(p);
  }
  return out;
}

/** A saved plan's lines, for the "don't make an over-limit plan worse" rule. */
export async function loadPlanLines(planId: number): Promise<PlanLine[]> {
  const rows = await db
    .select({ recipeId: productionPlanItemsTable.recipeId, batches: productionPlanItemsTable.batchesTarget })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, planId));
  return rows
    .filter((r): r is { recipeId: number; batches: number } => r.recipeId != null)
    .map(r => ({ recipeId: r.recipeId, batches: Number(r.batches) || 0 }));
}
