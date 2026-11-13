/**
 * Prep Production. The old "Select prep station" page is gone (Graeme,
 * 13 Nov 2026: "a bit redundant now … go straight to" Main Prep) — every
 * prep section, Stock Check and Replenish Sub Recipes are tabs along the
 * top of each section (shared/prep-section-tabs.tsx). This file keeps the
 * shared prep types and usePrepByRecipe, and sends /station/prep to Main
 * Prep with the query string (?direct=1, ?from=…) intact.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Redirect, useSearch } from "wouter";
import { useNextActivePlan } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";

export interface PrepIngredientDetail {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  processingRatio: number | null;
  rawMeatTrayCapacityKg: number | null;
  minCookingTempC: number | null;
  estimatedCookTimeMin: number | null;
  ovenTempC: number | null;
  steamPct: number | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  cookedQty: number;
  rawQty: number;
  isRawMeat: boolean;
  isSeasoning: boolean;
  trayCount: number | null;
  prepCountPerPortion: number | null;
  pieceCount: number | null;
  stockInPacks: boolean;
  packWeight: number | null;
  /** How much of the prep figure (rawQty, or cookedQty for processed-weight
   *  prep) is the recipe's Mix +g, in `unit`. */
  mixExtraQty?: number;
}

export interface PrepMarinadeDetail {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeIngredientName: string | null;
  marinadeSubRecipeId: number | null;
  marinadeSubRecipeName: string | null;
  gramsPerKg?: number;
  totalGrams: number;
  /** Held back from prep day — the mixing/cooking station adds it on
   *  production day. Still counted in the tray-capacity maths. */
  addAtCooking?: boolean;
  /** Grams of totalGrams that are the recipe's Mix +g. */
  mixExtraGrams?: number;
}

export interface PrepRecipeDetail {
  recipeId: number;
  recipeName: string;
  recipeCategory?: string | null;
  batchesTarget: number;
  sopUrl: string | null;
  tinSize: string | null;
  maxBatchesPerTin: number | null;
  tinCount: number | null;
  trayCount: number | null;
  ingredients: PrepIngredientDetail[];
  marinades?: PrepMarinadeDetail[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook: fetch per-recipe prep requirements for the next active plan
// ──────────────────────────────────────────────────────────────────────────────
export function usePrepByRecipe(station: string, currentPlanId: number, afterDate?: string, direct = false) {
  // When direct=true (calendar prep-card flow), skip the auto-route to "next
  // active plan" and stick with currentPlanId. The hook is still called so
  // React's hook rules are satisfied; its result is just ignored.
  const { data: nextPlanData, isLoading: isPlanLoading } = useNextActivePlan(direct ? undefined : afterDate, "prep") as { data: NextActivePlan | null; isLoading: boolean };
  const nextPlan = direct ? null : nextPlanData;
  // When the next-plan lookup has resolved but found nothing, signal "no future plan"
  // instead of falling back to the current plan (which would show today's data).
  const noFuturePlan = !direct && !isPlanLoading && nextPlan != null && nextPlan.planId == null;
  const targetPlanId = direct ? currentPlanId : (noFuturePlan ? null : (nextPlan?.planId ?? null));
  const [recipes, setRecipes] = useState<PrepRecipeDetail[]>([]);
  const [isPrepLoading, setIsPrepLoading] = useState(false);
  const initialLoadDone = useRef(false);

  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    if (!targetPlanId) { setRecipes([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsPrepLoading(true);
    fetch(`/api/production-plans/${targetPlanId}/prep-requirements-by-recipe?station=${station}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: { recipes?: PrepRecipeDetail[] }) => {
        setRecipes(json.recipes ?? []); initialLoadDone.current = true; setIsPrepLoading(false);
      })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsPrepLoading(false); } });
  }, [targetPlanId, station]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    if (!targetPlanId) return;
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch, targetPlanId]);

  return {
    recipes,
    isLoading: isPlanLoading || (!!targetPlanId && isPrepLoading),
    nextPlan,
    targetPlanId,
    noFuturePlan,
  };
}

/** /plans/:id/station/prep → Main Prep, same plan, same query string. */
export function PrepHub({ planId }: { planId: number }) {
  const search = useSearch();
  return <Redirect to={`/plans/${planId}/station/main_prep${search ? `?${search.replace(/^\?/, "")}` : ""}`} replace />;
}
