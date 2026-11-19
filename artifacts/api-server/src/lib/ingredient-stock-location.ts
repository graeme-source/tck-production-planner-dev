/**
 * Where an ingredient's stock count is filed, by its category. Raw
 * materials never go in production_fridge (finished product only): chilled
 * ingredients → prep_fridge, dry goods → dry_store, raw meat →
 * raw_meat_fridge. Moved out of routes/orders.ts (19 Nov 2026) so a pulled
 * kanban's count lands in the same place as one typed on the Orders page.
 */
const LOCATION_BY_CATEGORY: Record<string, string> = {
  vegetable: "prep_fridge",
  herb: "prep_fridge",
  base: "prep_fridge",
  dairy: "prep_fridge",
  cheese: "prep_fridge",
  cooked_meat: "prep_fridge",
  raw_meat: "raw_meat_fridge",
  meat: "raw_meat_fridge",
  sauce: "dry_store",
  spice: "dry_store",
  seasoning: "dry_store",
  other: "dry_store",
  dough: "dry_store",
  frozen: "production_freezer",
  dry: "dry_store",
};

export function ingredientStockLocation(category: string | null | undefined): string {
  return LOCATION_BY_CATEGORY[category ?? ""] ?? "prep_fridge";
}
