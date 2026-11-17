import { getGetProductionPlanQueryKey, useGetProductionPlan } from "@workspace/api-client-react";
import { useRecipeColourLookup } from "@/components/recipe-swatch";
import { isItemBuilt, type DayItem } from "@/lib/dashboard-day-totals";
import { cn } from "@/lib/utils";

// A plan card's recipe lines on the production plans screen, struck through
// and faded once each is finished at the building table — the same rule as
// the dashboard's Today's Production (isItemBuilt; Graeme, 17 Nov 2026). The
// plans list carries no building progress, so a live plan's own detail is
// read for it; a draft plan has nothing built and isn't read.

export interface PlanCardItem {
  id: number;
  recipeId: number;
  recipeName: string;
  recipeColor: string | null;
  batchesTarget: number;
}

export function PlanCardRecipes({ planId, items, live }: { planId: number; items: PlanCardItem[]; live: boolean }) {
  const colourStyle = useRecipeColourLookup();
  // Refreshed every 30 s so the lines strike through as building goes.
  const { data } = useGetProductionPlan(planId, {
    query: { enabled: live, refetchInterval: 30_000, queryKey: getGetProductionPlanQueryKey(planId) },
  }) as { data?: { items?: Array<DayItem & { id: number }> } };
  const built = new Set((data?.items ?? []).filter(isItemBuilt).map(it => it.id));
  return (
    <div className="space-y-1">
      {items.map(item => {
        const done = built.has(item.id);
        const colorStyle = item.recipeColor ? { color: item.recipeColor } : undefined;
        const nameStyle = item.recipeColor ? colourStyle(item.recipeId, item.recipeColor, "text") : undefined;
        return (
          <div key={item.id} className={cn("flex items-baseline justify-between gap-3 text-sm min-w-0", done && "opacity-50")}>
            <span className={cn("truncate font-medium", done && "line-through")} style={nameStyle}>
              {done && <span className="sr-only">Built: </span>}{item.recipeName}
            </span>
            <span className={cn("tabular-nums font-bold whitespace-nowrap", done && "line-through")} style={colorStyle}>
              {item.batchesTarget}
            </span>
          </div>
        );
      })}
    </div>
  );
}
