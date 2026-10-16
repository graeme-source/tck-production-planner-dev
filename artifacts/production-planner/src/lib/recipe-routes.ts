/**
 * Every recipe's production route (migration 0202), looked up by id — for
 * screens whose data doesn't carry the flags (the Create Plan calculation,
 * the plans list). Cached for the session; GET /api/recipes/production-routes.
 */
import { useQuery } from "@tanstack/react-query";
import { STANDARD_ROUTE, type RecipeRoute } from "@workspace/production-schedule";

export type RecipeRouteRow = RecipeRoute & { id: number };

export const RECIPE_ROUTES_QUERY_KEY = ["recipe-production-routes"] as const;

export function useRecipeRoutes(enabled = true) {
  const q = useQuery<RecipeRouteRow[]>({
    queryKey: RECIPE_ROUTES_QUERY_KEY,
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/recipes/production-routes", { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load recipe routes");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const byId = new Map<number, RecipeRoute>((q.data ?? []).map(r => [r.id, r]));
  return { ...q, routeOf: (recipeId: number): RecipeRoute => byId.get(recipeId) ?? STANDARD_ROUTE };
}
