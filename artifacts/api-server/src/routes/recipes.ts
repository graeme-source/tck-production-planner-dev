import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, recipeMeatMarinadesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, appSettingsTable, kanbanItemsTable, productionPlansTable, productionPlanItemsTable, productSpecificationsTable, companyProfileTable, skuBarcodesTable } from "@workspace/db";
import { eq, inArray, ne, and, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CreateRecipeBody, UpdateRecipeBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { computeSubRecipeCosts } from "../lib/sub-recipe-costs";
import { generateQrCode } from "../lib/qr-code";
import { recalculateDptRequirements } from "./dpt-ingredient-requirements";
import { londonDateString } from "../lib/london-time";
import * as z from "zod";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if ((req.session as { userRole?: string }).userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

const RecipeIdParams = z.object({ id: z.coerce.number().int().positive() });

// One microbiological criterion row as stored in product_specifications.micro_criteria (jsonb).
type ProductSpecMicro = { organism?: string; target?: string; maximum?: string; lastTestDate?: string; lastTestLab?: string; lastTestResult?: string };
const ShopifyMappingBody = z.object({
  shopifyVariantId: z.string().min(1, "shopifyVariantId is required"),
  shopifyProductTitle: z.string().nullish(),
  shopifyVariantTitle: z.string().nullish(),
  wonkyVariantId: z.string().nullish(),
  wonkyProductTitle: z.string().nullish(),
  wonkyVariantTitle: z.string().nullish(),
});

const router: IRouter = Router();

function mapRecipe(r: typeof recipesTable.$inferSelect) {
  return {
    ...r,
    servings: Number(r.servings),
    packSize: Number(r.packSize),
    rrp: Number(r.rrp),
    packagingCost: Number(r.packagingCost),
    labourCost: Number(r.labourCost),
    portionsPerBatch: Number(r.portionsPerBatch),
    maxBatchesPerTin: r.maxBatchesPerTin ?? null,
    tinSize: r.tinSize ?? null,
    sopUrl: r.sopUrl ?? null,
    fillWeightGrams: r.fillWeightGrams ? Number(r.fillWeightGrams) : null,
    baseType: r.baseType ?? null,
    baseWeightGrams: r.baseWeightGrams ? Number(r.baseWeightGrams) : null,
    isCoreMenu: r.isCoreMenu ?? false,
    isCurrentSpecial: r.isCurrentSpecial ?? false,
    isFridgeProduct: r.isFridgeProduct ?? false,
    color: r.color ?? null,
    cookingLossPercent: r.cookingLossPercent != null ? Number(r.cookingLossPercent) : 3,
    builderFillingDeductionGrams: r.builderFillingDeductionGrams != null ? Number(r.builderFillingDeductionGrams) : 0,
    dietaryCategory: r.dietaryCategory ?? null,
    tags: r.tags ?? [],
    createdAt: r.createdAt.toISOString(),
  };
}

function normaliseTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== "string") continue;
    const trimmed = t.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export async function computeCosts(recipeIds: number[]) {
  if (recipeIds.length === 0) return {};

  const recipeIngredients = await db
    .select({
      recipeId: recipeIngredientsTable.recipeId,
      quantity: recipeIngredientsTable.quantity,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      processingRatio: ingredientsTable.processingRatio,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(inArray(recipeIngredientsTable.recipeId, recipeIds));

  const recipeSubRecipes = await db
    .select({
      recipeId: recipeSubRecipesTable.recipeId,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
    })
    .from(recipeSubRecipesTable)
    .where(inArray(recipeSubRecipesTable.recipeId, recipeIds));

  const usedSubRecipeIds = [...new Set(
    recipeSubRecipes.map(s => s.subRecipeId).filter((id): id is number => id !== null)
  )];

  let subRecipeCostPerUnit: Record<number, number> = {};
  if (usedSubRecipeIds.length > 0) {
    subRecipeCostPerUnit = await computeSubRecipeCosts();
  }

  const rawCostByRecipeId: Record<number, number> = {};

  for (const ri of recipeIngredients) {
    const q = Number(ri.quantity);
    const pw = Number(ri.packWeight);
    const cpp = Number(ri.costPerPack);
    const pr = Number(ri.processingRatio) || 1;
    const costPerUnit = pw > 0 ? cpp / pw : 0;
    rawCostByRecipeId[ri.recipeId] = (rawCostByRecipeId[ri.recipeId] ?? 0) + (q / pr) * costPerUnit;
  }

  for (const rs of recipeSubRecipes) {
    if (!rs.subRecipeId) continue;
    const q = Number(rs.quantity);
    const cpu = subRecipeCostPerUnit[rs.subRecipeId] ?? 0;
    rawCostByRecipeId[rs.recipeId] = (rawCostByRecipeId[rs.recipeId] ?? 0) + q * cpu;
  }

  return rawCostByRecipeId;
}

function enrichWithCosts(
  recipe: ReturnType<typeof mapRecipe>,
  rawMaterialCostPerBatch: number
) {
  const servings = recipe.servings;
  const packSize = recipe.packSize;
  const rrp = recipe.rrp;
  const packagingCost = recipe.packagingCost;
  const labourCost = recipe.labourCost;

  const costPerPortion = servings > 0 ? rawMaterialCostPerBatch / servings : 0;
  const packIngredientCost = costPerPortion * packSize;
  const totalPackCost = packIngredientCost + packagingCost + labourCost;
  const grossMargin = rrp > 0 ? ((rrp - totalPackCost) / rrp) * 100 : null;

  return {
    ...recipe,
    rawMaterialCostPerBatch,
    costPerPortion,
    packIngredientCost,
    totalPackCost,
    grossMargin,
  };
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(recipesTable).orderBy(recipesTable.name);
  const mapped = rows.map(mapRecipe);
  const ids = mapped.map(r => r.id);
  const rawCosts = await computeCosts(ids);
  res.json(mapped.map(r => enrichWithCosts(r, rawCosts[r.id] ?? 0)));
});

interface MarinadeInput {
  rawMeatIngredientId: number;
  marinadeIngredientId?: number | null;
  marinadeSubRecipeId?: number | null;
  gramsPerKg: number;
}

function validateMarinades(marinades: MarinadeInput[], recipeIngredientIds: number[]): string | null {
  for (const m of marinades) {
    const hasIng = m.marinadeIngredientId != null;
    const hasSub = m.marinadeSubRecipeId != null;
    if (!hasIng && !hasSub) return "Each marinade must specify either an ingredient or a sub-recipe";
    if (hasIng && hasSub) return "Each marinade must specify either an ingredient or a sub-recipe, not both";
    if (!m.gramsPerKg || m.gramsPerKg <= 0) return "Marinade grams/kg must be greater than 0";
    if (!recipeIngredientIds.includes(m.rawMeatIngredientId)) return "rawMeatIngredientId must reference an ingredient used in this recipe";
  }
  return null;
}

// NOTE: preserveToppingFlags / applyToppingFlags workaround removed.
// The validate middleware now uses .passthrough() so unknown fields are
// never stripped, and the OpenAPI spec has been updated with all fields.

router.post("/", validate(CreateRecipeBody), async (req, res) => {
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, targetBuildSeconds, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, isCoreMenu, isCurrentSpecial, color, cookingLossPercent, builderFillingDeductionGrams, dietaryCategory, tags, ingredients, subRecipes, marinades } = req.body;

  if (marinades?.length) {
    const recipeIngIds = (ingredients ?? []).map(i => i.ingredientId);
    const marinadeError = validateMarinades(marinades, recipeIngIds);
    if (marinadeError) { res.status(400).json({ error: marinadeError }); return; }
    const meatIds = [...new Set(marinades.map(m => m.rawMeatIngredientId))];
    const meatRows = await db.select({ id: ingredientsTable.id, category: ingredientsTable.category })
      .from(ingredientsTable).where(inArray(ingredientsTable.id, meatIds));
    const nonMeat = meatRows.find(r => r.category !== "raw_meat");
    if (nonMeat) { res.status(400).json({ error: `Ingredient ${nonMeat.id} is not in the raw_meat category` }); return; }
  }

  const insertValues = {
    name, description,
    servings: String(servings),
    servingUnit, category, notes,
    packSize: String(packSize ?? 1),
    rrp: String(rrp ?? 0),
    packagingCost: String(packagingCost ?? 0),
    labourCost: String(labourCost ?? 0),
    portionsPerBatch: portionsPerBatch ?? 10,
    targetBuildSeconds: targetBuildSeconds ?? null,
    shelfLifeDays: shelfLifeDays ?? null,
    tinSize: tinSize ?? null,
    maxBatchesPerTin: maxBatchesPerTin ?? null,
    sopUrl: sopUrl ?? null,
    fillWeightGrams: fillWeightGrams != null ? String(fillWeightGrams) : null,
    baseType: baseType ?? null,
    baseWeightGrams: baseWeightGrams != null ? String(baseWeightGrams) : null,
    isCoreMenu: isCoreMenu ?? false,
    isCurrentSpecial: isCurrentSpecial ?? false,
    color: color ?? null,
    cookingLossPercent: cookingLossPercent != null ? String(cookingLossPercent) : "3",
    builderFillingDeductionGrams: builderFillingDeductionGrams != null ? Math.round(Number(builderFillingDeductionGrams)) : 0,
    dietaryCategory: dietaryCategory ?? null,
    tags: normaliseTags(tags),
  };

  const [recipe] = await db.transaction(async (tx) => {
    if (isCurrentSpecial === true) {
      await tx.update(recipesTable).set({ isCurrentSpecial: false });
    }
    return tx.insert(recipesTable).values(insertValues).returning();
  });

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null; marinadeAddAtCooking?: boolean; includeInFillingMix?: boolean; quid?: boolean; isTopping?: boolean; showInPrep?: boolean; mixingOverage?: number }) => ({
        recipeId: recipe.id, ingredientId: i.ingredientId, quantity: String(i.quantity),
        marinadeForIngredientId: i.marinadeForIngredientId ?? null,
        marinadeAddAtCooking: i.marinadeAddAtCooking ?? false,
        includeInFillingMix: i.includeInFillingMix ?? false,
        quid: i.quid ?? false,
        isTopping: i.isTopping ?? false,
        showInPrep: i.showInPrep ?? false,
        mixingOverage: String(i.mixingOverage ?? 0),
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null; marinadeAddAtCooking?: boolean; includeInFillingMix?: boolean; quid?: boolean; isTopping?: boolean; showInPrep?: boolean; mixingOverage?: number }) => ({
        recipeId: recipe.id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
        marinadeForIngredientId: s.marinadeForIngredientId ?? null,
        marinadeAddAtCooking: s.marinadeAddAtCooking ?? false,
        includeInFillingMix: s.includeInFillingMix ?? false,
        quid: s.quid ?? false,
        isTopping: s.isTopping ?? false,
        showInPrep: s.showInPrep ?? false,
        mixingOverage: String(s.mixingOverage ?? 0),
      }))
    );
  }
  if (marinades?.length) {
    await db.insert(recipeMeatMarinadesTable).values(
      marinades.map((m) => ({
        recipeId: recipe.id,
        rawMeatIngredientId: m.rawMeatIngredientId,
        marinadeIngredientId: m.marinadeIngredientId ?? null,
        marinadeSubRecipeId: m.marinadeSubRecipeId ?? null,
        gramsPerKg: String(m.gramsPerKg),
      }))
    );
  }

  const mapped = mapRecipe(recipe);
  const rawCosts = await computeCosts([recipe.id]);
  res.status(201).json(enrichWithCosts(mapped, rawCosts[recipe.id] ?? 0));
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(recipesTable).where(eq(recipesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const servings = Number(row.servings);

  const ingredientRows = await db
    .select({
      id: recipeIngredientsTable.id,
      ingredientId: recipeIngredientsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      quantity: recipeIngredientsTable.quantity,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      processingRatio: ingredientsTable.processingRatio,
      marinadeForIngredientId: recipeIngredientsTable.marinadeForIngredientId,
      marinadeAddAtCooking: recipeIngredientsTable.marinadeAddAtCooking,
      includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
      quid: recipeIngredientsTable.quid,
      isTopping: recipeIngredientsTable.isTopping,
      showInPrep: recipeIngredientsTable.showInPrep,
      mixingOverage: recipeIngredientsTable.mixingOverage,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, id));

  const subRows = await db
    .select({
      id: recipeSubRecipesTable.id,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      subRecipeName: subRecipesTable.name,
      quantity: recipeSubRecipesTable.quantity,
      yieldUnit: subRecipesTable.yieldUnit,
      subYield: subRecipesTable.yield,
      marinadeForIngredientId: recipeSubRecipesTable.marinadeForIngredientId,
      marinadeAddAtCooking: recipeSubRecipesTable.marinadeAddAtCooking,
      includeInFillingMix: recipeSubRecipesTable.includeInFillingMix,
      quid: recipeSubRecipesTable.quid,
      isTopping: recipeSubRecipesTable.isTopping,
      showInPrep: recipeSubRecipesTable.showInPrep,
      mixingOverage: recipeSubRecipesTable.mixingOverage,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, id));

  const subRecipeIds = subRows.map(s => s.subRecipeId).filter((x): x is number => x !== null);
  const subCostPerUnit: Record<number, number> = {};
  if (subRecipeIds.length > 0) {
    const allCosts = await computeSubRecipeCosts();
    for (const srId of subRecipeIds) {
      subCostPerUnit[srId] = allCosts[srId] ?? 0;
    }
  }

  const enrichedIngredients = ingredientRows.map(i => {
    const cookedQty = Number(i.quantity);
    const pw = Number(i.packWeight);
    const cpp = Number(i.costPerPack);
    const pr = Number(i.processingRatio) || 1;
    const rawQty = cookedQty / pr;
    const costPerUnit = pw > 0 ? cpp / pw : 0;
    const lineCostBatch = rawQty * costPerUnit;
    const lineCostPortion = servings > 0 ? lineCostBatch / servings : 0;
    return {
      id: i.id,
      ingredientId: i.ingredientId,
      ingredientName: i.ingredientName,
      unit: i.unit,
      quantity: cookedQty,
      rawQuantity: rawQty,
      processingRatio: pr,
      packWeight: pw,
      costPerPack: cpp,
      costPerUnit,
      lineCostBatch,
      lineCostPortion,
      marinadeForIngredientId: i.marinadeForIngredientId ?? null,
      marinadeAddAtCooking: i.marinadeAddAtCooking ?? false,
      includeInFillingMix: i.includeInFillingMix,
      quid: i.quid ?? false,
      isTopping: i.isTopping ?? false,
      mixingOverage: Number(i.mixingOverage ?? 0),
      showInPrep: i.showInPrep ?? false,
    };
  });

  const subIngredientsBySubId: Record<number, Array<{
    ingredientName: string | null;
    unit: string | null;
    quantity: number;
    processingRatio: number;
    costPerUnit: number;
  }>> = {};
  if (subRecipeIds.length > 0) {
    const subIngRows = await db
      .select({
        subRecipeId: subRecipeIngredientsTable.subRecipeId,
        ingredientId: subRecipeIngredientsTable.ingredientId,
        ingredientName: ingredientsTable.name,
        unit: ingredientsTable.unit,
        quantity: subRecipeIngredientsTable.quantity,
        packWeight: ingredientsTable.packWeight,
        costPerPack: ingredientsTable.costPerPack,
        processingRatio: ingredientsTable.processingRatio,
      })
      .from(subRecipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(inArray(subRecipeIngredientsTable.subRecipeId, subRecipeIds));
    for (const r of subIngRows) {
      const pw = Number(r.packWeight);
      const cpp = Number(r.costPerPack);
      const costPerUnit = pw > 0 ? cpp / pw : 0;
      const entry = {
        ingredientId: r.ingredientId,
        ingredientName: r.ingredientName,
        unit: r.unit,
        quantity: Number(r.quantity),
        processingRatio: Number(r.processingRatio) || 1,
        costPerUnit,
      };
      if (!subIngredientsBySubId[r.subRecipeId]) subIngredientsBySubId[r.subRecipeId] = [];
      subIngredientsBySubId[r.subRecipeId].push(entry);
    }
  }

  const enrichedSubRecipes = subRows.map(s => {
    const qty = Number(s.quantity);
    const subYield = Number(s.subYield);
    const subCostPerUnitVal = subCostPerUnit[s.subRecipeId!] ?? 0;
    const subBatchCost = subYield > 0 ? subCostPerUnitVal * subYield : 0;
    const lineCostBatch = qty * subCostPerUnitVal;
    const lineCostPortion = servings > 0 ? lineCostBatch / servings : 0;

    const portionFraction = subYield > 0 && servings > 0 ? (qty / subYield) / servings : 0;
    const breakdown = (subIngredientsBySubId[s.subRecipeId!] ?? []).map(ing => {
      const cookedQtyPerPortion = ing.quantity * portionFraction;
      const rawQtyPerPortion = cookedQtyPerPortion / ing.processingRatio;
      const allocatedCostPortion = rawQtyPerPortion * ing.costPerUnit;
      return {
        ingredientId: ing.ingredientId,
        ingredientName: ing.ingredientName,
        unit: ing.unit,
        quantity: cookedQtyPerPortion,
        costPerUnit: ing.costPerUnit,
        allocatedCostBatch: allocatedCostPortion * servings,
        allocatedCostPortion,
      };
    });

    return {
      id: s.id,
      subRecipeId: s.subRecipeId,
      subRecipeName: s.subRecipeName,
      quantity: qty,
      unit: s.yieldUnit,
      subYield,
      subBatchCost,
      subCostPerUnit: subCostPerUnitVal,
      lineCostBatch,
      lineCostPortion,
      breakdown,
      marinadeForIngredientId: s.marinadeForIngredientId ?? null,
      marinadeAddAtCooking: s.marinadeAddAtCooking ?? false,
      includeInFillingMix: s.includeInFillingMix,
      quid: s.quid ?? false,
      isTopping: s.isTopping ?? false,
      mixingOverage: Number(s.mixingOverage ?? 0),
      showInPrep: s.showInPrep ?? false,
    };
  });

  const rawMeatIngAlias = alias(ingredientsTable, "rawMeatIng");
  const marinadeIngAlias = alias(ingredientsTable, "marinadeIng");
  const marinadeSubAlias = alias(subRecipesTable, "marinadeSub");
  const marinadeRows = await db
    .select({
      id: recipeMeatMarinadesTable.id,
      rawMeatIngredientId: recipeMeatMarinadesTable.rawMeatIngredientId,
      rawMeatIngredientName: rawMeatIngAlias.name,
      marinadeIngredientId: recipeMeatMarinadesTable.marinadeIngredientId,
      marinadeIngredientName: marinadeIngAlias.name,
      marinadeSubRecipeId: recipeMeatMarinadesTable.marinadeSubRecipeId,
      marinadeSubRecipeName: marinadeSubAlias.name,
      gramsPerKg: recipeMeatMarinadesTable.gramsPerKg,
    })
    .from(recipeMeatMarinadesTable)
    .leftJoin(rawMeatIngAlias, eq(recipeMeatMarinadesTable.rawMeatIngredientId, rawMeatIngAlias.id))
    .leftJoin(marinadeIngAlias, eq(recipeMeatMarinadesTable.marinadeIngredientId, marinadeIngAlias.id))
    .leftJoin(marinadeSubAlias, eq(recipeMeatMarinadesTable.marinadeSubRecipeId, marinadeSubAlias.id))
    .where(eq(recipeMeatMarinadesTable.recipeId, id));

  const enrichedMarinades = marinadeRows.map(m => ({
    id: m.id,
    rawMeatIngredientId: m.rawMeatIngredientId,
    rawMeatIngredientName: m.rawMeatIngredientName ?? `Ingredient #${m.rawMeatIngredientId}`,
    marinadeIngredientId: m.marinadeIngredientId ?? null,
    marinadeIngredientName: m.marinadeIngredientName ?? null,
    marinadeSubRecipeId: m.marinadeSubRecipeId ?? null,
    marinadeSubRecipeName: m.marinadeSubRecipeName ?? null,
    gramsPerKg: Number(m.gramsPerKg),
  }));

  const mapped = mapRecipe(row);
  const rawCosts = await computeCosts([id]);
  const enriched = enrichWithCosts(mapped, rawCosts[id] ?? 0);

  res.json({
    ...enriched,
    ingredients: enrichedIngredients,
    subRecipes: enrichedSubRecipes,
    marinades: enrichedMarinades,
  });
});

router.put("/:id", validate(UpdateRecipeBody), async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, targetBuildSeconds, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, isCoreMenu, isCurrentSpecial, color, cookingLossPercent, builderFillingDeductionGrams, dietaryCategory, tags, ingredients, subRecipes, marinades } = req.body;

  if (marinades?.length) {
    const recipeIngIds = (ingredients ?? []).map(i => i.ingredientId);
    const marinadeError = validateMarinades(marinades, recipeIngIds);
    if (marinadeError) { res.status(400).json({ error: marinadeError }); return; }
    const meatIds = [...new Set(marinades.map(m => m.rawMeatIngredientId))];
    const meatRows = await db.select({ id: ingredientsTable.id, category: ingredientsTable.category })
      .from(ingredientsTable).where(inArray(ingredientsTable.id, meatIds));
    const nonMeat = meatRows.find(r => r.category !== "raw_meat");
    if (nonMeat) { res.status(400).json({ error: `Ingredient ${nonMeat.id} is not in the raw_meat category` }); return; }
  }

  const recipeFields = {
    name, description,
    servings: String(servings),
    servingUnit, category, notes,
    packSize: String(packSize ?? 1),
    rrp: String(rrp ?? 0),
    packagingCost: String(packagingCost ?? 0),
    labourCost: String(labourCost ?? 0),
    portionsPerBatch: portionsPerBatch ?? 10,
    targetBuildSeconds: targetBuildSeconds ?? null,
    shelfLifeDays: shelfLifeDays ?? null,
    tinSize: tinSize ?? null,
    maxBatchesPerTin: maxBatchesPerTin ?? null,
    sopUrl: sopUrl ?? null,
    fillWeightGrams: fillWeightGrams != null ? String(fillWeightGrams) : null,
    baseType: baseType ?? null,
    baseWeightGrams: baseWeightGrams != null ? String(baseWeightGrams) : null,
    isCoreMenu: isCoreMenu ?? false,
    color: color ?? null,
    cookingLossPercent: cookingLossPercent != null ? String(cookingLossPercent) : "3",
    builderFillingDeductionGrams: builderFillingDeductionGrams != null ? Math.round(Number(builderFillingDeductionGrams)) : 0,
    ...(dietaryCategory !== undefined ? { dietaryCategory: dietaryCategory ?? null } : {}),
    ...(isCurrentSpecial !== undefined ? { isCurrentSpecial } : {}),
    ...(tags !== undefined ? { tags: normaliseTags(tags) } : {}),
  };

  const [updated] = await db.transaction(async (tx) => {
    if (isCurrentSpecial === true) {
      await tx.update(recipesTable)
        .set({ isCurrentSpecial: false })
        .where(ne(recipesTable.id, id));
    }
    const [row] = await tx.update(recipesTable)
      .set(recipeFields)
      .where(eq(recipesTable.id, id))
      .returning();
    if (!row) return [null];

    // Save existing assemblyOrder values before deleting so they can be restored
    const existingIngOrders = await tx.select({
      ingredientId: recipeIngredientsTable.ingredientId,
      assemblyOrder: recipeIngredientsTable.assemblyOrder,
    }).from(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
    const ingOrderMap = new Map(existingIngOrders.map(r => [r.ingredientId, r.assemblyOrder]));

    const existingSubOrders = await tx.select({
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      assemblyOrder: recipeSubRecipesTable.assemblyOrder,
    }).from(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, id));
    const subOrderMap = new Map(existingSubOrders.map(r => [r.subRecipeId, r.assemblyOrder]));

    // Delete and re-insert ingredients/sub-recipes inside the transaction
    // so a failed insert cannot leave the recipe with no ingredients
    await tx.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
    await tx.delete(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, id));

    if (marinades !== undefined) {
      await tx.delete(recipeMeatMarinadesTable).where(eq(recipeMeatMarinadesTable.recipeId, id));
    }

    if (ingredients?.length) {
      await tx.insert(recipeIngredientsTable).values(
        ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null; marinadeAddAtCooking?: boolean; includeInFillingMix?: boolean; quid?: boolean; isTopping?: boolean; showInPrep?: boolean; mixingOverage?: number }) => ({
          recipeId: id, ingredientId: i.ingredientId, quantity: String(i.quantity),
          marinadeForIngredientId: i.marinadeForIngredientId ?? null,
        marinadeAddAtCooking: i.marinadeAddAtCooking ?? false,
          includeInFillingMix: i.includeInFillingMix ?? false,
          quid: i.quid ?? false,
          isTopping: i.isTopping ?? false,
          showInPrep: i.showInPrep ?? false,
          mixingOverage: String(i.mixingOverage ?? 0),
          assemblyOrder: ingOrderMap.get(i.ingredientId) ?? null,
        }))
      );
    }
    if (subRecipes?.length) {
      await tx.insert(recipeSubRecipesTable).values(
        subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null; marinadeAddAtCooking?: boolean; includeInFillingMix?: boolean; quid?: boolean; isTopping?: boolean; showInPrep?: boolean; mixingOverage?: number }) => ({
          recipeId: id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
          marinadeForIngredientId: s.marinadeForIngredientId ?? null,
        marinadeAddAtCooking: s.marinadeAddAtCooking ?? false,
          includeInFillingMix: s.includeInFillingMix ?? false,
          quid: s.quid ?? false,
          isTopping: s.isTopping ?? false,
          showInPrep: s.showInPrep ?? false,
          mixingOverage: String(s.mixingOverage ?? 0),
          assemblyOrder: subOrderMap.get(s.subRecipeId) ?? null,
        }))
      );
    }
    if (marinades?.length) {
      await tx.insert(recipeMeatMarinadesTable).values(
        marinades.map((m) => ({
          recipeId: id,
          rawMeatIngredientId: m.rawMeatIngredientId,
          marinadeIngredientId: m.marinadeIngredientId ?? null,
          marinadeSubRecipeId: m.marinadeSubRecipeId ?? null,
          gramsPerKg: String(m.gramsPerKg),
        }))
      );
    }

    return [row];
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const today = londonDateString();
  const draftPlansWithRecipe = await db
    .select({ itemId: productionPlanItemsTable.id })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
    .where(and(
      eq(productionPlanItemsTable.recipeId, id),
      eq(productionPlansTable.status, "draft"),
      gte(productionPlansTable.planDate, today),
    ));

  if (draftPlansWithRecipe.length > 0) {
    await db.update(productionPlanItemsTable)
      .set({
        tinSize: updated.tinSize ?? null,
        maxBatchesPerTin: updated.maxBatchesPerTin ?? null,
        sopUrl: updated.sopUrl ?? null,
      })
      .where(inArray(productionPlanItemsTable.id, draftPlansWithRecipe.map(r => r.itemId)));
  }

  const mapped = mapRecipe(updated);
  const rawCosts = await computeCosts([id]);
  res.json(enrichWithCosts(mapped, rawCosts[id] ?? 0));

  // Recipe ingredients changed — recalculate DPT ingredient requirements
  recalculateDptRequirements().catch(err =>
    console.error("Auto-recalculate DPT after recipe update failed:", err)
  );
});

