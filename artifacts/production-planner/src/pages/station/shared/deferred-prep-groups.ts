/**
 * Deferred prep as the banner lists it (deferred-prep-banner.tsx; Graeme,
 * 27 Oct 2026 — "no completing prep without opening the item", amounts only
 * once it's open; Objectives C and I): one card per prep item per recipe per
 * source prep day. The card shows no amounts; its tins, in tin order, are
 * inside the opened card, where each is ticked.
 *
 * The source plan is part of the key: the ticks are saved against that plan
 * and the opened card's (invisible) prep timing is recorded against it, so
 * one card never mixes two days' tins.
 */

/** One deferred tin, as GET /api/production-plans/prep-deferrals/outstanding
 *  returns it. */
export interface DeferredPrepItem {
  id: number;
  sourcePlanId: number;
  sourcePlanDate: string;
  sourcePlanName: string | null;
  /** The sub-recipe's id when isSubRecipe (the same folding as a prep tick). */
  ingredientId: number;
  isSubRecipe: boolean;
  subRecipeOriginId: number | null;
  recipeId: number;
  recipeName: string | null;
  recipeCategory: string | null;
  recipeColor: string | null;
  tinNumber: number;
  tinCount: number | null;
  qtyPerTin: number | null;
  deferredToDate: string;
  deferredAt: string;
  deferredByUserId: number | null;
  deferredByUserName: string | null;
  itemName: string | null;
  itemUnit: string | null;
}

export interface DeferredPrepGroup {
  key: string;
  sourcePlanId: number;
  sourcePlanDate: string;
  recipeId: number;
  recipeName: string;
  recipeColor: string | null;
  itemName: string;
  ingredientId: number;
  isSubRecipe: boolean;
  subRecipeOriginId: number | null;
  /** In tin order. */
  tins: DeferredPrepItem[];
}

export function deferredPrepGroupKey(item: DeferredPrepItem): string {
  return [
    item.sourcePlanId,
    item.recipeId,
    item.ingredientId,
    item.isSubRecipe ? "s" : "i",
    item.subRecipeOriginId ?? "x",
  ].join("_");
}

/** Cards in the order the server sent the tins (oldest deferral first). */
export function groupDeferredPrep(items: readonly DeferredPrepItem[]): DeferredPrepGroup[] {
  const groups = new Map<string, DeferredPrepGroup>();
  for (const item of items) {
    const key = deferredPrepGroupKey(item);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sourcePlanId: item.sourcePlanId,
        sourcePlanDate: item.sourcePlanDate,
        recipeId: item.recipeId,
        recipeName: item.recipeName ?? "Recipe",
        recipeColor: item.recipeColor,
        itemName: item.itemName ?? "Item",
        ingredientId: item.ingredientId,
        isSubRecipe: item.isSubRecipe,
        subRecipeOriginId: item.subRecipeOriginId,
        tins: [],
      };
      groups.set(key, group);
    }
    group.tins.push(item);
  }
  for (const group of groups.values()) group.tins.sort((a, b) => a.tinNumber - b.tinNumber);
  return [...groups.values()];
}

/** The prep item an opened card times — the ingredient, or the sub-recipe. */
export function deferredPrepItemOf(
  group: Pick<DeferredPrepGroup, "ingredientId" | "isSubRecipe">,
): { ingredientId: number } | { subRecipeId: number } {
  return group.isSubRecipe ? { subRecipeId: group.ingredientId } : { ingredientId: group.ingredientId };
}
