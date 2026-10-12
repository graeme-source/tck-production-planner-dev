/** Options the shared recipe / sub-recipe editor rows pick from. Both pages
 *  build these from their own list queries; fields one page doesn't have
 *  are optional. */
export type EditorIngredientOption = {
  id: number;
  name: string;
  unit: string;
  /** Recipe page: number (1 = none). Sub-recipe page: null = none. */
  processingRatio?: number | null;
  packWeight?: number | null;
  costPerPack?: number | null;
  category?: string | null;
  supplierName?: string | null;
  novaClass?: number | null;
  novaMarkers?: string[] | null;
};

export type EditorSubRecipeOption = {
  id: number;
  name: string;
  yieldUnit: string;
  costPerYieldUnit?: number | null;
};
