import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";

interface MarinadeRef {
  recipeName: string;
  ingredientMarinades: Array<{
    ingredientName: string;
    marinatesIngredientName: string;
    quantity: number;
  }>;
  subRecipeMarinades: Array<{
    subRecipeName: string;
    marinatesIngredientName: string;
    quantity: number;
  }>;
}

// Marinade protection retired — it was silently overriding admin edits on
// every server restart, which caused the Carnizone chicken-seasoning link
// to keep reverting. Recipe ingredient links are now managed entirely
// through the recipe editor; if seed data is needed for a fresh DB, do
// it in a one-shot migration, not a recurring startup guard.
const PROTECTED_MARINADES: MarinadeRef[] = [];

export async function guardMarinadeSettings(): Promise<void> {
  for (const ref of PROTECTED_MARINADES) {
    const [recipe] = await db
      .select({ id: recipesTable.id })
      .from(recipesTable)
      .where(eq(recipesTable.name, ref.recipeName))
      .limit(1);
    if (!recipe) continue;

    for (const im of ref.ingredientMarinades) {
      const [ingredient] = await db
        .select({ id: ingredientsTable.id })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.name, im.ingredientName))
        .limit(1);
      const [marinatesIngredient] = await db
        .select({ id: ingredientsTable.id })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.name, im.marinatesIngredientName))
        .limit(1);
      if (!ingredient || !marinatesIngredient) continue;

      const [existing] = await db
        .select({ id: recipeIngredientsTable.id })
        .from(recipeIngredientsTable)
        .where(
          and(
            eq(recipeIngredientsTable.recipeId, recipe.id),
            eq(recipeIngredientsTable.ingredientId, ingredient.id),
          ),
        )
        .limit(1);

      if (existing) {
        const [row] = await db
          .select({ marinadeFor: recipeIngredientsTable.marinadeForIngredientId })
          .from(recipeIngredientsTable)
          .where(eq(recipeIngredientsTable.id, existing.id));
        if (row && row.marinadeFor !== marinatesIngredient.id) {
          await db
            .update(recipeIngredientsTable)
            .set({ marinadeForIngredientId: marinatesIngredient.id })
            .where(eq(recipeIngredientsTable.id, existing.id));
          console.log(
            `[seed-guard] Restored marinade link: ${ref.recipeName} → ${im.ingredientName} marinates ${im.marinatesIngredientName}`,
          );
        }
      }
    }

    for (const sm of ref.subRecipeMarinades) {
      const [subRecipe] = await db
        .select({ id: subRecipesTable.id })
        .from(subRecipesTable)
        .where(eq(subRecipesTable.name, sm.subRecipeName))
        .limit(1);
      const [marinatesIngredient] = await db
        .select({ id: ingredientsTable.id })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.name, sm.marinatesIngredientName))
        .limit(1);
      if (!subRecipe || !marinatesIngredient) continue;

      const [existing] = await db
        .select({ id: recipeSubRecipesTable.id })
        .from(recipeSubRecipesTable)
        .where(
          and(
            eq(recipeSubRecipesTable.recipeId, recipe.id),
            eq(recipeSubRecipesTable.subRecipeId, subRecipe.id),
          ),
        )
        .limit(1);

      if (existing) {
        const [row] = await db
          .select({ marinadeFor: recipeSubRecipesTable.marinadeForIngredientId })
          .from(recipeSubRecipesTable)
          .where(eq(recipeSubRecipesTable.id, existing.id));
        if (row && row.marinadeFor !== marinatesIngredient.id) {
          await db
            .update(recipeSubRecipesTable)
            .set({ marinadeForIngredientId: marinatesIngredient.id })
            .where(eq(recipeSubRecipesTable.id, existing.id));
          console.log(
            `[seed-guard] Restored marinade link: ${ref.recipeName} → ${sm.subRecipeName} marinates ${sm.marinatesIngredientName}`,
          );
        }
      }
    }
  }
}
