/**
 * A recipe's ingredient deck — the ingredients declaration as printed on the
 * label, allergens in **bold**, plus the completeness checks (missing or
 * unwrapped declarations, allergen tick mismatches) and the may-contain
 * statement. Moved out of routes/recipes.ts unchanged so the product-label
 * system can build the deck directly instead of calling its own API over
 * loopback; GET /api/recipes/:id/ingredient-deck returns exactly this.
 * The assembly rules (compound threshold, ordering, QUID) are
 * lib/ingredient-deck.ts with their tests.
 */
import { db, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ALLERGEN_DISPLAY, allergenMismatch } from "@workspace/allergens";
import { toGrams } from "@workspace/units";
import { buildDeck } from "./ingredient-deck";

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

export type RecipeIngredientDeck = Awaited<ReturnType<typeof buildRecipeIngredientDeck>>;

/** The deck for a recipe that exists (the caller checks). */
export async function buildRecipeIngredientDeck(recipeId: number) {

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

  // Unit conversion lives in @workspace/units (shared with the nutritionals
  // gatherer) so the deck and the nutrition panel can never disagree.

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

  // Assembly rules (compound threshold, combining entries that print the
  // same, ordering, QUID) live in lib/ingredient-deck.ts with their tests.
  const { entries: sortedEntries, deckText } = buildDeck(directItems, subRecipeGroups);

  const allAllergens = [...new Set([
    ...directItems.flatMap(i => i.allergens),
    ...subRecipeGroups.flatMap(g => g.ingredients.flatMap(i => i.allergens)),
  ])].sort();
  const allergenDisplayList = allAllergens.map(a => ALLERGEN_DISPLAY[a] || a);

  // Declaration-vs-ticks mismatches: allergen words found in an ingredient's
  // declaration text that aren't ticked on the ingredient record. The
  // bolding above already emphasises them on the deck (text-driven), but the
  // recipe allergen list is tick-driven — so an unticked allergen would be
  // missing from "Allergens Present" until the record is fixed.
  const mismatchById = new Map<number, { ingredientId: number; name: string; missing: string[] }>();
  const checkMismatch = (ingredientId: number, name: string, declaration: string | null, ticked: string[]) => {
    if (mismatchById.has(ingredientId)) return;
    const missing = allergenMismatch(declaration || name, ticked);
    if (missing.length > 0) {
      mismatchById.set(ingredientId, { ingredientId, name, missing: missing.map(c => ALLERGEN_DISPLAY[c] || c) });
    }
  };
  for (const i of directItems) checkMismatch(i.ingredientId, i.name, i.labelDeclaration, i.allergens);
  for (const g of subRecipeGroups) for (const si of g.ingredients) checkMismatch(si.ingredientId, si.name, si.labelDeclaration, si.allergens);
  const allergenMismatches = [...mismatchById.values()];

  const missingDeclarations = [
    ...directItems.filter(i => !i.labelDeclaration).map(i => i.name),
    ...subRecipeGroups.flatMap(g => g.ingredients.filter(i => !i.labelDeclaration).map(i => i.name)),
  ];
  // Ids alongside the names so the client can link each one straight to
  // the ingredient's edit dialog.
  const missingDeclarationDetail = [
    ...directItems.filter(i => !i.labelDeclaration),
    ...subRecipeGroups.flatMap(g => g.ingredients.filter(i => !i.labelDeclaration)),
  ]
    .filter(i => i.ingredientId != null)
    .map(i => ({ ingredientId: i.ingredientId, name: i.name }));

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

  return {
    ingredients: sortedEntries,
    deckText,
    allergens: allergenDisplayList,
    allergenMismatches,
    mayContainStatement,
    missingDeclarations: [...new Set(missingDeclarations)],
    missingDeclarationDetail: [...new Map(missingDeclarationDetail.map(d => [d.ingredientId, d])).values()],
    unwrappedDeclarations: [...new Set(unwrappedDeclarations)],
    isComplete: missingDeclarations.length === 0 && unwrappedDeclarations.length === 0,
  };
}
