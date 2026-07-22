/**
 * UPF (ultra-processed food) rollups.
 *
 * Every ingredient carries a NOVA class (1-4, null = unclassified);
 * NOVA 4 = UPF. A recipe's / sub-recipe's UPF percentage is the weight
 * of its NOVA-4 ingredients over its total ingredient weight, resolved
 * recursively through nested sub-recipes — the same weight-in ==
 * weight-out convention as the ingredient-deck endpoint in
 * routes/recipes.ts (nested sub-recipe quantities are expressed in the
 * nested sub-recipe's yieldUnit and scaled by used ÷ component total).
 *
 * Everything is computed live from ingredient flags, so a re-classified
 * ingredient or edited recipe is immediately reflected — nothing is
 * cached in the recipes/sub_recipes tables.
 */
import {
  db,
  ingredientsTable,
  recipesTable,
  recipeIngredientsTable,
  recipeSubRecipesTable,
  subRecipesTable,
  subRecipeIngredientsTable,
  subRecipeSubRecipesTable,
} from "@workspace/db";

function toGrams(qty: number, unit: string): number {
  const u = unit.toLowerCase().trim();
  if (u === "kg") return qty * 1000;
  if (u === "l" || u === "litre" || u === "litres" || u === "liter" || u === "liters") return qty * 1000;
  if (u === "ml") return qty;
  return qty;
}

export interface UpfContributor {
  ingredientId: number;
  name: string;
  grams: number;
  novaMarkers: string[];
}

export interface UpfRollup {
  totalG: number;
  upfG: number;
  /** Weight of ingredients that have no NOVA class yet — an honesty
   *  indicator: the UPF % can only be trusted when this is ~0. */
  unclassifiedG: number;
  /** null when the item has no weighable ingredients. */
  upfPercent: number | null;
  /** Flattened NOVA-4 ingredients, heaviest first, duplicates merged. */
  upfIngredients: UpfContributor[];
  /** Names of ingredients still awaiting classification. */
  unclassifiedIngredients: string[];
}

export interface SubRecipeUpf extends UpfRollup {
  subRecipeId: number;
  name: string;
}

export interface RecipeUpf extends UpfRollup {
  recipeId: number;
  name: string;
  category: string | null;
}

export interface UpfSummary {
  recipes: RecipeUpf[];
  subRecipes: SubRecipeUpf[];
  /** Ingredients used in at least one recipe/sub-recipe with no NOVA class. */
  unclassifiedUsedIngredientIds: number[];
}

interface IngredientNova {
  id: number;
  name: string;
  unit: string;
  novaClass: number | null;
  novaMarkers: string[];
}

function emptyRollup(): UpfRollup {
  return { totalG: 0, upfG: 0, unclassifiedG: 0, upfPercent: null, upfIngredients: [], unclassifiedIngredients: [] };
}

function mergeContributor(list: Map<number, UpfContributor>, c: UpfContributor) {
  const existing = list.get(c.ingredientId);
  if (existing) existing.grams += c.grams;
  else list.set(c.ingredientId, { ...c });
}

function finaliseRollup(
  totalG: number,
  upfG: number,
  unclassifiedG: number,
  upf: Map<number, UpfContributor>,
  unclassified: Set<string>,
): UpfRollup {
  return {
    totalG,
    upfG,
    unclassifiedG,
    upfPercent: totalG > 0 ? (upfG / totalG) * 100 : null,
    upfIngredients: [...upf.values()].sort((a, b) => b.grams - a.grams),
    unclassifiedIngredients: [...unclassified],
  };
}