router.patch("/:id/special", async (req, res) => {
  const id = Number(req.params.id);
  const { isCurrentSpecial } = req.body as { isCurrentSpecial: boolean };
  if (typeof isCurrentSpecial !== "boolean") {
    res.status(400).json({ error: "isCurrentSpecial must be a boolean" });
    return;
  }

  let updatedRow: typeof recipesTable.$inferSelect | undefined;

  if (isCurrentSpecial) {
    await db.transaction(async (tx) => {
      await tx.update(recipesTable).set({ isCurrentSpecial: false }).where(ne(recipesTable.id, id));
      const [row] = await tx.update(recipesTable)
        .set({ isCurrentSpecial: true })
        .where(eq(recipesTable.id, id))
        .returning();
      updatedRow = row;
    });
  } else {
    const [row] = await db.update(recipesTable)
      .set({ isCurrentSpecial: false })
      .where(eq(recipesTable.id, id))
      .returning();
    updatedRow = row;
  }

  if (!updatedRow) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: updatedRow.id, isCurrentSpecial: updatedRow.isCurrentSpecial });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(recipesTable).where(eq(recipesTable.id, id));
  res.status(204).send();
});

// ── Recipe → Shopify variant mapping CRUD ────────────────────────────────────
// Multiple Shopify variants can map to the same recipe.

