import { useQuery } from "@tanstack/react-query";
import { isMacCheese } from "./constants";

/**
 * The recipes whose meat the Mixing station cooks on trays (and whose cooked
 * core temperature it records).
 *
 * Mac & Cheese prep — including its pigs-in-blankets cook temperature — is
 * recorded on the Macaroni Cheese station, so it never belongs here (Fix
 * queue #205). Before this helper the first load skipped the filter while the
 * 10-second refresh applied it, so pigs in blankets flashed up for the first
 * few seconds after Mixing opened. One function, used by the one query below,
 * means the two can't drift again.
 */
export function mixingCookingRecipes<T extends { recipeCategory?: string | null }>(
  recipes: readonly T[] | null | undefined,
): T[] {
  return (recipes ?? []).filter(r => !isMacCheese({ recipeCategory: r.recipeCategory }));
}

export function mixingCookingRecipesQueryKey(planId: number) {
  return ["prep-requirements-by-recipe", planId, "prep_meat", "mixing"] as const;
}

/** Tray-cooking recipes for the Mixing station, refreshed every 10 seconds. */
export function useMixingCookingRecipes<T extends { recipeCategory?: string | null }>(planId: number) {
  return useQuery<T[]>({
    queryKey: mixingCookingRecipesQueryKey(planId),
    queryFn: async () => {
      const res = await fetch(
        `/api/production-plans/${planId}/prep-requirements-by-recipe?station=prep_meat`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`Cooking recipes failed (${res.status})`);
      const d = (await res.json()) as { recipes?: T[] };
      return mixingCookingRecipes(d.recipes);
    },
    refetchInterval: 10_000,
  });
}
