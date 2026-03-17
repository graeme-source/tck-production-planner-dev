import { Router, type IRouter } from "express";
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  const rows = await db.select().from(recipesTable).orderBy(recipesTable.name);
  res.json(rows.map(r => ({ ...r, servings: Number(r.servings), createdAt: r.createdAt.toISOString() })));
});

router.post("/", async (req, res) => {
  const { name, description, servings, servingUnit, category, notes, ingredients, subRecipes } = req.body;
  const [recipe] = await db.insert(recipesTable).values({ name, description, servings: String(servings), servingUnit, category, notes }).returning();
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
  res.status(201).json({ ...recipe, servings: Number(recipe.servings), createdAt: recipe.createdAt.toISOString() });
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

  res.json({
    ...row,
    servings: Number(row.servings),
    createdAt: row.createdAt.toISOString(),
    ingredients: ingredients.map(i => ({ ...i, quantity: Number(i.quantity) })),
    subRecipes: subs.map(s => ({ ...s, quantity: Number(s.quantity) })),
  });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, servings, servingUnit, category, notes, ingredients, subRecipes } = req.body;
  const [updated] = await db.update(recipesTable).set({ name, description, servings: String(servings), servingUnit, category, notes }).where(eq(recipesTable.id, id)).returning();
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
  res.json({ ...updated, servings: Number(updated.servings), createdAt: updated.createdAt.toISOString() });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(recipesTable).where(eq(recipesTable.id, id));
  res.status(204).send();
});

export default router;
