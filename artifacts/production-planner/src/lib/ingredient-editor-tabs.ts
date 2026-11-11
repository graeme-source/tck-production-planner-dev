/**
 * The tabs of the ingredient / supply editor (Graeme, 11 Nov 2026: "redesign
 * the ingredients/supplies edit box like the recipe edit box … tabs for
 * grouping the different settings … It's difficult to find any settings").
 * Objective F. Pure — tested in ingredient-editor-tabs.test.ts.
 *
 *   • INGREDIENT_TABS — the bar, in order. Supplies (packaging) don't get the
 *     food-only tabs.
 *   • INGREDIENT_FIELD_TABS — which tab each form field lives on, so a refused
 *     save opens the tab with the first problem and each tab shows its count.
 */

export type IngredientTabId = "basics" | "buying" | "stock" | "shelf" | "prep" | "label" | "shop";

export const INGREDIENT_TABS: ReadonlyArray<{ id: IngredientTabId; label: string; hint: string; foodOnly?: boolean }> = [
  { id: "basics", label: "Basics", hint: "Name, unit, category" },
  { id: "buying", label: "Buying", hint: "Suppliers, pack, price" },
  { id: "stock", label: "Stock & kanban", hint: "Checks, storage, kanban" },
  { id: "shelf", label: "Shelf life", hint: "Use-by, goods-in", foodOnly: true },
  { id: "prep", label: "Prep & cooking", hint: "Weighing, meat, oven", foodOnly: true },
  { id: "label", label: "Label & nutrition", hint: "Declaration, allergens", foodOnly: true },
  { id: "shop", label: "Shop & fridge", hint: "Shopify, fridge item" },
];

/** The tabs to show: everything for a food ingredient, no food-only tabs for a supply. */
export function tabsFor(isIngredient: boolean): IngredientTabId[] {
  return INGREDIENT_TABS.filter(t => isIngredient || !t.foodOnly).map(t => t.id);
}

export const INGREDIENT_FIELD_TABS: Readonly<Record<string, IngredientTabId>> = {
  formMode: "basics", name: "basics", unit: "basics", category: "basics", brand: "basics", notes: "basics", orderingUrl: "basics",
  supplierId: "buying", secondarySupplierId: "buying", secondaryCostPerPack: "buying", supplierPartNumber: "buying",
  packWeight: "buying", costPerPack: "buying", caseSizePacks: "buying", palletSize: "buying", isBottle: "buying", bottleSize: "buying",
  stockCheckEnabled: "stock", stockCheckFrequency: "stock", stockCheckDay: "stock", surplusPercent: "stock", stockInPacks: "stock", surplusMode: "stock", surplusAbsoluteQty: "stock",
  kanbanEnabled: "stock", kanbanUnit: "stock", kanbanQuantity: "stock", kanbanOrderAmount: "stock",
  shelfLifeDays: "shelf", openedLifeDays: "shelf", defrostLifeDays: "shelf", requiresUseByDate: "shelf", minDeliveryShelfLifeDays: "shelf",
  processingRatioPct: "prep", prepWeightMode: "prep", prepOneTinPerRecipe: "prep", prepCountPerPortion: "prep", isPasta: "prep",
  rawMeatTrayCapacityKg: "prep", minCookingTempC: "prep", estimatedCookTimeMin: "prep", meatProcessMinutes: "prep", ovenTempC: "prep", steamPct: "prep",
  labelDeclaration: "label", allergens: "label", novaClass: "label", nutritionalsAiEstimated: "label",
  energyKj: "label", energyKcal: "label", fat: "label", saturates: "label", carbohydrate: "label", sugars: "label", protein: "label", fibre: "label", salt: "label",
  shopifyVariantId: "shop", shopifyProductTitle: "shop", shopifyVariantTitle: "shop", shopifyUnitsPerPack: "shop",
};

/** Problems per tab, from react-hook-form's errors (one per field). An
 *  unknown field counts on Basics, so it's never hidden. */
export function ingredientErrorCounts(errors: Record<string, unknown> | null | undefined): Partial<Record<IngredientTabId, number>> {
  const out: Partial<Record<IngredientTabId, number>> = {};
  for (const [field, e] of Object.entries(errors ?? {})) {
    if (!e) continue;
    const tab = INGREDIENT_FIELD_TABS[field] ?? "basics";
    out[tab] = (out[tab] ?? 0) + 1;
  }
  return out;
}

/** The first tab, in bar order, with a problem — or null. */
export function firstIngredientErrorTab(errors: Record<string, unknown> | null | undefined): IngredientTabId | null {
  const counts = ingredientErrorCounts(errors);
  return INGREDIENT_TABS.find(t => (counts[t.id] ?? 0) > 0)?.id ?? null;
}
