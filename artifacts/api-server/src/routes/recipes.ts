import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, recipeMeatMarinadesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, appSettingsTable, kanbanItemsTable, productionPlansTable, productionPlanItemsTable } from "@workspace/db";
import { eq, inArray, ne, and, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CreateRecipeBody, UpdateRecipeBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { computeSubRecipeCosts } from "../lib/sub-recipe-costs";
import { generateQrCode } from "../lib/qr-code";
import * as z from "zod";

const RecipeIdParams = z.object({ id: z.coerce.number().int().positive() });
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
    color: r.color ?? null,
    cookingLossPercent: r.cookingLossPercent != null ? Number(r.cookingLossPercent) : 3,
    createdAt: r.createdAt.toISOString(),
  };
}

async function computeCosts(recipeIds: number[]) {
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

router.post("/", validate(CreateRecipeBody), async (req, res) => {
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, isCoreMenu, isCurrentSpecial, color, cookingLossPercent, ingredients, subRecipes, marinades } = req.body;

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
  };

  const [recipe] = await db.transaction(async (tx) => {
    if (isCurrentSpecial === true) {
      await tx.update(recipesTable).set({ isCurrentSpecial: false });
    }
    return tx.insert(recipesTable).values(insertValues).returning();
  });

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null; includeInFillingMix?: boolean; quid?: boolean }) => ({
        recipeId: recipe.id, ingredientId: i.ingredientId, quantity: String(i.quantity),
        marinadeForIngredientId: i.marinadeForIngredientId ?? null,
        includeInFillingMix: i.includeInFillingMix ?? false,
        quid: i.quid ?? false,
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null; includeInFillingMix?: boolean; quid?: boolean }) => ({
        recipeId: recipe.id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
        marinadeForIngredientId: s.marinadeForIngredientId ?? null,
        includeInFillingMix: s.includeInFillingMix ?? false,
        quid: s.quid ?? false,
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
      includeInFillingMix: recipeIngredientsTable.includeInFillingMix,
      quid: recipeIngredientsTable.quid,
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
      includeInFillingMix: recipeSubRecipesTable.includeInFillingMix,
      quid: recipeSubRecipesTable.quid,
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
      includeInFillingMix: i.includeInFillingMix,
      quid: i.quid ?? false,
    };
  });

  const enrichedSubRecipes = subRows.map(s => {
    const qty = Number(s.quantity);
    const subYield = Number(s.subYield);
    const subCostPerUnitVal = subCostPerUnit[s.subRecipeId!] ?? 0;
    const subBatchCost = subYield > 0 ? subCostPerUnitVal * subYield : 0;
    const lineCostBatch = qty * subCostPerUnitVal;
    const lineCostPortion = servings > 0 ? lineCostBatch / servings : 0;

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
      marinadeForIngredientId: s.marinadeForIngredientId ?? null,
      includeInFillingMix: s.includeInFillingMix,
      quid: s.quid ?? false,
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
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, isCoreMenu, isCurrentSpecial, color, cookingLossPercent, ingredients, subRecipes, marinades } = req.body;

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
    ...(isCurrentSpecial !== undefined ? { isCurrentSpecial } : {}),
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
    return [row];
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
  await db.delete(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, id));

  if (marinades !== undefined) {
    await db.delete(recipeMeatMarinadesTable).where(eq(recipeMeatMarinadesTable.recipeId, id));
  }

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null; includeInFillingMix?: boolean; quid?: boolean }) => ({
        recipeId: id, ingredientId: i.ingredientId, quantity: String(i.quantity),
        marinadeForIngredientId: i.marinadeForIngredientId ?? null,
        includeInFillingMix: i.includeInFillingMix ?? false,
        quid: i.quid ?? false,
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null; includeInFillingMix?: boolean; quid?: boolean }) => ({
        recipeId: id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
        marinadeForIngredientId: s.marinadeForIngredientId ?? null,
        includeInFillingMix: s.includeInFillingMix ?? false,
        quid: s.quid ?? false,
      }))
    );
  }
  if (marinades?.length) {
    await db.insert(recipeMeatMarinadesTable).values(
      marinades.map((m) => ({
        recipeId: id,
        rawMeatIngredientId: m.rawMeatIngredientId,
        marinadeIngredientId: m.marinadeIngredientId ?? null,
        marinadeSubRecipeId: m.marinadeSubRecipeId ?? null,
        gramsPerKg: String(m.gramsPerKg),
      }))
    );
  }

  const today = new Date().toISOString().slice(0, 10);
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