// Which pinned Label LIVE design prints this recipe's ingredient-deck
// label (designs differ per recipe — deck length and extra info vary).
// Null clears the mapping. The design name must match the design pinned
// to Label LIVE's Home screen on the printing PC.
router.put("/:id/label-design", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const raw = (req.body as { designName?: unknown } | undefined)?.designName;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    res.status(400).json({ error: "designName must be a string or null" });
    return;
  }
  const designName = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  const [row] = await db.update(recipesTable)
    .set({ labelLiveDesignName: designName })
    .where(eq(recipesTable.id, parsed.data.id))
    .returning({ id: recipesTable.id, labelLiveDesignName: recipesTable.labelLiveDesignName });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// Toggle "fridge product" — wrapped and held in the production fridge, as
// opposed to frozen / F2F / clearance lines. Dedicated endpoint (like
// /:id/special and /:id/label-design) so it needs no OpenAPI codegen round.
router.put("/:id/fridge-product", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const raw = (req.body as { isFridgeProduct?: unknown } | undefined)?.isFridgeProduct;
  if (typeof raw !== "boolean") {
    res.status(400).json({ error: "isFridgeProduct must be a boolean" });
    return;
  }
  const [row] = await db.update(recipesTable)
    .set({ isFridgeProduct: raw })
    .where(eq(recipesTable.id, parsed.data.id))
    .returning({ id: recipesTable.id, isFridgeProduct: recipesTable.isFridgeProduct });
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.get("/:id/shopify-mapping", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const recipeId = parsed.data.id;
  try {
    const rows = await db.execute(sql`
      SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId} ORDER BY created_at
    `);
    res.json(rows.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Add a variant mapping (POST instead of PUT — multiple allowed per recipe)
router.post("/:id/shopify-mapping", async (req, res) => {
  const parsedParams = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsedParams.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const parsedBody = ShopifyMappingBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const recipeId = parsedParams.data.id;
  const { shopifyVariantId, shopifyProductTitle, shopifyVariantTitle, wonkyVariantId, wonkyProductTitle, wonkyVariantTitle } = parsedBody.data;
  try {
    const [recipe] = await db.select({ id: recipesTable.id }).from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    await db.execute(sql`
      INSERT INTO recipe_shopify_mappings (recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title, wonky_variant_id, wonky_product_title, wonky_variant_title)
      VALUES (${recipeId}, ${shopifyVariantId}, ${shopifyProductTitle ?? null}, ${shopifyVariantTitle ?? null}, ${wonkyVariantId ?? null}, ${wonkyProductTitle ?? null}, ${wonkyVariantTitle ?? null})
      ON CONFLICT (shopify_variant_id) DO UPDATE SET
        recipe_id             = EXCLUDED.recipe_id,
        shopify_product_title = EXCLUDED.shopify_product_title,
        shopify_variant_title = EXCLUDED.shopify_variant_title,
        wonky_variant_id      = EXCLUDED.wonky_variant_id,
        wonky_product_title   = EXCLUDED.wonky_product_title,
        wonky_variant_title   = EXCLUDED.wonky_variant_title
    `);
    // Pull the SKU off Shopify and stash it on the mapping so the
    // packing checklists can sort recipes in SKU order. Best-effort —
    // network failures don't fail the mapping save.
    try {
      const { getVariantSkus } = await import("../services/shopify");
      const skus = await getVariantSkus([shopifyVariantId]);
      const sku = skus.get(shopifyVariantId);
      if (sku) {
        await db.execute(sql`UPDATE recipe_shopify_mappings SET shopify_sku = ${sku} WHERE shopify_variant_id = ${shopifyVariantId}`);
      }
    } catch (skuErr) {
      console.warn("[recipes] shopify_sku sync failed:", skuErr instanceof Error ? skuErr.message : skuErr);
    }
    const saved = await db.execute(sql`SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId} ORDER BY created_at`);
    res.json(saved.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Legacy PUT — still works, adds/updates a mapping
router.put("/:id/shopify-mapping", async (req, res) => {
  const parsedParams = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsedParams.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const parsedBody = ShopifyMappingBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const recipeId = parsedParams.data.id;
  const { shopifyVariantId, shopifyProductTitle, shopifyVariantTitle, wonkyVariantId, wonkyProductTitle, wonkyVariantTitle } = parsedBody.data;
  try {
    const [recipe] = await db.select({ id: recipesTable.id }).from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }
    await db.execute(sql`
      INSERT INTO recipe_shopify_mappings (recipe_id, shopify_variant_id, shopify_product_title, shopify_variant_title, wonky_variant_id, wonky_product_title, wonky_variant_title)
      VALUES (${recipeId}, ${shopifyVariantId}, ${shopifyProductTitle ?? null}, ${shopifyVariantTitle ?? null}, ${wonkyVariantId ?? null}, ${wonkyProductTitle ?? null}, ${wonkyVariantTitle ?? null})
      ON CONFLICT (shopify_variant_id) DO UPDATE SET
        recipe_id             = EXCLUDED.recipe_id,
        shopify_product_title = EXCLUDED.shopify_product_title,
        shopify_variant_title = EXCLUDED.shopify_variant_title,
        wonky_variant_id      = EXCLUDED.wonky_variant_id,
        wonky_product_title   = EXCLUDED.wonky_product_title,
        wonky_variant_title   = EXCLUDED.wonky_variant_title
    `);
    // Pull the SKU off Shopify and stash it on the mapping so the
    // packing checklists can sort recipes in SKU order. Best-effort —
    // network failures don't fail the mapping save.
    try {
      const { getVariantSkus } = await import("../services/shopify");
      const skus = await getVariantSkus([shopifyVariantId]);
      const sku = skus.get(shopifyVariantId);
      if (sku) {
        await db.execute(sql`UPDATE recipe_shopify_mappings SET shopify_sku = ${sku} WHERE shopify_variant_id = ${shopifyVariantId}`);
      }
    } catch (skuErr) {
      console.warn("[recipes] shopify_sku sync failed:", skuErr instanceof Error ? skuErr.message : skuErr);
    }
    const saved = await db.execute(sql`SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId} ORDER BY created_at`);
    res.json(saved.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Delete a specific variant mapping
router.delete("/:id/shopify-mapping/:variantId", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const variantId = req.params.variantId;
  try {
    await db.execute(sql`DELETE FROM recipe_shopify_mappings WHERE recipe_id = ${parsed.data.id} AND shopify_variant_id = ${variantId}`);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Delete all mappings for a recipe (legacy)
router.delete("/:id/shopify-mapping", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  try {
    await db.execute(sql`DELETE FROM recipe_shopify_mappings WHERE recipe_id = ${parsed.data.id}`);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

const NUTRIENT_KEYS = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"] as const;
type NutrientKey = typeof NUTRIENT_KEYS[number];

interface IngredientNutrientRow {
  ingredientId: number;
  name: string;
  quantityG: number;
  labelDeclaration: string | null;
  allergens: string[];
  nutrients: Record<NutrientKey, number | null>;
}

export async function gatherRecipeIngredients(recipeId: number): Promise<{
  items: IngredientNutrientRow[];
  totalWeightG: number;
  cookingLossPercent: number;
  portionsPerBatch: number;
  // `servings` is the recipe's "Output / Recipe Size" — i.e. how many
  // portions the ingredient quantities in this recipe add up to.
  // Typically 1 (one calzone = one portion). It is the correct divisor
  // for per-portion weight and nutrition, NOT portionsPerBatch (which is
  // a separate production-batching figure).
  servings: number;
  packSize: number;
  missingNutritionals: string[];
  missingNutritionalDetail: Array<{ ingredientId: number; name: string; missing: string[] }>;
  missingDeclarations: string[];
}> {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) throw new Error("Recipe not found");

  const cookingLossPercent = Number(recipe.cookingLossPercent) || 3;
  const portionsPerBatch = recipe.portionsPerBatch ?? 10;
  const servings = Number(recipe.servings) || 1;
  const packSize = Number(recipe.packSize) || 1;

  const directIngs = await db
    .select({
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
      name: ingredientsTable.name,
      labelDeclaration: ingredientsTable.labelDeclaration,
      allergens: ingredientsTable.allergens,
      energyKj: ingredientsTable.energyKj,
      energyKcal: ingredientsTable.energyKcal,
      fat: ingredientsTable.fat,
      saturates: ingredientsTable.saturates,
      carbohydrate: ingredientsTable.carbohydrate,
      sugars: ingredientsTable.sugars,
      protein: ingredientsTable.protein,
      fibre: ingredientsTable.fibre,
      salt: ingredientsTable.salt,
    })
    .from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId));

  const items: IngredientNutrientRow[] = directIngs.map(i => ({
    ingredientId: i.ingredientId,
    name: i.name,
    quantityG: Number(i.quantity),
    labelDeclaration: i.labelDeclaration,
    allergens: (i.allergens as string[] | null) ?? [],
    nutrients: {
      energyKj: i.energyKj != null ? Number(i.energyKj) : null,
      energyKcal: i.energyKcal != null ? Number(i.energyKcal) : null,
      fat: i.fat != null ? Number(i.fat) : null,
      saturates: i.saturates != null ? Number(i.saturates) : null,
      carbohydrate: i.carbohydrate != null ? Number(i.carbohydrate) : null,
      sugars: i.sugars != null ? Number(i.sugars) : null,
      fibre: i.fibre != null ? Number(i.fibre) : null,
      protein: i.protein != null ? Number(i.protein) : null,
      salt: i.salt != null ? Number(i.salt) : null,
    },
  }));

  const subRecipeLinks = await db
    .select({
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
    })
    .from(recipeSubRecipesTable)
    .where(eq(recipeSubRecipesTable.recipeId, recipeId));

  // Add one ingredient's contribution into `items`, merging by ingredient so an
  // ingredient reached via several paths is counted once with summed weight.
  const addItem = (
    row: {
      ingredientId: number; name: string; labelDeclaration: string | null;
      allergens: unknown; energyKj: unknown; energyKcal: unknown; fat: unknown;
      saturates: unknown; carbohydrate: unknown; sugars: unknown; protein: unknown;
      fibre: unknown; salt: unknown;
    },
    quantityG: number,
  ) => {
    const num = (v: unknown) => (v != null ? Number(v) : null);
    const existing = items.find(it => it.ingredientId === row.ingredientId);
    if (existing) {
      existing.quantityG += quantityG;
      return;
    }
    items.push({
      ingredientId: row.ingredientId,
      name: row.name,
      quantityG,
      labelDeclaration: row.labelDeclaration,
      allergens: (row.allergens as string[] | null) ?? [],
      nutrients: {
        energyKj: num(row.energyKj), energyKcal: num(row.energyKcal), fat: num(row.fat),
        saturates: num(row.saturates), carbohydrate: num(row.carbohydrate), sugars: num(row.sugars),
        fibre: num(row.fibre), protein: num(row.protein), salt: num(row.salt),
      },
    });
  };

  // Walk a sub-recipe to ANY depth, scaling each level's quantities by how much
  // of that sub-recipe is actually used. Previously this only descended one
  // level, so ingredients inside a nested sub-recipe (e.g. Tomato Base ->
  // Normal Base Dry Mix) were absent from the totals entirely — understating
  // nutrition and making them impossible to report as missing.
  // `ancestorPath` guards against a cyclic definition (A -> B -> A).
  const walkSubRecipe = async (subRecipeId: number, usedG: number, ancestorPath: number[]): Promise<void> => {
    if (ancestorPath.includes(subRecipeId)) return; // cycle — stop descending
    const [subRecipe] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, subRecipeId));
    if (!subRecipe) return;

    const srYield = Number(subRecipe.yield) || 1;
    const scaleFactor = usedG / srYield;
    const path = [...ancestorPath, subRecipeId];

    const srIngs = await db
      .select({
        ingredientId: subRecipeIngredientsTable.ingredientId,
        quantity: subRecipeIngredientsTable.quantity,
        name: ingredientsTable.name,
        labelDeclaration: ingredientsTable.labelDeclaration,
        allergens: ingredientsTable.allergens,
        energyKj: ingredientsTable.energyKj,
        energyKcal: ingredientsTable.energyKcal,
        fat: ingredientsTable.fat,
        saturates: ingredientsTable.saturates,
        carbohydrate: ingredientsTable.carbohydrate,
        sugars: ingredientsTable.sugars,
        protein: ingredientsTable.protein,
        fibre: ingredientsTable.fibre,
        salt: ingredientsTable.salt,
      })
      .from(subRecipeIngredientsTable)
      .innerJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));

    for (const si of srIngs) addItem(si, Number(si.quantity) * scaleFactor);

    // Descend into nested sub-recipes, scaling their used weight the same way.
    const nested = await db
      .select({
        componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
        quantity: subRecipeSubRecipesTable.quantity,
      })
      .from(subRecipeSubRecipesTable)
      .where(eq(subRecipeSubRecipesTable.subRecipeId, subRecipeId));

    for (const nl of nested) {
      await walkSubRecipe(nl.componentSubRecipeId, Number(nl.quantity) * scaleFactor, path);
    }
  };

  for (const sr of subRecipeLinks) {
    await walkSubRecipe(sr.subRecipeId, Number(sr.quantity), []);
  }

  const totalWeightG = items.reduce((sum, i) => sum + i.quantityG, 0);

  // An ingredient counts as "missing nutritionals" if ANY per-100g value is
  // absent, not only when every one is. A partially-filled ingredient still
  // silently understates whichever nutrients it lacks, so the panel must not
  // be treated as complete until every value on every ingredient is present.
  const missingNutritionals = items
    .filter(i => NUTRIENT_KEYS.some(k => i.nutrients[k] === null))
    .map(i => i.name);

  // Which specific nutrients are absent, per ingredient — so the UI can say
  // "Mozzarella: fat, saturates" rather than just naming the ingredient.
  const missingNutritionalDetail = items
    .filter(i => NUTRIENT_KEYS.some(k => i.nutrients[k] === null))
    .map(i => ({
      ingredientId: i.ingredientId,
      name: i.name,
      missing: NUTRIENT_KEYS.filter(k => i.nutrients[k] === null),
    }));

  const missingDeclarations = items
    .filter(i => !i.labelDeclaration)
    .map(i => i.name);

  return {
    items, totalWeightG, cookingLossPercent, portionsPerBatch, servings, packSize,
    missingNutritionals, missingNutritionalDetail, missingDeclarations,
  };
}

router.get("/:id/nutritionals", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }

  try {
    const { items, totalWeightG, cookingLossPercent, portionsPerBatch, servings, packSize, missingNutritionals, missingNutritionalDetail, missingDeclarations } =
      await gatherRecipeIngredients(parsed.data.id);

    const cookedWeightG = totalWeightG * (1 - cookingLossPercent / 100);
    // Ingredient quantities sum to the recipe-size weight (servings portions),
    // not a per-batch weight, so divide by servings — not portionsPerBatch.
    const portionDivisor = servings > 0 ? servings : 1;
    const portionWeightG = Math.round(cookedWeightG / portionDivisor);
    const declaredPackWeightG = Math.round(portionWeightG * packSize);

    const per100g: Record<NutrientKey, number | null> = {
      energyKj: null, energyKcal: null, fat: null, saturates: null,
      carbohydrate: null, sugars: null, fibre: null, protein: null, salt: null,
    };

    if (totalWeightG > 0) {
      for (const key of NUTRIENT_KEYS) {
        let total = 0;
        let allNull = true;
        for (const item of items) {
          const val = item.nutrients[key];
          if (val !== null) {
            allNull = false;
            total += (val / 100) * item.quantityG;
          }
        }
        if (!allNull) {
          per100g[key] = Math.round((total / totalWeightG) * 100 * 100) / 100;
        }
      }
    }

    const perPortion: Record<NutrientKey, number | null> = { ...per100g };
    if (portionWeightG > 0) {
      for (const key of NUTRIENT_KEYS) {
        if (per100g[key] !== null) {
          perPortion[key] = Math.round((per100g[key]! / 100) * portionWeightG * 100) / 100;
        }
      }
    }

    res.json({
      totalRawWeightG: Math.round(totalWeightG),
      cookingLossPercent,
      cookedWeightG: Math.round(cookedWeightG),
      portionsPerBatch,
      servings,
      portionWeightG,
      packSize,
      declaredPackWeightG,
      per100g,
      perPortion,
      completeness: {
        totalIngredients: items.length,
        missingNutritionals,
        missingNutritionalDetail,
        missingDeclarations,
        isComplete: missingNutritionals.length === 0 && missingDeclarations.length === 0,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Recipe not found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

/** True when a declaration lists several components but never names the compound
 *  ingredient they belong to — e.g. "Pork, Salt, Paprika" instead of
 *  "Chorizo (Pork, Salt, Paprika)". A correctly wrapped declaration has no
 *  top-level comma before its first bracket, and that bracket closes at the very
 *  end, so the whole string is one "Name (...)" group. Single-component
 *  declarations ("Salt", "Basil") need no wrapper and are never flagged. */
export function declarationNeedsWrapper(declaration: string): boolean {
  const s = declaration.trim().replace(/\.+$/, "").trim();
  if (!s) return false;

  const firstBracket = s.indexOf("(");
  // Wrapped iff nothing before the first bracket contains a comma AND that
  // bracket's match is the final character.
  let wrapped = false;
  if (firstBracket !== -1 && !s.slice(0, firstBracket).includes(",")) {
    let depth = 0;
    for (let j = firstBracket; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")") {
        depth--;
        if (depth === 0) { wrapped = j === s.length - 1; break; }
      }
    }
  }
  if (wrapped) return false;

  // Not wrapped — only a problem if it's actually a multi-component list.
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return true; // top-level comma => compound
  }
  return false;
}

const ALLERGEN_DISPLAY: Record<string, string> = {
  celery: "Celery",
  cereals_containing_gluten: "Wheat",
  crustaceans: "Crustaceans",
  eggs: "Eggs",
  fish: "Fish",
  lupin: "Lupin",
  milk: "Milk",
  molluscs: "Molluscs",
  mustard: "Mustard",
  nuts: "Nuts",
  peanuts: "Peanuts",
  sesame: "Sesame",
  soybeans: "Soybeans",
  sulphur_dioxide: "Sulphur Dioxide",
};

function boldAllergens(text: string, allergens: string[]): string {
  let result = text;
  for (const allergen of allergens) {
    const displayName = ALLERGEN_DISPLAY[allergen] || allergen;
    const escaped = displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b(${escaped})\\b`, "gi");
    result = result.replace(regex, "**$1**");
  }
  return result;
}

interface DeckEntry {
  type: "ingredient" | "compound";
  name: string;
  declaration: string;
  percentage: number;
  allergens: string[];
  isQuid: boolean;
  ingredientId?: number;
  subRecipeId?: number;
  subIngredients?: Array<{
    ingredientId: number;
    name: string;
    declaration: string;
    percentage: number;
    allergens: string[];
  }>;
}

router.get("/:id/ingredient-deck", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }

  try {
    const recipeId = parsed.data.id;
    const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

    const directIngs = await db
      .select({
        ingredientId: recipeIngredientsTable.ingredientId,
        quantity: recipeIngredientsTable.quantity,
        quid: recipeIngredientsTable.quid,
        name: ingredientsTable.name,
        unit: ingredientsTable.unit,
        labelDeclaration: ingredientsTable.labelDeclaration,
        allergens: ingredientsTable.allergens,
      })
      .from(recipeIngredientsTable)
      .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(eq(recipeIngredientsTable.recipeId, recipeId));

    const subRecipeLinks = await db
      .select({
        subRecipeId: recipeSubRecipesTable.subRecipeId,
        quantity: recipeSubRecipesTable.quantity,
        quid: recipeSubRecipesTable.quid,
      })
      .from(recipeSubRecipesTable)
      .where(eq(recipeSubRecipesTable.recipeId, recipeId));

    function toGrams(qty: number, unit: string): number {
      const u = unit.toLowerCase().trim();
      if (u === "kg") return qty * 1000;
      if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return qty * 1000;
      if (u === "ml") return qty;
      return qty;
    }

    type FlatSubIng = {
      ingredientId: number;
      name: string;
      quantityG: number;
      labelDeclaration: string | null;
      allergens: string[];
    };

    // Recursively flatten a sub-recipe's ingredients (including any nested
    // sub-recipes — e.g. a "dry mix" sub-recipe placed inside a "dough"
    // sub-recipe). Returns ingredient weights in grams scaled to one full
    // batch of the sub-recipe (i.e. summing to roughly the sub-recipe's
    // yield, under the same weight-in == weight-out assumption used by the
    // rest of this endpoint). The caller normalises to actual used weight.
    //
    // `ancestorPath` is mutated to detect cycles (sub-recipe A → B → A).
    async function flattenSubRecipeIngredients(
      subRecipeId: number,
      ancestorPath: Set<number>,
    ): Promise<FlatSubIng[]> {
      if (ancestorPath.has(subRecipeId)) return [];
      ancestorPath.add(subRecipeId);

      const direct = await db
        .select({
          ingredientId: subRecipeIngredientsTable.ingredientId,
          quantity: subRecipeIngredientsTable.quantity,
          name: ingredientsTable.name,
          unit: ingredientsTable.unit,
          labelDeclaration: ingredientsTable.labelDeclaration,
          allergens: ingredientsTable.allergens,
        })
        .from(subRecipeIngredientsTable)
        .innerJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
        .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));

      const out: FlatSubIng[] = direct.map(si => ({
        ingredientId: si.ingredientId,
        name: si.name,
        quantityG: toGrams(Number(si.quantity), si.unit ?? "g"),
        labelDeclaration: si.labelDeclaration,
        allergens: (si.allergens as string[] | null) ?? [],
      }));

      const nestedLinks = await db
        .select({
          componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
          quantity: subRecipeSubRecipesTable.quantity,
        })
        .from(subRecipeSubRecipesTable)
        .where(eq(subRecipeSubRecipesTable.subRecipeId, subRecipeId));

      for (const nl of nestedLinks) {
        const [nestedSr] = await db
          .select()
          .from(subRecipesTable)
          .where(eq(subRecipesTable.id, nl.componentSubRecipeId));
        if (!nestedSr) continue;

        const nestedFlat = await flattenSubRecipeIngredients(nl.componentSubRecipeId, ancestorPath);
        const nestedTotalG = nestedFlat.reduce((s, i) => s + i.quantityG, 0);
        if (nestedTotalG <= 0) continue;

        // nl.quantity is expressed in the nested sub-recipe's yieldUnit and
        // represents the amount used per one full batch of the *parent*.
        const nestedUsedG = toGrams(Number(nl.quantity), nestedSr.yieldUnit ?? "g");
        const scaleFactor = nestedUsedG / nestedTotalG;

        for (const ing of nestedFlat) {
          out.push({
            ...ing,
            quantityG: ing.quantityG * scaleFactor,
          });
        }
      }

      ancestorPath.delete(subRecipeId);

      // Merge duplicate ingredients — e.g. salt appears in both the parent
      // sub-recipe's direct ingredients and a nested dry-mix. Without this
      // the same raw ingredient would be listed twice inside a compound
      // bracket on the deck.
      const merged = new Map<number, FlatSubIng>();
      for (const ing of out) {
        const existing = merged.get(ing.ingredientId);
        if (existing) {
          existing.quantityG += ing.quantityG;
          // Union allergens, in case one row's ingredient row was missing them.
          existing.allergens = [...new Set([...existing.allergens, ...ing.allergens])];
        } else {
          merged.set(ing.ingredientId, { ...ing });
        }
      }
      return [...merged.values()];
    }

    const directItems: Array<{
      ingredientId: number;
      name: string;
      quantityG: number;
      labelDeclaration: string | null;
      allergens: string[];
      isQuid: boolean;
    }> = [];
    // A recipe may list the same ingredient on several lines (e.g. BBQ sauce
    // both in the filling mix and on top, rosemary in the mix and as a
    // topping). A legal ingredients declaration must name each ingredient
    // ONCE, with its weights combined — so merge by ingredient here and sum
    // the quantities. QUID applies to the merged total if any line is flagged.
    {
      const byIngredient = new Map<number, (typeof directItems)[number]>();
      for (const i of directIngs) {
        const grams = toGrams(Number(i.quantity), i.unit ?? "g");
        const existing = byIngredient.get(i.ingredientId);
        if (existing) {
          existing.quantityG += grams;
          existing.isQuid = existing.isQuid || (i.quid ?? false);
        } else {
          byIngredient.set(i.ingredientId, {
            ingredientId: i.ingredientId,
            name: i.name,
            quantityG: grams,
            labelDeclaration: i.labelDeclaration,
            allergens: (i.allergens as string[] | null) ?? [],
            isQuid: i.quid ?? false,
          });
        }
      }
      directItems.push(...byIngredient.values());
    }

    interface SubRecipeGroup {
      subRecipeId: number;
      name: string;
      labelDeclaration: string | null;
      totalQuantityG: number;
      isQuid: boolean;
      ingredients: FlatSubIng[];
    }

    const subRecipeGroups: SubRecipeGroup[] = [];

    for (const sr of subRecipeLinks) {
      const [subRecipe] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, sr.subRecipeId));
      if (!subRecipe) continue;

      const srUsedG = toGrams(Number(sr.quantity), subRecipe.yieldUnit ?? "g");

      // Flatten this sub-recipe's ingredients, recursing through any nested
      // sub-recipes (e.g. dough → dry-mix). Cycle detection is per top-level
      // sub-recipe call, so two siblings can share the same nested mix.
      const srIngNormalized = await flattenSubRecipeIngredients(
        sr.subRecipeId,
        new Set<number>(),
      );

      const srTotalIngWeightG = srIngNormalized.reduce((s, i) => s + i.quantityG, 0);

      const scaledIngs = srIngNormalized.map(si => ({
        ...si,
        quantityG: srTotalIngWeightG > 0
          ? (si.quantityG / srTotalIngWeightG) * srUsedG
          : 0,
      }));

      subRecipeGroups.push({
        subRecipeId: sr.subRecipeId,
        name: subRecipe.name,
        labelDeclaration: subRecipe.labelDeclaration ?? null,
        totalQuantityG: srUsedG,
        isQuid: sr.quid ?? false,
        ingredients: scaledIngs,
      });
    }

    const totalWeightG = directItems.reduce((s, i) => s + i.quantityG, 0)
      + subRecipeGroups.reduce((s, g) => s + g.totalQuantityG, 0);

    const deckEntries: DeckEntry[] = [];

    for (const item of directItems) {
      const pct = totalWeightG > 0 ? Math.round((item.quantityG / totalWeightG) * 1000) / 10 : 0;
      const declaration = item.labelDeclaration || item.name;
      const bolded = boldAllergens(declaration, item.allergens);

      deckEntries.push({
        type: "ingredient",
        name: item.name,
        declaration: item.isQuid ? `${bolded} (${pct}%)` : bolded,
        percentage: pct,
        allergens: item.allergens.map(a => ALLERGEN_DISPLAY[a] || a),
        isQuid: item.isQuid,
        ingredientId: item.ingredientId,
      });
    }

    for (const group of subRecipeGroups) {
      const pct = totalWeightG > 0 ? Math.round((group.totalQuantityG / totalWeightG) * 1000) / 10 : 0;

      if (pct >= 25) {
        const sortedSubIngs = [...group.ingredients].sort((a, b) => b.quantityG - a.quantityG);
        const subIngTotalG = sortedSubIngs.reduce((s, i) => s + i.quantityG, 0);

        const subIngEntries = sortedSubIngs.map(si => {
          const siPct = subIngTotalG > 0 ? Math.round((si.quantityG / subIngTotalG) * 1000) / 10 : 0;
          const dec = si.labelDeclaration || si.name;
          return {
            ingredientId: si.ingredientId,
            name: si.name,
            declaration: boldAllergens(dec, si.allergens),
            percentage: siPct,
            allergens: si.allergens.map(a => ALLERGEN_DISPLAY[a] || a),
          };
        });

        const compoundName = group.labelDeclaration || group.name;
        const allGroupAllergens = group.ingredients.flatMap(i => i.allergens);
        const boldedName = boldAllergens(compoundName, allGroupAllergens);
        const subDeclarations = subIngEntries.map(s => s.declaration).join(", ");
        const compoundDeclaration = group.isQuid
          ? `${boldedName} (${pct}%) (${subDeclarations})`
          : `${boldedName} (${subDeclarations})`;

        deckEntries.push({
          type: "compound",
          name: group.name,
          declaration: compoundDeclaration,
          percentage: pct,
          allergens: [...new Set(allGroupAllergens)].map(a => ALLERGEN_DISPLAY[a] || a),
          isQuid: group.isQuid,
          subRecipeId: group.subRecipeId,
          subIngredients: subIngEntries,
        });
      } else {
        for (const si of group.ingredients) {
          const siGlobalPct = totalWeightG > 0 ? Math.round((si.quantityG / totalWeightG) * 1000) / 10 : 0;
          const dec = si.labelDeclaration || si.name;
          const bolded = boldAllergens(dec, si.allergens);

          const existingIdx = deckEntries.findIndex(
            e => e.type === "ingredient" && e.ingredientId === si.ingredientId
          );
          if (existingIdx >= 0) {
            const existing = deckEntries[existingIdx];
            const combinedQtyG = (existing.percentage / 100 * totalWeightG) + si.quantityG;
            const combinedPct = totalWeightG > 0 ? Math.round((combinedQtyG / totalWeightG) * 1000) / 10 : 0;
            existing.percentage = combinedPct;
            const mergedAllergens = [...new Set([...existing.allergens, ...si.allergens.map(a => ALLERGEN_DISPLAY[a] || a)])];
            existing.allergens = mergedAllergens;
            const rawAllergens = [...new Set([
              ...(directItems.find(d => d.ingredientId === si.ingredientId)?.allergens ?? []),
              ...si.allergens,
            ])];
            const baseDeclaration = dec;
            existing.declaration = existing.isQuid
              ? `${boldAllergens(baseDeclaration, rawAllergens)} (${combinedPct}%)`
              : boldAllergens(baseDeclaration, rawAllergens);
          } else {
            deckEntries.push({
              type: "ingredient",
              name: si.name,
              declaration: bolded,
              percentage: siGlobalPct,
              allergens: si.allergens.map(a => ALLERGEN_DISPLAY[a] || a),
              isQuid: false,
              ingredientId: si.ingredientId,
            });
          }
        }
      }
    }

    const aboveThreshold = deckEntries
      .filter(e => e.percentage >= 2)
      .sort((a, b) => b.percentage - a.percentage);
    const belowThreshold = deckEntries
      .filter(e => e.percentage < 2)
      .sort((a, b) => b.percentage - a.percentage);
    const sortedEntries = [...aboveThreshold, ...belowThreshold];

    const allAllergens = [...new Set([
      ...directItems.flatMap(i => i.allergens),
      ...subRecipeGroups.flatMap(g => g.ingredients.flatMap(i => i.allergens)),
    ])].sort();
    const allergenDisplayList = allAllergens.map(a => ALLERGEN_DISPLAY[a] || a);

    const deckText = sortedEntries.map(d => d.declaration).join(", ") + ".";

    const missingDeclarations = [
      ...directItems.filter(i => !i.labelDeclaration).map(i => i.name),
      ...subRecipeGroups.flatMap(g => g.ingredients.filter(i => !i.labelDeclaration).map(i => i.name)),
    ];

    // A compound ingredient's declaration must name the ingredient and bracket
    // its components — "Chorizo (Pork, Salt, ...)". Several were stored as a
    // bare component list, which the deck then concatenates into a run-on that
    // never says which ingredient those components belong to. Flag them so the
    // operator fixes the declaration rather than shipping an unlawful label.
    const unwrappedDeclarations = [
      ...directItems,
      ...subRecipeGroups.flatMap(g => g.ingredients),
    ]
      .filter(i => i.labelDeclaration && declarationNeedsWrapper(i.labelDeclaration))
      .map(i => i.name);

    const [mayContainRow] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "may_contain_statement"));

    const mayContainStatement = mayContainRow?.value || null;

    res.json({
      ingredients: sortedEntries,
      deckText,
      allergens: allergenDisplayList,
      mayContainStatement,
      missingDeclarations: [...new Set(missingDeclarations)],
      unwrappedDeclarations: [...new Set(unwrappedDeclarations)],
      isComplete: missingDeclarations.length === 0 && unwrappedDeclarations.length === 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Recipe not found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

// ── Push ingredient deck to the Shopify website ────────────────────────────
// Writes the deck (with allergen bolding), the standard allergen statement
// and the legal disclaimer into the `custom.ingredient_deck` rich-text
// metafield on every Shopify PRODUCT linked to this recipe (via the main /
// wonky / 8-pack variant mappings). That metafield is what the storefront
// theme renders on product pages, so this replaces the old copy-paste flow.

type RichRun = { type: "text"; value: string; bold?: boolean };

/** Convert the deck's markdown-style **Allergen** markers into Shopify
 *  rich-text runs. Split on `**`: odd segments are the bolded ones. */
function mdBoldToRichRuns(text: string): RichRun[] {
  const runs: RichRun[] = [];
  text.split("**").forEach((part, i) => {
    if (!part) return;
    runs.push(i % 2 === 1 ? { type: "text", value: part, bold: true } : { type: "text", value: part });
  });
  return runs;
}

router.post("/:id/push-ingredient-deck", requireAdmin, async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const recipeId = parsed.data.id;
  // ?dryRun=1 builds everything and reports which products WOULD be updated
  // without writing — the UI uses it as the confirm step before publishing.
  const dryRun = req.query["dryRun"] === "1";
  const { shopifyGraphQL } = await import("../services/shopify");

  try {
    const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

    // Deck over loopback so the pushed content always matches the app's own
    // deck view (same pattern as the spec-sheet PDF).
    const port = process.env["PORT"];
    if (!port) { res.status(500).json({ error: "Server PORT not set — cannot build the deck" }); return; }
    const deckResp = await fetch(`http://127.0.0.1:${port}/api/recipes/${recipeId}/ingredient-deck`, {
      headers: { cookie: req.headers.cookie ?? "" },
    });
    if (!deckResp.ok) { res.status(502).json({ error: "Could not build the ingredient deck" }); return; }
    const deck = (await deckResp.json()) as {
      deckText: string;
      mayContainStatement: string | null;
      missingDeclarations: string[];
      unwrappedDeclarations: string[];
      isComplete: boolean;
    };

    // Never publish an incomplete (potentially unlawful) declaration.
    if (!deck.isComplete) {
      res.status(422).json({
        error: "The deck isn't ready to publish — fix the flagged declarations first.",
        missingDeclarations: deck.missingDeclarations,
        unwrappedDeclarations: deck.unwrappedDeclarations,
      });
      return;
    }

    const [disclaimerRow] = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, "legal_disclaimer_statement"));
    const disclaimer = disclaimerRow?.value || null;

    // All Shopify variants linked to this recipe → their parent products.
    const mappingRows = await db.execute<{
      shopify_variant_id: string | null;
      wonky_variant_id: string | null;
      eight_pack_variant_id: string | null;
    }>(sql`
      SELECT shopify_variant_id, wonky_variant_id, eight_pack_variant_id
      FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}
    `);
    const variantIds = [...new Set(
      mappingRows.rows
        .flatMap(r => [r.shopify_variant_id, r.wonky_variant_id, r.eight_pack_variant_id])
        .filter((v): v is string => !!v && v.trim() !== ""),
    )];
    if (variantIds.length === 0) {
      res.status(422).json({ error: "This recipe has no linked Shopify variants — link it on the recipe's Shopify mapping first." });
      return;
    }

    const nodes = await shopifyGraphQL<{
      nodes: Array<{ id: string; product: { id: string; title: string } } | null>;
    }>(
      `query ($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant { id product { id title } }
        }
      }`,
      { ids: variantIds.map(v => `gid://shopify/ProductVariant/${v}`) },
    );
    const products = new Map<string, string>(); // gid → title
    for (const n of nodes.nodes) {
      if (n?.product) products.set(n.product.id, n.product.title);
    }
    if (products.size === 0) {
      res.status(422).json({ error: "None of the linked variants exist on Shopify any more — re-link the recipe." });
      return;
    }

    // Shopify rich-text document: deck paragraph, allergen statement,
    // legal disclaimer.
    const children: Array<{ type: "paragraph"; children: RichRun[] }> = [
      { type: "paragraph", children: mdBoldToRichRuns(deck.deckText) },
    ];
    const allergenRuns: RichRun[] = [
      { type: "text", value: "Allergens are shown in " },
      { type: "text", value: "Bold", bold: true },
      { type: "text", value: "." },
    ];
    if (deck.mayContainStatement) {
      allergenRuns.push({ type: "text", value: ` ${deck.mayContainStatement.trim().replace(/\.?$/, ".")}` });
    }
    children.push({ type: "paragraph", children: allergenRuns });
    if (disclaimer) {
      children.push({
        type: "paragraph",
        children: [
          { type: "text", value: "Legal Disclaimer: ", bold: true },
          { type: "text", value: disclaimer },
        ],
      });
    }
    const value = JSON.stringify({ type: "root", children });

    if (dryRun) {
      res.json({ dryRun: true, wouldPush: [...products.values()], metafield: "custom.ingredient_deck", richTextValue: value });
      return;
    }

    const result = await shopifyGraphQL<{
      metafieldsSet: {
        metafields: Array<{ id: string }> | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(
      `mutation ($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id }
          userErrors { field message }
        }
      }`,
      {
        metafields: [...products.keys()].map(ownerId => ({
          ownerId,
          namespace: "custom",
          key: "ingredient_deck",
          type: "rich_text_field",
          value,
        })),
      },
    );
    if (result.metafieldsSet.userErrors.length > 0) {
      res.status(502).json({ error: `Shopify rejected the update: ${result.metafieldsSet.userErrors.map(e => e.message).join("; ")}` });
      return;
    }

    res.json({
      pushed: [...products.values()],
      metafield: "custom.ingredient_deck",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[recipes] push-ingredient-deck error:", msg);
    res.status(502).json({ error: msg });
  }
});

// BRC-style finished-product specification sheet (PDF), for trade buyers.
// Reuses the ingredient-deck and nutritionals endpoints over loopback (same
// pattern as the production-plan lock-pdf) so the allergen/QUID/nutrition
// content always matches what the app computes, and pulls the buyer-facing
// detail from product_specifications + company_profile.
router.get("/:id/spec-sheet.pdf", requireAdmin, async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const recipeId = parsed.data.id;

  try {
    const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
    if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

    const [specRow] = await db.select().from(productSpecificationsTable).where(eq(productSpecificationsTable.recipeId, recipeId));
    const [company] = await db.select().from(companyProfileTable).where(eq(companyProfileTable.id, 1));

    // Best-effort barcode: match a Shopify SKU row by product title.
    const [barcodeRow] = await db
      .select({ barcode: skuBarcodesTable.barcode })
      .from(skuBarcodesTable)
      .where(sql`lower(${skuBarcodesTable.productTitle}) = lower(${recipe.name.trim()})`)
      .limit(1);

    // Cook CCPs: any ingredient used by this recipe (directly, via a
    // sub-recipe, or as a marinaded raw meat) that carries a minimum cooking
    // temperature.
    const ccpRows = await db.execute<{ name: string; min_cooking_temp_c: string | null }>(sql`
      WITH RECURSIVE subs AS (
        SELECT sub_recipe_id FROM recipe_sub_recipes WHERE recipe_id = ${recipeId}
        UNION
        SELECT srs.component_sub_recipe_id FROM sub_recipe_sub_recipes srs JOIN subs s ON srs.sub_recipe_id = s.sub_recipe_id
      ),
      used AS (
        SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = ${recipeId}
        UNION SELECT raw_meat_ingredient_id FROM recipe_meat_marinades WHERE recipe_id = ${recipeId}
        UNION SELECT sri.ingredient_id FROM sub_recipe_ingredients sri JOIN subs s ON sri.sub_recipe_id = s.sub_recipe_id
      )
      SELECT DISTINCT i.name, i.min_cooking_temp_c
      FROM used u JOIN ingredients i ON i.id = u.ingredient_id
      WHERE i.min_cooking_temp_c IS NOT NULL
      ORDER BY i.name
    `);
    const cookCcps = (ccpRows.rows ?? ccpRows as unknown as Array<{ name: string; min_cooking_temp_c: string | null }>).map(r => ({
      ingredientName: r.name,
      minCookingTempC: r.min_cooking_temp_c != null ? Number(r.min_cooking_temp_c) : null,
    }));

    // Loopback the two derived-data endpoints, forwarding the session cookie.
    const port = process.env["PORT"];
    const cookie = req.headers.cookie ?? "";
    const fetchJson = async <T>(path: string): Promise<T | null> => {
      if (!port) return null;
      try {
        const resp = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { cookie } });
        if (!resp.ok) return null;
        return (await resp.json()) as T;
      } catch { return null; }
    };

    const [deckResp, nutriResp] = await Promise.all([
      fetchJson<{ ingredients: Array<{ declaration: string; percentage: number }>; deckText: string; allergens: string[]; mayContainStatement: string | null; missingDeclarations: string[] }>(`/api/recipes/${recipeId}/ingredient-deck`),
      fetchJson<{ per100g: Record<string, number | null>; perPortion: Record<string, number | null>; portionWeightG: number; declaredPackWeightG: number; packSize: number; completeness: { missingNutritionals: string[] } }>(`/api/recipes/${recipeId}/nutritionals`),
    ]);

    const missing: string[] = [];
    if (!specRow) missing.push("product spec not yet entered");
    if (!company?.legalBusinessName) missing.push("company details");
    if (deckResp?.missingDeclarations?.length) missing.push(`${deckResp.missingDeclarations.length} ingredient declaration(s)`);
    if (nutriResp?.completeness?.missingNutritionals?.length) missing.push(`${nutriResp.completeness.missingNutritionals.length} ingredient nutritionals`);
    if (!specRow?.storageInstructions) missing.push("storage instructions");
    if (!specRow?.usageInstructions) missing.push("cooking instructions");
    if (!specRow?.microCriteria || (specRow.microCriteria as unknown[]).length === 0) missing.push("micro results");
    // Net weight can only be stated once the recipe carries fill/base weights;
    // without them the nutritionals endpoint's portion weight is not a real
    // finished-product weight and must not reach a buyer's spec.
    if (recipe.fillWeightGrams == null || recipe.baseWeightGrams == null) missing.push("declared net weight (recipe fill/base weights unset)");
    if (!specRow?.packagingSpec) missing.push("packaging spec");
    if (!specRow?.organolepticStandards) missing.push("organoleptic standards");

    const { renderProductSpecPdf } = await import("../pdf/product-spec-pdf.js");
    const pdf = await renderProductSpecPdf({
      recipe: {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        category: recipe.category,
        dietaryCategory: recipe.dietaryCategory,
        shelfLifeDays: recipe.shelfLifeDays,
      },
      spec: specRow ? {
        legalName: specRow.legalName,
        productDescription: specRow.productDescription,
        intendedUse: specRow.intendedUse,
        storageInstructions: specRow.storageInstructions,
        usageInstructions: specRow.usageInstructions,
        mayContainOverride: specRow.mayContainOverride,
        packagingSpec: specRow.packagingSpec ?? null,
        organolepticStandards: specRow.organolepticStandards ?? null,
        microCriteria: (specRow.microCriteria as ProductSpecMicro[] | null) ?? null,
        dietarySuitability: specRow.dietarySuitability,
        specVersion: specRow.specVersion,
        specStatus: specRow.specStatus,
        preparedBy: specRow.preparedBy,
        approvedBy: specRow.approvedBy,
        approvedAt: specRow.approvedAt ? specRow.approvedAt.toISOString() : null,
      } : null,
      company: company ? {
        legalBusinessName: company.legalBusinessName,
        tradingName: company.tradingName,
        siteAddress: company.siteAddress,
        fboRegistrationNumber: company.fboRegistrationNumber,
        localAuthority: company.localAuthority,
        certificationStatus: company.certificationStatus,
        technicalContactName: company.technicalContactName,
        technicalContactEmail: company.technicalContactEmail,
        technicalContactPhone: company.technicalContactPhone,
        emergencyContact: company.emergencyContact,
      } : null,
      deck: deckResp ? {
        entries: deckResp.ingredients ?? [],
        deckText: deckResp.deckText ?? "",
        allergens: deckResp.allergens ?? [],
        mayContainStatement: deckResp.mayContainStatement ?? null,
      } : null,
      nutrition: nutriResp ? {
        per100g: nutriResp.per100g,
        perPortion: nutriResp.perPortion,
        portionWeightG: nutriResp.portionWeightG,
        declaredPackWeightG: nutriResp.declaredPackWeightG,
        packSize: nutriResp.packSize,
        complete: (nutriResp.completeness?.missingNutritionals?.length ?? 0) === 0,
        missingCount: nutriResp.completeness?.missingNutritionals?.length ?? 0,
      } : null,
      barcode: barcodeRow?.barcode ?? null,
      cookCcps,
      missing,
      generatedAt: new Date().toISOString(),
    });

    const safeName = recipe.name.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="tck-spec-${safeName}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("spec-sheet render error:", err);
    res.status(500).json({ error: "Failed to render specification sheet" });
  }
});

router.post("/:id/create-kanban", async (req, res) => {
  const id = Number(req.params.id);
  const [recipe] = await db.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable).where(eq(recipesTable.id, id));
  if (!recipe) { res.status(404).json({ error: "Recipe not found" }); return; }

  const [existing] = await db.select({ id: kanbanItemsTable.id })
    .from(kanbanItemsTable)
    .where(and(eq(kanbanItemsTable.sourceType, "recipe"), eq(kanbanItemsTable.recipeId, id)));
  if (existing) {
    res.status(409).json({ error: "A kanban already exists for this recipe" });
    return;
  }

  try {
    const qrUrl = await generateQrCode("recipe", id);
    const [kanban] = await db.insert(kanbanItemsTable).values({
      sourceType: "recipe",
      recipeId: id,
      qrCodeUrl: qrUrl,
      status: "active",
    }).returning();
    res.status(201).json({ kanbanId: kanban.id, qrCodeUrl: qrUrl, recipeName: recipe.name });
  } catch (err) {
    console.error(`Failed to create kanban for recipe ${id}:`, err);
    res.status(500).json({ error: "Failed to create kanban" });
  }
});

const AssemblyOrderBody = z.object({
  items: z.array(z.object({
    sourceType: z.enum(["ingredient", "sub_recipe"]),
    sourceId: z.number().int().positive(),
    order: z.number().int().min(0),
  })),
  fillingOrder: z.number().int().min(0).nullable().optional(),
});

// Also accept the legacy flat-array format for backwards compat
const LegacyAssemblyOrderBody = z.array(z.object({
  sourceType: z.enum(["ingredient", "sub_recipe"]),
  sourceId: z.number().int().positive(),
  order: z.number().int().min(0),
}));

// Builders on the floor reorder assembly items live — whoever finishes last
// wins as the recipe's master order. Any authenticated user can save; the
// global auth guard in routes/index.ts already keeps this behind a login.
router.put("/:id/assembly-order", async (req, res) => {
  try {
    const recipeId = Number(req.params.id);
    if (isNaN(recipeId)) {
      res.status(400).json({ error: "Invalid recipe id" });
      return;
    }

    let items: { sourceType: "ingredient" | "sub_recipe"; sourceId: number; order: number }[];
    let fillingOrder: number | null | undefined;

    const newParsed = AssemblyOrderBody.safeParse(req.body);
    if (newParsed.success) {
      items = newParsed.data.items;
      fillingOrder = newParsed.data.fillingOrder;
    } else {
      const legacyParsed = LegacyAssemblyOrderBody.safeParse(req.body);
      if (!legacyParsed.success) {
        res.status(400).json({ error: "Invalid body", details: newParsed.error.format() });
        return;
      }
      items = legacyParsed.data;
    }

    for (const item of items) {
      if (item.sourceType === "ingredient") {
        await db.update(recipeIngredientsTable)
          .set({ assemblyOrder: item.order })
          .where(and(
            eq(recipeIngredientsTable.recipeId, recipeId),
            eq(recipeIngredientsTable.ingredientId, item.sourceId)
          ));
      } else {
        await db.update(recipeSubRecipesTable)
          .set({ assemblyOrder: item.order })
          .where(and(
            eq(recipeSubRecipesTable.recipeId, recipeId),
            eq(recipeSubRecipesTable.subRecipeId, item.sourceId)
          ));
      }
    }

    if (fillingOrder !== undefined) {
      await db.update(recipesTable)
        .set({ fillingAssemblyOrder: fillingOrder })
        .where(eq(recipesTable.id, recipeId));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("assembly-order error:", err);
    res.status(500).json({ error: "Failed to save assembly order" });
  }
});

export default router;
