/**
 * Ingredient station warnings (Fix queue #404, Dave Bewsey; Graeme approved
 * 20 Nov 2026). Objective D.
 *
 *   GET /api/ingredient-station-warnings
 *       → { byRecipe: { [recipeId]: [{ ingredientId, ingredientName, warning }] },
 *           byIngredient: { [ingredientId]: warning } }
 *         Anyone signed in. The Mixing and Building screens read byRecipe to
 *         pop the warning up when a recipe is opened; the ingredient form
 *         reads byIngredient.
 *   PUT /api/ingredient-station-warnings/:id  { warning: string | null }
 *       → managers/admins; autosave from the ingredient form. Blank = none.
 *
 * Which recipes carry a warning is worked out in
 * lib/ingredient-station-warnings.ts. Dedicated endpoint because
 * PUT /api/ingredients/:id rewrites the whole row.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { eq, isNotNull } from "drizzle-orm";
import {
  db, ingredientsTable, recipeIngredientsTable, recipeSubRecipesTable, recipeMeatMarinadesTable,
  subRecipeIngredientsTable, subRecipeSubRecipesTable,
} from "@workspace/db";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { STATION_WARNING_MAX, cleanStationWarning, warningsByRecipe } from "../lib/ingredient-station-warnings";

const router: IRouter = Router();

const PutBody = z.object({ warning: z.string().max(STATION_WARNING_MAX).nullable() });

router.get("/", async (_req, res) => {
  try {
    const ingredients = await db
      .select({ id: ingredientsTable.id, name: ingredientsTable.name, stationWarning: ingredientsTable.stationWarning })
      .from(ingredientsTable)
      .where(isNotNull(ingredientsTable.stationWarning));
    const byIngredient: Record<string, string> = {};
    for (const i of ingredients) {
      const w = cleanStationWarning(i.stationWarning);
      if (w) byIngredient[String(i.id)] = w;
    }
    // Nearly always: no warnings at all, or one. Skip the recipe reads then.
    if (Object.keys(byIngredient).length === 0) { res.json({ byRecipe: {}, byIngredient }); return; }
    const [recipeIngredients, recipeSubRecipes, recipeMeatMarinades, subRecipeIngredients, subRecipeSubRecipes] = await Promise.all([
      db.select({ recipeId: recipeIngredientsTable.recipeId, ingredientId: recipeIngredientsTable.ingredientId }).from(recipeIngredientsTable),
      db.select({ recipeId: recipeSubRecipesTable.recipeId, subRecipeId: recipeSubRecipesTable.subRecipeId }).from(recipeSubRecipesTable),
      db.select({
        recipeId: recipeMeatMarinadesTable.recipeId, rawMeatIngredientId: recipeMeatMarinadesTable.rawMeatIngredientId,
        marinadeIngredientId: recipeMeatMarinadesTable.marinadeIngredientId, marinadeSubRecipeId: recipeMeatMarinadesTable.marinadeSubRecipeId,
      }).from(recipeMeatMarinadesTable),
      db.select({ subRecipeId: subRecipeIngredientsTable.subRecipeId, ingredientId: subRecipeIngredientsTable.ingredientId }).from(subRecipeIngredientsTable),
      db.select({ subRecipeId: subRecipeSubRecipesTable.subRecipeId, componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId }).from(subRecipeSubRecipesTable),
    ]);
    res.json({
      byRecipe: warningsByRecipe({ ingredients, recipeIngredients, recipeSubRecipes, recipeMeatMarinades, subRecipeIngredients, subRecipeSubRecipes }),
      byIngredient,
    });
  } catch (err) {
    console.error("[IngredientStationWarnings] load failed:", err);
    res.status(500).json({ error: "Couldn't load the ingredient warnings" });
  }
});

router.put("/:id", requireManagerOrAdmin, validate(PutBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  const { warning } = req.body as z.infer<typeof PutBody>;
  try {
    const [saved] = await db.update(ingredientsTable)
      .set({ stationWarning: cleanStationWarning(warning) })
      .where(eq(ingredientsTable.id, id))
      .returning({ id: ingredientsTable.id, stationWarning: ingredientsTable.stationWarning });
    if (!saved) { res.status(404).json({ error: "Ingredient not found" }); return; }
    res.json({ id: saved.id, warning: saved.stationWarning });
  } catch (err) {
    console.error("[IngredientStationWarnings] save failed:", err);
    res.status(500).json({ error: "Couldn't save the warning" });
  }
});

export default router;