router.get("/:id/shopify-mapping", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const recipeId = parsed.data.id;
  try {
    const rows = await db.execute(sql`
      SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}
    `);
    if (rows.rows.length === 0) { res.json(null); return; }
    res.json(rows.rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

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
      ON CONFLICT (recipe_id) DO UPDATE SET
        shopify_variant_id    = EXCLUDED.shopify_variant_id,
        shopify_product_title = EXCLUDED.shopify_product_title,
        shopify_variant_title = EXCLUDED.shopify_variant_title,
        wonky_variant_id      = EXCLUDED.wonky_variant_id,
        wonky_product_title   = EXCLUDED.wonky_product_title,
        wonky_variant_title   = EXCLUDED.wonky_variant_title
    `);
    const saved = await db.execute(sql`SELECT * FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}`);
    res.json(saved.rows[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.delete("/:id/shopify-mapping", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }
  const recipeId = parsed.data.id;
  try {
    await db.execute(sql`DELETE FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId}`);
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

async function gatherRecipeIngredients(recipeId: number): Promise<{
  items: IngredientNutrientRow[];
  totalWeightG: number;
  cookingLossPercent: number;
  portionsPerBatch: number;
  missingNutritionals: string[];
  missingDeclarations: string[];
}> {
  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) throw new Error("Recipe not found");

  const cookingLossPercent = Number(recipe.cookingLossPercent) || 3;
  const portionsPerBatch = recipe.portionsPerBatch ?? 10;

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

  for (const sr of subRecipeLinks) {
    const srQuantityG = Number(sr.quantity);
    const [subRecipe] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, sr.subRecipeId));
    if (!subRecipe) continue;

    const srYield = Number(subRecipe.yield) || 1;

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
      .where(eq(subRecipeIngredientsTable.subRecipeId, sr.subRecipeId));

    const scaleFactor = srQuantityG / srYield;

    for (const si of srIngs) {
      const existingIdx = items.findIndex(it => it.ingredientId === si.ingredientId);
      const scaledQty = Number(si.quantity) * scaleFactor;

      if (existingIdx >= 0) {
        items[existingIdx].quantityG += scaledQty;
      } else {
        items.push({
          ingredientId: si.ingredientId,
          name: si.name,
          quantityG: scaledQty,
          labelDeclaration: si.labelDeclaration,
          allergens: (si.allergens as string[] | null) ?? [],
          nutrients: {
            energyKj: si.energyKj != null ? Number(si.energyKj) : null,
            energyKcal: si.energyKcal != null ? Number(si.energyKcal) : null,
            fat: si.fat != null ? Number(si.fat) : null,
            saturates: si.saturates != null ? Number(si.saturates) : null,
            carbohydrate: si.carbohydrate != null ? Number(si.carbohydrate) : null,
            sugars: si.sugars != null ? Number(si.sugars) : null,
            fibre: si.fibre != null ? Number(si.fibre) : null,
            protein: si.protein != null ? Number(si.protein) : null,
            salt: si.salt != null ? Number(si.salt) : null,
          },
        });
      }
    }
  }

  const totalWeightG = items.reduce((sum, i) => sum + i.quantityG, 0);

  const missingNutritionals = items
    .filter(i => NUTRIENT_KEYS.every(k => i.nutrients[k] === null))
    .map(i => i.name);

  const missingDeclarations = items
    .filter(i => !i.labelDeclaration)
    .map(i => i.name);

  return { items, totalWeightG, cookingLossPercent, portionsPerBatch, missingNutritionals, missingDeclarations };
}

router.get("/:id/nutritionals", async (req, res) => {
  const parsed = RecipeIdParams.safeParse({ id: req.params.id });
  if (!parsed.success) { res.status(400).json({ error: "Invalid recipe id" }); return; }

  try {
    const { items, totalWeightG, cookingLossPercent, portionsPerBatch, missingNutritionals, missingDeclarations } =
      await gatherRecipeIngredients(parsed.data.id);

    const cookedWeightG = totalWeightG * (1 - cookingLossPercent / 100);
    const portionWeightG = Math.round(cookedWeightG / portionsPerBatch);

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
      portionWeightG,
      per100g,
      perPortion,
      completeness: {
        totalIngredients: items.length,
        missingNutritionals,
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

const ALLERGEN_DISPLAY: Record<string, string> = {
  celery: "Celery",
  cereals_containing_gluten: "Cereals containing Gluten",
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

    const directItems: Array<{
      ingredientId: number;
      name: string;
      quantityG: number;
      labelDeclaration: string | null;
      allergens: string[];
      isQuid: boolean;
    }> = directIngs.map(i => ({
      ingredientId: i.ingredientId,
      name: i.name,
      quantityG: toGrams(Number(i.quantity), i.unit ?? "g"),
      labelDeclaration: i.labelDeclaration,
      allergens: (i.allergens as string[] | null) ?? [],
      isQuid: i.quid ?? false,
    }));

    interface SubRecipeGroup {
      subRecipeId: number;
      name: string;
      labelDeclaration: string | null;
      totalQuantityG: number;
      isQuid: boolean;
      ingredients: Array<{
        ingredientId: number;
        name: string;
        quantityG: number;
        labelDeclaration: string | null;
        allergens: string[];
      }>;
    }

    const subRecipeGroups: SubRecipeGroup[] = [];

    for (const sr of subRecipeLinks) {
      const [subRecipe] = await db.select().from(subRecipesTable).where(eq(subRecipesTable.id, sr.subRecipeId));
      if (!subRecipe) continue;

      const srUsedG = toGrams(Number(sr.quantity), subRecipe.yieldUnit ?? "g");

      const srIngs = await db
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
        .where(eq(subRecipeIngredientsTable.subRecipeId, sr.subRecipeId));

      const srIngNormalized = srIngs.map(si => ({
        ingredientId: si.ingredientId,
        name: si.name,
        quantityG: toGrams(Number(si.quantity), si.unit ?? "g"),
        labelDeclaration: si.labelDeclaration,
        allergens: (si.allergens as string[] | null) ?? [],
      }));

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
      isComplete: missingDeclarations.length === 0,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "Recipe not found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
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

export default router;
