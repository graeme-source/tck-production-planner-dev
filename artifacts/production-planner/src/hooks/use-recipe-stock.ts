import { useQuery } from "@tanstack/react-query";
import type { ListingStock } from "@/lib/recipe-stock-cells";

/** Fridge + Shopify stock per recipe for the Recipes table (25 Nov 2026).
 *  Server: api-server routes/recipe-stock.ts. Refreshes every minute. */
export interface RecipeStockRow { recipeId: number; fridgePacks: number | null; listings: ListingStock[] }
export interface RecipeStock { shopifyRead: boolean; byRecipe: Map<number, RecipeStockRow> }

export function useRecipeStock(enabled: boolean) {
  return useQuery<RecipeStock>({
    queryKey: ["recipe-stock"],
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/recipe-stock", { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load stock");
      const j = await res.json() as { shopifyRead: boolean; recipes: RecipeStockRow[] };
      return { shopifyRead: j.shopifyRead, byRecipe: new Map(j.recipes.map(r => [r.recipeId, r])) };
    },
  });
}
