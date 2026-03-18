import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

function mapRecipe(r: typeof recipesTable.$inferSelect) {
  return {
    ...r,
    servings: Number(r.servings),
    packSize: Number(r.packSize),
    rrp: Number(r.rrp),
    packagingCost: Number(r.packagingCost),
    labourCost: Number(r.labourCost),
    createdAt: r.createdAt.toISOString(),
  };
}

async function computeCosts(recipeIds: number[]) {
  if (recipeIds.length === 0) return {};

  // 1. Get all recipe ingredients with pack cost data
  const recipeIngredients = await db
    .select({
      recipeId: recipeIngredientsTable.recipeId,
      quantity: recipeIngredientsTable.quantity,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(inArray(recipeIngredientsTable.recipeId, recipeIds));

  // 2. Get all recipe sub-recipes
  const recipeSubRecipes = await db
    .select({
      recipeId: recipeSubRecipesTable.recipeId,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
      subRecipeYield: subRecipesTable.yield,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(inArray(recipeSubRecipesTable.recipeId, recipeIds));

  // 3. Get costs for all sub-recipes used across these recipes
  const usedSubRecipeIds = [...new Set(recipeSubRecipes.map(s => s.subRecipeId).filter((id): id is number => id !== null))];
  let subRecipeCostPerUnit: Record<number, number> = {};
  if (usedSubRecipeIds.length > 0) {
    const subIngredients = await db
      .select({
        subRecipeId: subRecipeIngredientsTable.subRecipeId,
        quantity: subRecipeIngredientsTable.quantity,
        packWeight: ingredientsTable.packWeight,
        costPerPack: ingredientsTable.costPerPack,
      })
      .from(subRecipeIngredientsTable)
      .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
      .where(inArray(subRecipeIngredientsTable.subRecipeId, usedSubRecipeIds));

    // Group sub-recipe ingredient costs by subRecipeId
    const subCostBySubRecipeId: Record<number, number> = {};
    for (const si of subIngredients) {
      if (!si.subRecipeId) continue;
      const q = Number(si.quantity);
      const pw = Number(si.packWeight);
      const cpp = Number(si.costPerPack);
      const costPerUnit = pw > 0 ? cpp / pw : 0;
      subCostBySubRecipeId[si.subRecipeId] = (subCostBySubRecipeId[si.subRecipeId] ?? 0) + q * costPerUnit;
    }

    // Now pair with yields from recipeSubRecipes
    const yieldBySubId: Record<number, number> = {};
    for (const rs of recipeSubRecipes) {
      if (rs.subRecipeId && rs.subRecipeYield) {
        yieldBySubId[rs.subRecipeId] = Number(rs.subRecipeYield);
      }
    }

    for (const subId of usedSubRecipeIds) {
      const totalCost = subCostBySubRecipeId[subId] ?? 0;
      const y = yieldBySubId[subId] ?? 1;
      subRecipeCostPerUnit[subId] = y > 0 ? totalCost / y : 0;
    }
  }

  // 4. Sum raw material costs per recipe
  const rawCostByRecipeId: Record<number, number> = {};

  for (const ri of recipeIngredients) {
    const q = Number(ri.quantity);
    const pw = Number(ri.packWeight);
    const cpp = Number(ri.costPerPack);
    const costPerUnit = pw > 0 ? cpp / pw : 0;
    rawCostByRecipeId[ri.recipeId] = (rawCostByRecipeId[ri.recipeId] ?? 0) + q * costPerUnit;
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

router.post("/", async (req, res) => {
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, ingredients, subRecipes } = req.body;
  const [recipe] = await db.insert(recipesTable).values({
    name, description,
    servings: String(servings),
    servingUnit, category, notes,
    packSize: String(packSize ?? 1),
    rrp: String(rrp ?? 0),
    packagingCost: String(packagingCost ?? 0),
    labourCost: String(labourCost ?? 0),
  }).returning();

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number }) => ({
        recipeId: recipe.id, ingredientId: i.ingredientId, quantity: String(i.quantity),
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number }) => ({
        recipeId: recipe.id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
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

  const ingredients = await db
    .select({
      id: recipeIngredientsTable.id,
      ingredientId: recipeIngredientsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      unit: ingredientsTable.unit,
      quantity: recipeIngredientsTable.quantity,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
    })
    .from(recipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, id));

  const subs = await db
    .select({
      id: recipeSubRecipesTable.id,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      subRecipeName: subRecipesTable.name,
      quantity: recipeSubRecipesTable.quantity,
      unit: subRecipesTable.yieldUnit,
    })
    .from(recipeSubRecipesTable)
    .leftJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, id));

  const mapped = mapRecipe(row);
  const rawCosts = await computeCosts([id]);
  const enriched = enrichWithCosts(mapped, rawCosts[id] ?? 0);

  res.json({
    ...enriched,
    ingredients: ingredients.map(i => ({
      ...i,
      quantity: Number(i.quantity),
      packWeight: Number(i.packWeight),
      costPerPack: Number(i.costPerPack),
    })),
    subRecipes: subs.map(s => ({ ...s, quantity: Number(s.quantity) })),
  });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, servings, servingUnit, category, notes, packSize, rrp, packagingCost, labourCost, ingredients, subRecipes } = req.body;
  const [updated] = await db.update(recipesTable)
    .set({
      name, description,
      servings: String(servings),
      servingUnit, category, notes,
      packSize: String(packSize ?? 1),
      rrp: String(rrp ?? 0),
      packagingCost: String(packagingCost ?? 0),
      labourCost: String(labourCost ?? 0),
    })
    .where(eq(recipesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, id));
  await db.delete(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, id));

  if (ingredients?.length) {
    await db.insert(recipeIngredientsTable).values(
      ingredients.map((i: { ingredientId: number; quantity: number }) => ({
        recipeId: id, ingredientId: i.ingredientId, quantity: String(i.quantity),
      }))
    );
  }
  if (subRecipes?.length) {
    await db.insert(recipeSubRecipesTable).values(
      subRecipes.map((s: { subRecipeId: number; quantity: number }) => ({
        recipeId: id, subRecipeId: s.subRecipeId, quantity: String(s.quantity),
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
