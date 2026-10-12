/**
 * GET /api/sub-recipes/:id/label-usage — how this sub-recipe shows on the
 * label of every product that uses it (2026-10-12). Whether a sub-recipe is
 * bracketed under its own name or broken into its ingredients depends on
 * its share of EACH product, so the answer is per recipe:
 *   "On Garlic Cheese (31%): Garlic Butter (Butter (MILK), Garlic, …)"
 *   "On Godfather (4%): its ingredients are listed individually"
 * The decision comes straight from the deck builder (lib/ingredient-deck.ts
 * buildDeck → subRecipeDecisions), so this page can never disagree with the
 * printed label. A sub-recipe used INSIDE another sub-recipe is always
 * merged into that parent's list — those parents are listed too.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, recipesTable, recipeSubRecipesTable, subRecipesTable, subRecipeSubRecipesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { buildRecipeIngredientDeck } from "../lib/recipe-ingredient-deck";
import { COMPOUND_THRESHOLD_PCT } from "../lib/ingredient-deck";

const router: IRouter = Router();
const IdParams = z.object({ id: z.coerce.number().int().positive() });

router.get("/:id/label-usage", async (req, res) => {
  const p = IdParams.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid sub-recipe id" }); return; }
  const id = p.data.id;
  try {
    const links = await db
      .select({ recipeId: recipeSubRecipesTable.recipeId })
      .from(recipeSubRecipesTable)
      .where(eq(recipeSubRecipesTable.subRecipeId, id));
    const recipeIds = [...new Set(links.map(l => l.recipeId))];
    const recipes = recipeIds.length
      ? await db
          .select({ id: recipesTable.id, name: recipesTable.name, isDraft: recipesTable.isDraft, archivedAt: recipesTable.archivedAt })
          .from(recipesTable)
          .where(inArray(recipesTable.id, recipeIds))
      : [];

    const usage = [];
    for (const r of recipes.filter(x => x.archivedAt == null).sort((a, b) => a.name.localeCompare(b.name))) {
      const deck = await buildRecipeIngredientDeck(r.id);
      const d = deck.subRecipeDecisions.find(x => x.subRecipeId === id);
      if (!d) continue;
      usage.push({
        recipeId: r.id, recipeName: r.name, isDraft: !!r.isDraft,
        percentage: d.percentage, asCompound: d.asCompound, reason: d.reason, printedAs: d.printedAs,
      });
    }

    const parents = await db
      .select({ id: subRecipesTable.id, name: subRecipesTable.name })
      .from(subRecipeSubRecipesTable)
      .innerJoin(subRecipesTable, eq(subRecipeSubRecipesTable.subRecipeId, subRecipesTable.id))
      .where(eq(subRecipeSubRecipesTable.componentSubRecipeId, id));

    res.json({
      thresholdPct: COMPOUND_THRESHOLD_PCT,
      usage,
      insideSubRecipes: [...new Map(parents.map(x => [x.id, x])).values()],
    });
  } catch (err) {
    console.error(`GET /sub-recipes/${id}/label-usage failed:`, err);
    res.status(500).json({ error: "Couldn't work out how this shows on labels" });
  }
});

export default router;