export async function computeUpfSummary(): Promise<UpfSummary> {
  const [ingredients, subs, subIngs, subSubs, recipes, recIngs, recSubs] = await Promise.all([
    db.select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      novaClass: ingredientsTable.novaClass,
      novaMarkers: ingredientsTable.novaMarkers,
    }).from(ingredientsTable),
    db.select({ id: subRecipesTable.id, name: subRecipesTable.name, yieldUnit: subRecipesTable.yieldUnit }).from(subRecipesTable),
    db.select({
      subRecipeId: subRecipeIngredientsTable.subRecipeId,
      ingredientId: subRecipeIngredientsTable.ingredientId,
      quantity: subRecipeIngredientsTable.quantity,
    }).from(subRecipeIngredientsTable),
    db.select({
      subRecipeId: subRecipeSubRecipesTable.subRecipeId,
      componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
      quantity: subRecipeSubRecipesTable.quantity,
    }).from(subRecipeSubRecipesTable),
    db.select({ id: recipesTable.id, name: recipesTable.name, category: recipesTable.category }).from(recipesTable),
    db.select({
      recipeId: recipeIngredientsTable.recipeId,
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
    }).from(recipeIngredientsTable),
    db.select({
      recipeId: recipeSubRecipesTable.recipeId,
      subRecipeId: recipeSubRecipesTable.subRecipeId,
      quantity: recipeSubRecipesTable.quantity,
    }).from(recipeSubRecipesTable),
  ]);

  const ingById = new Map<number, IngredientNova>(
    ingredients.map(i => [i.id, { ...i, novaMarkers: (i.novaMarkers as string[] | null) ?? [] }]),
  );
  const subById = new Map(subs.map(s => [s.id, s]));
  const subIngsBySub = new Map<number, typeof subIngs>();
  for (const si of subIngs) {
    const arr = subIngsBySub.get(si.subRecipeId) ?? [];
    arr.push(si);
    subIngsBySub.set(si.subRecipeId, arr);
  }
  const subSubsBySub = new Map<number, typeof subSubs>();
  for (const ss of subSubs) {
    const arr = subSubsBySub.get(ss.subRecipeId) ?? [];
    arr.push(ss);
    subSubsBySub.set(ss.subRecipeId, arr);
  }

  const subRollups = new Map<number, UpfRollup>();

  function rollupIngredientLine(
    ing: IngredientNova | undefined,
    grams: number,
    acc: { totalG: number; upfG: number; unclassifiedG: number; upf: Map<number, UpfContributor>; unclassified: Set<string> },
  ) {
    if (!ing || grams <= 0) return;
    acc.totalG += grams;
    if (ing.novaClass === 4) {
      acc.upfG += grams;
      mergeContributor(acc.upf, { ingredientId: ing.id, name: ing.name, grams, novaMarkers: ing.novaMarkers });
    } else if (ing.novaClass == null) {
      acc.unclassifiedG += grams;
      acc.unclassified.add(ing.name);
    }
  }

  function computeSubRollup(subRecipeId: number, ancestorPath: Set<number>): UpfRollup {
    const memo = subRollups.get(subRecipeId);
    if (memo) return memo;
    if (ancestorPath.has(subRecipeId)) return emptyRollup();
    ancestorPath.add(subRecipeId);

    const acc = { totalG: 0, upfG: 0, unclassifiedG: 0, upf: new Map<number, UpfContributor>(), unclassified: new Set<string>() };

    for (const line of subIngsBySub.get(subRecipeId) ?? []) {
      const ing = ingById.get(line.ingredientId);
      rollupIngredientLine(ing, ing ? toGrams(Number(line.quantity), ing.unit) : 0, acc);
    }

    for (const link of subSubsBySub.get(subRecipeId) ?? []) {
      const child = subById.get(link.componentSubRecipeId);
      if (!child) continue;
      const childRollup = computeSubRollup(link.componentSubRecipeId, ancestorPath);
      if (childRollup.totalG <= 0) continue;
      const usedG = toGrams(Number(link.quantity), child.yieldUnit ?? "g");
      const scale = usedG / childRollup.totalG;
      acc.totalG += usedG;
      acc.upfG += childRollup.upfG * scale;
      acc.unclassifiedG += childRollup.unclassifiedG * scale;
      for (const c of childRollup.upfIngredients) {
        mergeContributor(acc.upf, { ...c, grams: c.grams * scale });
      }
      for (const n of childRollup.unclassifiedIngredients) acc.unclassified.add(n);
    }

    ancestorPath.delete(subRecipeId);
    const rollup = finaliseRollup(acc.totalG, acc.upfG, acc.unclassifiedG, acc.upf, acc.unclassified);
    subRollups.set(subRecipeId, rollup);
    return rollup;
  }

  const subResults: SubRecipeUpf[] = subs.map(s => ({
    subRecipeId: s.id,
    name: s.name,
    ...computeSubRollup(s.id, new Set()),
  }));

  const recIngsByRecipe = new Map<number, typeof recIngs>();
  for (const ri of recIngs) {
    const arr = recIngsByRecipe.get(ri.recipeId) ?? [];
    arr.push(ri);
    recIngsByRecipe.set(ri.recipeId, arr);
  }
  const recSubsByRecipe = new Map<number, typeof recSubs>();
  for (const rs of recSubs) {
    const arr = recSubsByRecipe.get(rs.recipeId) ?? [];
    arr.push(rs);
    recSubsByRecipe.set(rs.recipeId, arr);
  }

  const recipeResults: RecipeUpf[] = recipes.map(r => {
    const acc = { totalG: 0, upfG: 0, unclassifiedG: 0, upf: new Map<number, UpfContributor>(), unclassified: new Set<string>() };

    for (const line of recIngsByRecipe.get(r.id) ?? []) {
      const ing = ingById.get(line.ingredientId);
      rollupIngredientLine(ing, ing ? toGrams(Number(line.quantity), ing.unit) : 0, acc);
    }

    for (const link of recSubsByRecipe.get(r.id) ?? []) {
      const child = subById.get(link.subRecipeId);
      if (!child) continue;
      const childRollup = subRollups.get(link.subRecipeId) ?? computeSubRollup(link.subRecipeId, new Set());
      if (childRollup.totalG <= 0) continue;
      const usedG = toGrams(Number(link.quantity), child.yieldUnit ?? "g");
      const scale = usedG / childRollup.totalG;
      acc.totalG += usedG;
      acc.upfG += childRollup.upfG * scale;
      acc.unclassifiedG += childRollup.unclassifiedG * scale;
      for (const c of childRollup.upfIngredients) {
        mergeContributor(acc.upf, { ...c, grams: c.grams * scale });
      }
      for (const n of childRollup.unclassifiedIngredients) acc.unclassified.add(n);
    }

    return {
      recipeId: r.id,
      name: r.name,
      category: r.category,
      ...finaliseRollup(acc.totalG, acc.upfG, acc.unclassifiedG, acc.upf, acc.unclassified),
    };
  });

  // Ingredients used anywhere that still need a NOVA class — drives the
  // "Analyze N ingredients" button in the UI.
  const usedIngredientIds = new Set<number>([
    ...recIngs.map(r => r.ingredientId),
    ...subIngs.map(s => s.ingredientId),
  ]);
  const unclassifiedUsedIngredientIds = [...usedIngredientIds].filter(id => {
    const ing = ingById.get(id);
    return ing != null && ing.novaClass == null;
  });

  return { recipes: recipeResults, subRecipes: subResults, unclassifiedUsedIngredientIds };
}
