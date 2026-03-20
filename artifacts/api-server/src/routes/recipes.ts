import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, recipeMeatMarinadesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { CreateRecipeBody, UpdateRecipeBody } from "@workspace/api-zod";
import { validate } from "../middleware/validate";
import { computeSubRecipeCosts } from "../lib/sub-recipe-costs";

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
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, ingredients, subRecipes, marinades } = req.body;

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

  const [recipe] = await db.insert(recipesTable).values({
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
  }).returning();

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null }) => ({
        recipeId: recipe.id, ingredientId: i.ingredientId, quantity: String(i.quantity),
        marinadeForIngredientId: i.marinadeForIngredientId ?? null,
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null }) => ({
        recipeId: recipe.id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
        marinadeForIngredientId: s.marinadeForIngredientId ?? null,
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
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, portionsPerBatch, shelfLifeDays, tinSize, maxBatchesPerTin, sopUrl, fillWeightGrams, baseType, baseWeightGrams, ingredients, subRecipes, marinades } = req.body;

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

  const [updated] = await db.update(recipesTable)
    .set({
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
    })
    .where(eq(recipesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
  await db.delete(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, id));

  const hasInlineMarinades = (ingredients ?? []).some((i: any) => i.marinadeForIngredientId) ||
    (subRecipes ?? []).some((s: any) => s.marinadeForIngredientId);
  if (marinades !== undefined || hasInlineMarinades) {
    await db.delete(recipeMeatMarinadesTable).where(eq(recipeMeatMarinadesTable.recipeId, id));
  }

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number; marinadeForIngredientId?: number | null }) => ({
        recipeId: id, ingredientId: i.ingredientId, quantity: String(i.quantity),
        marinadeForIngredientId: i.marinadeForIngredientId ?? null,
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number; marinadeForIngredientId?: number | null }) => ({
        recipeId: id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
        marinadeForIngredientId: s.marinadeForIngredientId ?? null,
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

  const mapped = mapRecipe(updated);
  const rawCosts = await computeCosts([id]);
  res.json(enrichWithCosts(mapped, rawCosts[id] ?? 0));
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(recipesTable).where(eq(recipesTable.id, id));
  res.status(204).send();
});

export default router;
