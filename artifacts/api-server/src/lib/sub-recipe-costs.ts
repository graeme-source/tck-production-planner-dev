import { db, subRecipesTable, subRecipeIngredientsTable, ingredientsTable, subRecipeSubRecipesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Compute total batch cost (and cost-per-yield-unit) for every sub-recipe,
 * correctly resolving nested sub-recipe dependencies via topological sort.
 *
 * Returns: { [subRecipeId]: costPerYieldUnit }
 */
export async function computeSubRecipeCosts(): Promise<Record<number, number>> {
  const allSubRecipes = await db
    .select({ id: subRecipesTable.id, yield: subRecipesTable.yield })
    .from(subRecipesTable);

  if (allSubRecipes.length === 0) return {};

  const allIngredientLinks = await db
    .select({
      subRecipeId: subRecipeIngredientsTable.subRecipeId,
      quantity: subRecipeIngredientsTable.quantity,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
    })
    .from(subRecipeIngredientsTable)
    .leftJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id));

  const allNestedLinks = await db
    .select({
      subRecipeId: subRecipeSubRecipesTable.subRecipeId,
      componentSubRecipeId: subRecipeSubRecipesTable.componentSubRecipeId,
      quantity: subRecipeSubRecipesTable.quantity,
    })
    .from(subRecipeSubRecipesTable);

  const yieldById: Record<number, number> = Object.fromEntries(
    allSubRecipes.map(sr => [sr.id, Number(sr.yield)])
  );

  const rawIngredientCost: Record<number, number> = {};
  for (const link of allIngredientLinks) {
    if (link.subRecipeId == null) continue;
    const pw = Number(link.packWeight ?? 0);
    const cpp = Number(link.costPerPack ?? 0);
    const q = Number(link.quantity);
    if (pw <= 0) continue;
    rawIngredientCost[link.subRecipeId] =
      (rawIngredientCost[link.subRecipeId] ?? 0) + q * (cpp / pw);
  }

  const componentsByParent = new Map<number, { componentSubRecipeId: number; quantity: number }[]>();
  for (const link of allNestedLinks) {
    const existing = componentsByParent.get(link.subRecipeId) ?? [];
    existing.push({ componentSubRecipeId: link.componentSubRecipeId, quantity: Number(link.quantity) });
    componentsByParent.set(link.subRecipeId, existing);
  }

  const visited = new Set<number>();
  const sorted: number[] = [];

  function dfs(id: number, path: Set<number>) {
    if (path.has(id) || visited.has(id)) return;
    path.add(id);
    for (const comp of componentsByParent.get(id) ?? []) {
      dfs(comp.componentSubRecipeId, path);
    }
    path.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const sr of allSubRecipes) {
    dfs(sr.id, new Set());
  }

  const totalBatchCost: Record<number, number> = {};
  for (const srId of sorted) {
    let cost = rawIngredientCost[srId] ?? 0;
    for (const comp of componentsByParent.get(srId) ?? []) {
      const compYield = yieldById[comp.componentSubRecipeId] ?? 1;
      const compTotal = totalBatchCost[comp.componentSubRecipeId] ?? 0;
      const compCostPerUnit = compYield > 0 ? compTotal / compYield : 0;
      cost += comp.quantity * compCostPerUnit;
    }
    totalBatchCost[srId] = cost;
  }

  const result: Record<number, number> = {};
  for (const sr of allSubRecipes) {
    const y = yieldById[sr.id] ?? 1;
    result[sr.id] = y > 0 ? (totalBatchCost[sr.id] ?? 0) / y : 0;
  }

  return result;
}

/**
 * Check whether adding `proposedComponentIds` as components of `targetId`
 * would create a cycle in the sub-recipe dependency graph.
 */
export function wouldCreateCycle(
  targetId: number,
  proposedComponentIds: number[],
  existingLinks: { subRecipeId: number; componentSubRecipeId: number }[]
): boolean {
  const deps = new Map<number, Set<number>>();
  for (const link of existingLinks) {
    if (link.subRecipeId === targetId) continue;
    const s = deps.get(link.subRecipeId) ?? new Set<number>();
    s.add(link.componentSubRecipeId);
    deps.set(link.subRecipeId, s);
  }
  deps.set(targetId, new Set(proposedComponentIds));

  function canReach(from: number, target: number, seen: Set<number>): boolean {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of deps.get(from) ?? []) {
      if (canReach(next, target, seen)) return true;
    }
    return false;
  }

  for (const compId of proposedComponentIds) {
    if (compId === targetId) return true;
    if (canReach(compId, targetId, new Set())) return true;
  }
  return false;
}
