import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  Loader2, CheckCircle2, Beef, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, useNextActivePlan, fmtQty, toKg } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";
import { PrepSubNav, usePrepByRecipe } from "./prep-hub";
import type { PrepIngredientDetail, PrepMarinadeDetail, PrepRecipeDetail } from "./prep-hub";

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// Left: recipe list. Right: selected recipe detail with ingredient breakdown.
// ──────────────────────────────────────────────────────────────────────────────
export function PrepMeatStation({ plan }: { plan: ProductionPlanDetail }) {
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_meat", plan.id, plan.planDate);

  const totalTrays = recipes.reduce((sum, r) => sum + (r.trayCount ?? 0), 0);

  // Auto-select first recipe
  useEffect(() => {
    if (recipes.length > 0 && (selectedRecipeId === null || !recipes.some(r => r.recipeId === selectedRecipeId))) {
      setSelectedRecipeId(recipes[0].recipeId);
    }
  }, [recipes, selectedRecipeId]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (recipes.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <p className="font-medium">No raw meat ingredients to prep</p>
        <p className="text-sm mt-1">Set ingredient category to "raw_meat" in the ingredients library</p>
      </div>
    );
  }

  const selected = recipes.find(r => r.recipeId === selectedRecipeId) ?? recipes[0];
  const selRawMeat = selected.ingredients.filter(i => i.isRawMeat);
  const selMarinades = selected.marinades ?? [];
  const selTotalRawKg = selRawMeat.reduce((sum, i) => sum + toKg(i.rawQty, i.unit), 0);
  const selTotalMarinadeG = selMarinades.reduce((sum, m) => sum + m.totalGrams, 0);
  const selTrays = selected.trayCount;
  const selTrayCapKg = selRawMeat.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;

  return (
    <div className="space-y-4">
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />

      <PrepSubNav planId={plan.id} current="prep_meat" />

      {/* Summary bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Beef className="w-6 h-6 text-rose-500" />
            <div>
              <h2 className="font-semibold text-base">Raw Meat Prep</h2>
              <p className="text-xs text-muted-foreground">{recipes.length} recipe{recipes.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          {totalTrays > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Trays</p>
              <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{totalTrays}</p>
            </div>
          )}
        </div>
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-muted-foreground">Prep progress</p>
            <p className="text-xs text-muted-foreground italic">Not tracked at this station</p>
          </div>
          <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all bg-rose-300 dark:bg-rose-800" style={{ width: "0%" }} />
          </div>
        </div>
        <div className="pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="prep_meat" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {/* Split panel */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Left: recipe list */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
            </div>
            <div className="divide-y divide-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              {recipes.map(recipe => {
                const rRawMeat = recipe.ingredients.filter(i => i.isRawMeat);
                const rTotalKg = rRawMeat.reduce((s, i) => s + toKg(i.rawQty, i.unit), 0);
                const isSelected = recipe.recipeId === selected.recipeId;
                return (
                  <button
                    key={recipe.recipeId}
                    onClick={() => setSelectedRecipeId(recipe.recipeId)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      isSelected
                        ? "bg-rose-50/80 dark:bg-rose-900/20 border-l-4 border-l-rose-500"
                        : "hover:bg-secondary/40 border-l-4 border-l-transparent"
                    )}
                  >
                    <Beef className={cn("w-5 h-5 flex-shrink-0", isSelected ? "text-rose-500" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium truncate", isSelected && "font-semibold")}>{recipe.recipeName}</p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{recipe.batchesTarget}×</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: selected recipe detail */}
        <div className="flex-1 min-w-0">
          <div className="bg-card border-2 border-rose-400 dark:border-rose-600 rounded-2xl p-6">

            {/* Header */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Currently Prepping</p>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-3xl font-bold leading-tight">{selected.recipeName}</h2>
                {selected.sopUrl && (
                  <a href={selected.sopUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 mt-1">
                    SOP <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{selected.batchesTarget} batch{selected.batchesTarget !== 1 ? "es" : ""}</p>
            </div>

            {/* Summary bar — total trays across all meats */}
            {selTrays != null && selTrays > 0 && (
              <div className="flex items-center gap-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl px-5 py-3 mb-5">
                <div className="text-center min-w-[56px]">
                  <p className="text-4xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400 leading-none">{selTrays}</p>
                  <p className="text-xs font-medium text-rose-700 dark:text-rose-300 mt-0.5">total tray{selTrays !== 1 ? "s" : ""}</p>
                </div>
                <div className="h-8 w-px bg-rose-200 dark:bg-rose-700" />
                <div>
                  <p className="text-sm font-semibold tabular-nums">{selTotalRawKg.toFixed(2)} kg raw meat</p>
                  {selTotalMarinadeG > 0 && (
                    <p className="text-xs text-muted-foreground">+ {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(2)} kg` : `${selTotalMarinadeG}g`} marinade</p>
                  )}
                  {selRawMeat.length > 1 && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-0.5">across {selRawMeat.length} meat types — see breakdown below</p>}
                </div>
              </div>
            )}

            {/* No tray capacity warning */}
            {(selTrays == null || selTrays === 0) && (
              <div className="mb-5 space-y-3">
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Raw Meat</p>
                    <p className="text-5xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400">
                      {selTotalRawKg.toFixed(2)}
                      <span className="text-2xl font-normal ml-1 text-muted-foreground">kg</span>
                    </p>
                  </div>
                  {selTotalMarinadeG > 0 && (
                    <div className="text-center">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Marinade</p>
                      <p className="text-3xl font-bold font-display tabular-nums text-orange-500">
                        {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(2)}` : selTotalMarinadeG}
                        <span className="text-xl font-normal ml-1 text-muted-foreground">{selTotalMarinadeG >= 1000 ? "kg" : "g"}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                  <span className="mt-0.5">⚠️</span>
                  <span>Tray count not set — add a <strong>Tray Capacity (kg)</strong> to this recipe's raw meat ingredients in the Ingredients Library to see per-tray breakdown.</span>
                </div>
              </div>
            )}

            {/* Per-ingredient tray cards */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selTrays != null && selTrays > 0 ? "Per Meat — Tray Breakdown" : "Ingredients"}
              </p>
              {selRawMeat.map(ing => {
                const meatMarinades = selMarinades.filter(m => m.rawMeatIngredientId === ing.ingredientId);
                const ingKgTotal = toKg(ing.rawQty, ing.unit);
                const ingTrays = ing.trayCount;
                const perTrayKg = ingTrays && ingTrays > 0 ? ingKgTotal / ingTrays : null;
                const ingMarinadeG = meatMarinades.reduce((s, m) => s + m.totalGrams, 0);
                return (
                  <div key={ing.ingredientId} className="rounded-xl border-2 border-rose-200 dark:border-rose-800 overflow-hidden">
                    {/* Meat header with its own tray count */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-rose-50 dark:bg-rose-900/20">
                      {ingTrays != null && ingTrays > 0 ? (
                        <>
                          <div className="text-center bg-rose-600 text-white rounded-lg px-3 py-1.5 min-w-[52px]">
                            <p className="text-2xl font-bold font-display tabular-nums leading-none">{ingTrays}</p>
                            <p className="text-xs opacity-80">tray{ingTrays !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold">{ing.ingredientName}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {ingKgTotal.toFixed(2)} kg total
                              {ing.rawMeatTrayCapacityKg && ` · ${ing.rawMeatTrayCapacityKg} kg cap`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-none">{perTrayKg!.toFixed(2)} kg</p>
                            <p className="text-xs text-muted-foreground mt-0.5">per tray</p>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-between">
                          <p className="font-semibold">{ing.ingredientName}</p>
                          <p className="tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{ingKgTotal.toFixed(2)} kg</p>
                        </div>
                      )}
                    </div>
                    {/* Marinade sub-rows */}
                    {meatMarinades.map((m, mi) => {
                      const name = m.marinadeIngredientName ?? m.marinadeSubRecipeName ?? "Unknown";
                      const perTrayG = ingTrays && ingTrays > 0 ? Math.round(m.totalGrams / ingTrays) : null;
                      return (
                        <div key={mi} className="flex items-center justify-between px-4 py-2 border-t border-rose-100 dark:border-rose-900/40 text-sm text-muted-foreground bg-white dark:bg-background/50">
                          <span className="flex items-center gap-2">
                            <span className="text-rose-400">↳</span>
                            <span>{name}</span>
                          </span>
                          <div className="text-right">
                            {perTrayG != null ? (
                              <>
                                <span className="tabular-nums font-semibold text-foreground">{perTrayG}g / tray</span>
                                <p className="text-xs text-muted-foreground">{m.totalGrams}g total</p>
                              </>
                            ) : (
                              <span className="tabular-nums font-medium text-foreground">{m.totalGrams}g</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}