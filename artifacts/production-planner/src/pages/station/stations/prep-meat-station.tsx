import { formatBatches } from "../shared/format-batches";
import { formatPrepWeight } from "@workspace/units";
import React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  Loader2, CheckCircle2, Beef, ExternalLink, Package, Check, BookOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SopChips, useSopViewer, type SopLink } from "@/components/sop-link-chips";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, PrepDraftBanner, toKg, toastDraftBlocked } from "../shared/prep-helpers";
import { prepTargetOf } from "../shared/stock-check-alarm";
import { usePrepByRecipe } from "./prep-hub";
import { PrepSectionTabs, PrepStockCheckTabBody, usePrepStockTabOpen } from "../shared/prep-section-tabs";
import type { PrepRecipeDetail, PrepIngredientDetail } from "./prep-hub";
import { SubRecipeReplenishModal, type ReplenishTarget } from "./sub-recipe-replenish-modal";
import { PrintIngredientLabelButton } from "@/components/print-ingredient-label-button";
import { StationStockChecks } from "../shared/station-stock-checks";
import { StockCheckButton } from "../shared/stock-check-entry";
import { MixExtraNote } from "../shared/mix-extra-note";
import { linkedStockChecksForRecipe } from "@/lib/linked-stock-checks";
import { rawMeatProgress, progressPct, tasksLine } from "@/lib/prep-progress";
import { usePrepSessionCapture, type PrepSessionItem } from "@/hooks/use-prep-session-capture";
import { prepItemKey } from "@/lib/prep-session-capture";

interface PrepTrayCompletion {
  id: number;
  ingredientId: number | null;
  recipeId: number;
  tinNumber: number | null;
  userId: number | null;
  userName: string | null;
  completedAt: string;
}

function usePrepMeatCompletions(planId: number) {
  const [completions, setCompletions] = useState<PrepTrayCompletion[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/production-plans/${planId}/main-prep?station=prep_meat`, {
      credentials: "include",
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { if (d?.completions) setCompletions(d.completions); })
      .catch(e => { if (e.name !== "AbortError") { /* ignore */ } });
  }, [planId]);

  useEffect(() => {
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  return { completions, refetch: doFetch };
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// Left: recipe list. Right: selected recipe detail with clickable tray tasks.
// ──────────────────────────────────────────────────────────────────────────────
export function PrepMeatStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const { toast } = useToast();
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  // A rub/marinade sub-recipe tapped on a meat row — opens the replenish
  // modal for it so it can be made without leaving this screen.
  const [replenishTarget, setReplenishTarget] = useState<ReplenishTarget | null>(null);
  const search = useSearch();
  const isDirect = new URLSearchParams(search).get("direct") === "1";
  // Stock Check is the fourth prep tab (?tab=stock-check) — Graeme, 22 Oct.
  const stockTabOpen = usePrepStockTabOpen();
  const { recipes, isLoading, nextPlan, targetPlanId, noFuturePlan } = usePrepByRecipe("prep_meat", plan.id, plan.planDate, isDirect);
  const isDraft = nextPlan?.status === "draft";
  const { completions, refetch } = usePrepMeatCompletions(targetPlanId ?? plan.id);
  // Prep timing, in the background (the founder-only prep times report).
  const timing = usePrepSessionCapture({ planId: targetPlanId, station: "prep_meat", enabled: !isDraft && !noFuturePlan });

  // SOP links for the whole board in two calls (recipes + ingredients),
  // same pattern as main prep — "raw prep items" carry SOPs like any other.
  const sopRecipeIds = [...new Set(recipes.map(r => r.recipeId))].sort((a, b) => a - b);
  const sopRecipesKey = ["sop-links-recipes", "prep_meat", sopRecipeIds.join(",")];
  const { data: sopLinksByRecipe } = useQuery<Record<number, SopLink[]>>({
    queryKey: sopRecipesKey,
    queryFn: async () => {
      const res = await fetch(`/api/standards/links/for-recipes?ids=${sopRecipeIds.join(",")}&station=prep_meat`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: sopRecipeIds.length > 0,
  });
  const sopIngredientIds = [...new Set(recipes.flatMap(r => r.ingredients.map(i => i.ingredientId)))].sort((a, b) => a - b);
  const sopIngredientsKey = ["sop-links-ingredients", "prep_meat", sopIngredientIds.join(",")];
  const { data: sopLinksByIngredient } = useQuery<Record<number, Array<SopLink & { scope: "ingredient" | "recipe"; recipeId: number | null }>>>({
    queryKey: sopIngredientsKey,
    queryFn: async () => {
      const res = await fetch(`/api/standards/links/for-ingredients?ids=${sopIngredientIds.join(",")}&station=prep_meat`, { credentials: "include" });
      return res.ok ? res.json() : {};
    },
    enabled: sopIngredientIds.length > 0,
  });
  const sopViewer = useSopViewer("prep_meat");

  // Stock check state
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const stockCheckRef = useRef<HTMLDivElement>(null);
  const checkDate = nextPlan?.planDate ?? plan.planDate;

  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];

  const stockCheckActiveToday = (ing: PrepIngredientDetail): boolean => {
    if (!ing.stockCheckEnabled) return false;
    if (ing.stockCheckFrequency === "weekly") return ing.stockCheckDay === todayDayName;
    return true;
  };

  // Fetch existing stock checks
  const fetchStockChecks = useCallback(() => {
    if (!checkDate) return;
    fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d?.checks) {
          const serverVals: Record<number, string> = {};
          for (const c of d.checks) {
            // 0 is a real count ("nothing left") — keep it.
            if (c.quantity != null && c.quantity !== "") serverVals[c.ingredientId] = String(parseFloat(c.quantity));
          }
          setStockValues(serverVals);
        }
      })
      .catch(err => { console.warn("[RawMeat] Stock checks fetch failed:", err); });
  }, [checkDate]);

  useEffect(() => {
    if (!checkDate) return;
    fetchStockChecks();
    const interval = setInterval(fetchStockChecks, 5000);
    return () => clearInterval(interval);
  }, [fetchStockChecks]);

  // Check if ALL trays for an ingredient are done across ALL recipes
  const isIngredientFullyDone = (ingredientId: number): boolean => {
    for (const r of recipes) {
      for (const ing of r.ingredients) {
        if (ing.ingredientId !== ingredientId || !ing.isRawMeat) continue;
        if (!ing.trayCount) continue;
        for (let tn = 1; tn <= ing.trayCount; tn++) {
          if (!completions.some(c => c.ingredientId === ingredientId && c.recipeId === r.recipeId && c.tinNumber === tn)) {
            return false;
          }
        }
      }
    }
    return true;
  };


  // Completion helpers
  const isCompleted = (ingredientId: number, recipeId: number, trayNum: number) =>
    completions.some(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === trayNum);

  const getCompletion = (ingredientId: number, recipeId: number, trayNum: number) =>
    completions.find(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === trayNum);

  // Header progress in TASKS — each raw-meat ingredient per recipe is one
  // task (trays as detail); the shared helper the dashboard tile and
  // Prepping For hub use, fed the same responses (13 Oct).
  const progress = rawMeatProgress({ recipes, completions });
  const overallPct = progressPct(progress);
  const prepTarget = prepTargetOf(nextPlan, plan);
  const tabs = (
    <PrepSectionTabs
      planId={plan.id}
      current="prep_meat"
      progressPlanId={targetPlanId ?? plan.id}
      currentProgress={noFuturePlan ? null : progress}
      checkDate={checkDate}
      prepTarget={prepTarget}
    />
  );

  // The opened recipe's panel — under the list on an upright iPad, so
  // opening a recipe brings it into view.
  const detailRef = useRef<HTMLDivElement>(null);
  const showOpenedRecipe = () => requestAnimationFrame(() => {
    const el = detailRef.current;
    if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Nothing opens by itself: a recipe's meat amounts and trays show once
  // someone taps it (Graeme, 27 Oct 2026). One that drops off the list closes.
  useEffect(() => {
    if (selectedRecipeId != null && !recipes.some(r => r.recipeId === selectedRecipeId)) setSelectedRecipeId(null);
  }, [recipes, selectedRecipeId]);

  // Prep timing: the selected recipe's meats that still have trays to fill,
  // each timed for this recipe. A finished recipe being looked at isn't prep.
  const timedMeats = useMemo<PrepSessionItem[]>(() => {
    if (stockTabOpen) return [];
    const sel = recipes.find(r => r.recipeId === selectedRecipeId);
    if (!sel) return [];
    return sel.ingredients
      .filter(i => i.isRawMeat && (i.trayCount ?? 0) > 0)
      .filter(i => Array.from({ length: i.trayCount ?? 0 }, (_, k) => k + 1).some(tn => !isCompleted(i.ingredientId, sel.recipeId, tn)))
      .map(i => ({ ingredientId: i.ingredientId, recipeId: sel.recipeId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isCompleted reads completions
  }, [stockTabOpen, recipes, selectedRecipeId, completions]);
  const timedMeatsKey = timedMeats.map(prepItemKey).join(",");
  useEffect(() => {
    timing.focus(timedMeats);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timedMeatsKey is timedMeats' identity
  }, [timing, timedMeatsKey]);

  /** What one tray holds, as the tray button shows it (pieces or kg). */
  const trayQuantity = (ingredientId: number, recipeId: number): { quantity: number | null; unit: string | null } => {
    const ing = recipes.find(r => r.recipeId === recipeId)?.ingredients.find(i => i.ingredientId === ingredientId && i.isRawMeat);
    const trays = ing?.trayCount ?? 0;
    if (!ing || trays <= 0) return { quantity: null, unit: null };
    if (ing.pieceCount != null && ing.pieceCount > 0) return { quantity: Math.ceil(ing.pieceCount / trays), unit: "pieces" };
    return { quantity: toKg(ing.rawQty, ing.unit) / trays, unit: "kg" };
  };

  const [trayPending, setTrayPending] = useState<string | null>(null);

  const toggleTray = async (ingredientId: number, recipeId: number, trayNum: number) => {
    if (isOnBreak) return;
    if (isDraft) { toastDraftBlocked(); return; }
    const pendingKey = `${ingredientId}-${recipeId}-${trayNum}`;
    if (trayPending === pendingKey) return;
    setTrayPending(pendingKey);
    try {
      const existing = getCompletion(ingredientId, recipeId, trayNum);
      if (existing) {
        const res = await fetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber: trayNum }),
        });
        if (res.ok) timing.unticked({ ingredientId });
      } else {
        const res = await fetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber: trayNum }),
        });
        // Saved — time it against the session open on this meat (background).
        if (res.ok) timing.ticked({ ingredientId, recipeId, tinNumber: trayNum, ...trayQuantity(ingredientId, recipeId) });
      }
      refetch();
    } finally {
      setTrayPending(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (noFuturePlan) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Beef className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
          <p className="text-muted-foreground text-sm">
            There is no upcoming active production plan to prep for.
            Create and activate a future plan to see prep requirements here.
          </p>
        </div>
      </div>
    );
  }

  if (stockTabOpen) {
    return (
      <div className="space-y-4">
        <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />
        {tabs}
        <PrepStockCheckTabBody checkDate={checkDate} prepTarget={prepTarget} />
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <div className="space-y-4">
        {tabs}
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No raw meat ingredients to prep</p>
          <p className="text-sm mt-1">Set ingredient category to "raw_meat" in the ingredients library</p>
        </div>
      </div>
    );
  }

  // The opened recipe — null until someone taps one.
  const selected = recipes.find(r => r.recipeId === selectedRecipeId) ?? null;
  const selRawMeat = selected ? selected.ingredients.filter(i => i.isRawMeat) : [];
  const selMarinades = selected?.marinades ?? [];
  // Linked-ingredient stock checks belong to THIS recipe's meat panels only —
  // another recipe's links never render here (Graeme, 2026-09-24).
  const selLinkedChecks = linkedStockChecksForRecipe(selRawMeat.map(i => i.ingredientId), selMarinades);
  const selTotalRawKg = selRawMeat.reduce((sum, i) => sum + toKg(i.rawQty, i.unit), 0);
  const selTotalMarinadeG = selMarinades.reduce((sum, m) => sum + m.totalGrams, 0);
  const selTrayCapKg = selRawMeat.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;

  // Per-recipe tray completion count
  const recipeCompletedTrays = (r: PrepRecipeDetail) => {
    return r.ingredients.filter(i => i.isRawMeat).reduce((s, ing) => {
      if (!ing.trayCount) return s;
      return s + Array.from({ length: ing.trayCount }, (_, i) => i + 1)
        .filter(tn => isCompleted(ing.ingredientId, r.recipeId, tn)).length;
    }, 0);
  };

  const recipeTrays = (r: PrepRecipeDetail) =>
    r.ingredients.filter(i => i.isRawMeat).reduce((s, i) => s + (i.trayCount ?? 0), 0);

  const selCompletedTrays = selected ? recipeCompletedTrays(selected) : 0;
  const selTotalTrays = selected ? recipeTrays(selected) : 0;
  const selAllDone = selTotalTrays > 0 && selCompletedTrays >= selTotalTrays;

  return (
    <div className="space-y-4">
      {isDraft && nextPlan?.planId != null && nextPlan?.planDate && (
        <PrepDraftBanner
          planId={nextPlan.planId}
          planDate={nextPlan.planDate}
          planName={nextPlan.planName}
        />
      )}
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />

      {tabs}
      {sopViewer.dialog}
      {replenishTarget && (
        <SubRecipeReplenishModal
          target={replenishTarget}
          onClose={() => setReplenishTarget(null)}
          timing={isDraft ? undefined : { planId: targetPlanId, station: "prep_meat" }}
        />
      )}


      {/* Summary bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Beef className="w-6 h-6 text-rose-500" />
            <div>
              <h2 className="font-semibold text-base">Raw Meat Prep</h2>
              <p className="text-sm text-muted-foreground">
                {tasksLine(progress)} done · {progress.units.done} of {progress.units.total} tray{progress.units.total !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display text-rose-600 dark:text-rose-400">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-rose-500" : "bg-rose-400")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Split panel */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Left: recipe list */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center justify-between gap-2">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
              <button
                type="button"
                onClick={() => setHideCompleted(v => !v)}
                className={cn(
                  "text-xs font-medium px-2 py-1 rounded-md border transition-colors",
                  hideCompleted
                    ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )}
              >
                {hideCompleted ? "Show all" : "Hide completed"}
              </button>
            </div>
            <div className="divide-y divide-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              {recipes.map(recipe => {
                const rTotal = recipeTrays(recipe);
                const rDone = recipeCompletedTrays(recipe);
                const rAllDone = rTotal > 0 && rDone >= rTotal;
                const isSelected = recipe.recipeId === selected?.recipeId;
                if (hideCompleted && rAllDone && !isSelected) return null;
                return (
                  <button
                    key={recipe.recipeId}
                    onClick={() => { setSelectedRecipeId(recipe.recipeId); showOpenedRecipe(); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-l-4",
                      isSelected
                        ? "bg-rose-50/80 dark:bg-rose-900/20 border-l-rose-500"
                        : "hover:bg-secondary/40 border-l-transparent",
                      rAllDone && !isSelected && "opacity-60"
                    )}
                  >
                    <div className="flex-shrink-0">
                      {rAllDone ? (
                        <CheckCircle2 className="w-5 h-5 text-rose-500" />
                      ) : rTotal > 0 ? (
                        <div className="relative w-5 h-5">
                          <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-border" />
                            {rDone > 0 && (
                              <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2.5"
                                className="text-rose-500"
                                strokeDasharray={`${(rDone / rTotal) * 43.98} 43.98`}
                              />
                            )}
                          </svg>
                        </div>
                      ) : (
                        <Beef className={cn("w-5 h-5", isSelected ? "text-rose-500" : "text-muted-foreground")} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        "text-base font-medium truncate",
                        isSelected && "font-semibold",
                        rAllDone && "line-through text-muted-foreground"
                      )}>
                        {recipe.recipeName}
                        {(sopLinksByRecipe?.[recipe.recipeId] ?? []).length > 0 && (
                          <BookOpen className="w-4 h-4 inline ml-1.5 mb-0.5 text-primary" aria-label="Has SOP" />
                        )}
                      </p>
                    </div>
                    {/* Status only (the ring) — tray counts and weights
                        show once the recipe is opened. */}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: the opened recipe — its meat amounts and tray ticks (only here) */}
        <div ref={detailRef} className="flex-1 min-w-0 scroll-mt-4">
          {!selected ? (
            <div className="bg-card border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Beef className="w-12 h-12 mb-3 opacity-40" />
              <p className="text-xl font-semibold text-foreground">Tap a recipe to open it</p>
              <p className="text-base mt-1">Its meat, the weights and the trays to tick show here.</p>
            </div>
          ) : (
          <div className={cn(
            "bg-card border-2 rounded-2xl p-6 transition-colors",
            selAllDone
              ? "border-rose-400 dark:border-rose-600 bg-rose-50/20 dark:bg-rose-950/10"
              : "border-rose-300 dark:border-rose-700"
          )}>

            {/* Header */}
            <div className="mb-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">Currently Prepping</p>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {selAllDone && <CheckCircle2 className="w-6 h-6 text-rose-500 flex-shrink-0" />}
                  <h2 className={cn("font-display text-xl font-semibold leading-tight text-muted-foreground", selAllDone && "line-through")}>
                    {selected.recipeName}
                  </h2>
                </div>
                {selected.sopUrl && (
                  <a href={selected.sopUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 mt-1">
                    SOP <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-base text-muted-foreground mt-1">{formatBatches(selected.batchesTarget)} batch{selected.batchesTarget !== 1 ? "es" : ""}</p>
              <div className="mt-2">
                <SopChips
                  links={sopLinksByRecipe?.[selected.recipeId] ?? []}
                  onOpen={sopViewer.open}
                  attach={{ targetType: "recipe", a: selected.recipeId, text: "prep_meat", label: selected.recipeName, station: "prep_meat" }}
                  queryKeysToInvalidate={[sopRecipesKey]}
                />
              </div>
            </div>

            {/* Summary bar — total trays */}
            {selTotalTrays > 0 && (
              <div className="flex items-center gap-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl px-5 py-3 mb-5">
                <div className="text-center min-w-[56px]">
                  <p className="text-4xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400 leading-none">
                    {selCompletedTrays}<span className="text-2xl text-muted-foreground font-normal">/{selTotalTrays}</span>
                  </p>
                  <p className="text-sm font-medium text-rose-700 dark:text-rose-300 mt-0.5">tray{selTotalTrays !== 1 ? "s" : ""} done</p>
                </div>
                <div className="h-8 w-px bg-rose-200 dark:bg-rose-700" />
                <div>
                  <p className="text-base font-semibold tabular-nums">{selTotalRawKg.toFixed(3)} kg raw meat</p>
                  {selTotalMarinadeG > 0 && (
                    <p className="text-sm text-muted-foreground">+ {formatPrepWeight(selTotalMarinadeG, "g")} linked</p>
                  )}
                  {selRawMeat.length > 1 && <p className="text-sm text-rose-600 dark:text-rose-400 font-medium mt-0.5">across {selRawMeat.length} meat types</p>}
                </div>
              </div>
            )}

            {/* No tray capacity warning */}
            {selTotalTrays === 0 && (
              <div className="mb-5 space-y-3">
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Raw Meat</p>
                    <p className="text-5xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400">
                      {selTotalRawKg.toFixed(3)}
                      <span className="text-2xl font-normal ml-1 text-muted-foreground">kg</span>
                    </p>
                  </div>
                  {selTotalMarinadeG > 0 && (
                    <div className="text-center">
                      <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Linked</p>
                      <p className="text-3xl font-bold font-display tabular-nums text-orange-500">
                        {selTotalMarinadeG >= 1000 ? `${(Math.round(selTotalMarinadeG) / 1000).toFixed(3)}` : Math.round(selTotalMarinadeG)}
                        <span className="text-xl font-normal ml-1 text-muted-foreground">{selTotalMarinadeG >= 1000 ? "kg" : "g"}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
                  <span className="mt-0.5">⚠️</span>
                  <span>Tray count not set — add a <strong>Tray Capacity (kg)</strong> to this recipe's raw meat ingredients in the Ingredients Library to see per-tray breakdown.</span>
                </div>
              </div>
            )}

            {/* Per-ingredient tray task cards */}
            <div className="space-y-4">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {selTotalTrays > 0 ? "Tap each tray to mark it complete" : "Ingredients"}
              </p>
              {selRawMeat.map(ing => {
                const meatMarinades = selMarinades.filter(m => m.rawMeatIngredientId === ing.ingredientId);
                const ingKgTotal = toKg(ing.rawQty, ing.unit);
                const ingTrays = ing.trayCount;
                const perTrayKg = ingTrays && ingTrays > 0 ? ingKgTotal / ingTrays : null;
                // Piece-counted ingredients (Pigs & Blankets etc.) display
                // as whole pieces instead of kg — kg stays visible as a
                // secondary line for tray packing context.
                const usePieces = ing.pieceCount != null && ing.pieceCount > 0;
                const perTrayPieces = usePieces && ingTrays && ingTrays > 0
                  ? Math.ceil((ing.pieceCount ?? 0) / ingTrays)
                  : null;
                const ingMarinadeG = meatMarinades.reduce((s, m) => s + m.totalGrams, 0);
                const trayNums = ingTrays ? Array.from({ length: ingTrays }, (_, i) => i + 1) : [];
                const ingDone = trayNums.filter(tn => isCompleted(ing.ingredientId, selected.recipeId, tn)).length;
                const ingAllDone = trayNums.length > 0 && ingDone >= trayNums.length;

                return (
                  <div key={ing.ingredientId} className="rounded-xl border-2 border-rose-200 dark:border-rose-800 overflow-hidden">
                    {/* Meat header */}
                    <div className={cn(
                      "flex items-center gap-3 px-4 py-3",
                      ingAllDone ? "bg-rose-100 dark:bg-rose-900/30" : "bg-rose-50 dark:bg-rose-900/20"
                    )}>
                      {ingTrays != null && ingTrays > 0 ? (
                        <>
                          <div className={cn(
                            "text-center rounded-lg px-3 py-1.5 min-w-[52px]",
                            ingAllDone ? "bg-rose-500 text-white" : "bg-rose-600 text-white"
                          )}>
                            <p className="text-2xl font-bold font-display tabular-nums leading-none">{ingDone}<span className="text-sm opacity-70">/{ingTrays}</span></p>
                            <p className="text-sm opacity-80">tray{ingTrays !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              {ingAllDone && <CheckCircle2 className="w-5 h-5 text-rose-500" />}
                              <p className={cn("font-bold text-2xl leading-tight", ingAllDone && "line-through text-muted-foreground")}>{ing.ingredientName}</p>
                            </div>
                            {usePieces ? (
                              <p className="text-sm text-muted-foreground tabular-nums">
                                {ing.pieceCount} pieces total
                                <span className="opacity-70"> · {ingKgTotal.toFixed(3)} kg</span>
                                {ing.rawMeatTrayCapacityKg && ` · ${ing.rawMeatTrayCapacityKg} kg cap`}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground tabular-nums">
                                {ingKgTotal.toFixed(3)} kg total
                                {ing.rawMeatTrayCapacityKg && ` · ${ing.rawMeatTrayCapacityKg} kg cap`}
                              </p>
                            )}
                            {!usePieces && <MixExtraNote qty={ing.mixExtraQty} unit={ing.unit} />}
                          </div>
                          <div className="text-right">
                            {usePieces ? (
                              <>
                                <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-none">{perTrayPieces} pieces</p>
                                <p className="text-sm text-muted-foreground mt-0.5">per tray</p>
                              </>
                            ) : (
                              <>
                                <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-none">{perTrayKg!.toFixed(3)} kg</p>
                                <p className="text-sm text-muted-foreground mt-0.5">per tray</p>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-between">
                          <p className="font-bold text-2xl leading-tight">{ing.ingredientName}</p>
                          {usePieces ? (
                            <p className="tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{ing.pieceCount} pieces</p>
                          ) : (
                            <div className="text-right">
                              <p className="tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{ingKgTotal.toFixed(3)} kg</p>
                              <MixExtraNote qty={ing.mixExtraQty} unit={ing.unit} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* SOPs for this meat — "Show me how" at the point of
                        prep — and the one-tap ingredient label: opening the
                        bag is exactly when the label gets printed. */}
                    <div className="px-4 py-2 border-t border-rose-100 dark:border-rose-900/40 bg-white dark:bg-background/50 flex items-start justify-between gap-2">
                      <SopChips
                        links={(sopLinksByIngredient?.[ing.ingredientId] ?? []).filter(l => l.scope === "ingredient" || l.recipeId === selected.recipeId)}
                        onOpen={sopViewer.open}
                        attach={[
                          { targetType: "ingredient", a: ing.ingredientId, text: "prep_meat", label: "Everywhere", subject: ing.ingredientName },
                          { targetType: "recipe_ingredient", a: selected.recipeId, b: ing.ingredientId, text: "prep_meat", label: `Only ${selected.recipeName}` },
                        ]}
                        queryKeysToInvalidate={[sopIngredientsKey]}
                      />
                      <PrintIngredientLabelButton ingredientId={ing.ingredientId} itemName={ing.ingredientName} className="flex-shrink-0" />
                    </div>

                    {/* Linked ingredient sub-rows. Add-at-cooking items are NOT
                        in the add-list — they're held back for the mixing
                        station on production day (pouring them in today is
                        exactly the mistake this exists to prevent). They still
                        count in the tray sizing, so a clearly-marked hold-back
                        row keeps the tray maths explainable. */}
                    {meatMarinades.filter(m => !m.addAtCooking).map((m, mi) => {
                      const name = m.marinadeIngredientName ?? m.marinadeSubRecipeName ?? "Unknown";
                      const perTrayG = ingTrays && ingTrays > 0 ? Math.round(m.totalGrams / ingTrays) : null;
                      return (
                        <div key={mi} className="flex items-center justify-between px-4 py-2 border-t border-rose-100 dark:border-rose-900/40 text-sm text-muted-foreground bg-white dark:bg-background/50">
                          <span className="flex items-center gap-2">
                            <span className="text-rose-400">↳</span>
                            {/* A sub-recipe rub/marinade is a link: tap to
                                replenish it right here (Graeme, 2026-09-08).
                                Dotted underline, not hover-only — iPad. */}
                            {m.marinadeSubRecipeId != null ? (
                              <button
                                onClick={() => setReplenishTarget({ subRecipeId: m.marinadeSubRecipeId!, name })}
                                className="underline decoration-dotted underline-offset-2 text-primary font-medium hover:decoration-solid text-left"
                                title={`Replenish ${name} without leaving this screen`}
                              >
                                {name}
                              </button>
                            ) : (
                              <span>{name}</span>
                            )}
                          </span>
                          <div className="text-right">
                            {perTrayG != null ? (
                              <>
                                <span className="tabular-nums font-semibold text-foreground">{perTrayG}g / tray</span>
                                <p className="text-sm text-muted-foreground">{m.totalGrams}g total</p>
                              </>
                            ) : (
                              <span className="tabular-nums font-medium text-foreground">{m.totalGrams}g</span>
                            )}
                            <MixExtraNote qty={m.mixExtraGrams} unit="g" />
                          </div>
                        </div>
                      );
                    })}
                    {/* Stock check for the LINKED ingredients, right under the
                        rows they belong to (Graeme, 2026-09-16) — white onions
                        is counted here, inside the beef panel, not adrift at
                        the bottom of the page. Held back until the meat's trays
                        are done everywhere, mirroring the meat's own check
                        below: counting what's left before you've used it is
                        just a number you'll have to take again. */}
                    <StationStockChecks
                      variant="row"
                      ready={isIngredientFullyDone(ing.ingredientId)}
                      notReadyHint={`Stock check once the ${ing.ingredientName.toLowerCase()} trays are done`}
                      checkDate={nextPlan?.planDate ?? plan.planDate}
                      isDraft={isDraft}
                      stationLabel="Raw Meat"
                      ingredientIds={selLinkedChecks.byMeat.get(ing.ingredientId)?.afterPrep ?? []}
                    />

                    {meatMarinades.filter(m => m.addAtCooking).map((m, mi) => {
                      const name = m.marinadeIngredientName ?? m.marinadeSubRecipeName ?? "Unknown";
                      return (
                        <div key={`aac-${mi}`} className="flex items-center justify-between px-4 py-2 border-t border-amber-300/60 dark:border-amber-700/60 text-sm bg-amber-50 dark:bg-amber-950/30">
                          <span className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                            <span>✋</span>
                            {m.marinadeSubRecipeId != null ? (
                              <span>
                                <button
                                  onClick={() => setReplenishTarget({ subRecipeId: m.marinadeSubRecipeId!, name })}
                                  className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                  title={`Replenish ${name} without leaving this screen`}
                                >
                                  {name}
                                </button>
                                {" — do NOT add today"}
                              </span>
                            ) : (
                              <span>{name} — do NOT add today</span>
                            )}
                          </span>
                          <span className="text-right text-amber-800/80 dark:text-amber-300/80">
                            goes in at cooking tomorrow · {formatPrepWeight(m.totalGrams, "g")} (counted in trays)
                            <MixExtraNote qty={m.mixExtraGrams} unit="g" />
                          </span>
                        </div>
                      );
                    })}
                    {/* Held-back items are counted beside their hold-back row:
                        nothing on this station uses them, so there's nothing to
                        wait for. Still inside this meat's panel, never adrift. */}
                    <StationStockChecks
                      variant="row"
                      checkDate={nextPlan?.planDate ?? plan.planDate}
                      isDraft={isDraft}
                      stationLabel="Raw Meat"
                      ingredientIds={selLinkedChecks.byMeat.get(ing.ingredientId)?.heldBack ?? []}
                    />

                    {/* Clickable tray buttons */}
                    {trayNums.length > 0 && (
                      <div className="px-4 pb-4 pt-3 bg-background/50 border-t border-rose-100 dark:border-rose-900/40">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                          {trayNums.map(tn => {
                            const done = isCompleted(ing.ingredientId, selected.recipeId, tn);
                            const completion = getCompletion(ing.ingredientId, selected.recipeId, tn);
                            return (
                              <button
                                key={tn}
                                onClick={() => toggleTray(ing.ingredientId, selected.recipeId, tn)}
                                disabled={isOnBreak || trayPending === `${ing.ingredientId}-${selected.recipeId}-${tn}`}
                                className={cn(
                                  "relative flex flex-col items-center border-2 rounded-2xl px-3 py-3.5 transition-all active:scale-95",
                                  isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                  done
                                    ? "bg-rose-50 dark:bg-rose-900/30 border-rose-400 dark:border-rose-600 shadow-sm"
                                    : "bg-background border-border hover:border-rose-400 hover:shadow-md"
                                )}
                              >
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  {done ? (
                                    <CheckCircle2 className="w-4 h-4 text-rose-500" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />
                                  )}
                                  <span className="text-base font-bold">Tray {tn}</span>
                                </div>
                                {usePieces && perTrayPieces != null ? (
                                  <span className={cn("text-xl font-bold tabular-nums", done ? "text-rose-600 dark:text-rose-300" : "text-foreground")}>
                                    {perTrayPieces} pieces
                                  </span>
                                ) : perTrayKg != null && (
                                  <span className={cn("text-xl font-bold tabular-nums", done ? "text-rose-600 dark:text-rose-300" : "text-foreground")}>
                                    {perTrayKg.toFixed(3)} kg
                                  </span>
                                )}
                                {done && completion && (
                                  <span className="text-xs text-rose-600 dark:text-rose-400 mt-1 leading-tight text-center">
                                    {completion.userName ?? "Done"} · {format(new Date(completion.completedAt), "HH:mm")}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Stock check — shown when all trays for this ingredient are done across all recipes */}
                    {stockCheckActiveToday(ing) && (() => {
                      const allDoneGlobal = isIngredientFullyDone(ing.ingredientId);
                      const stockSaved = stockValues[ing.ingredientId] !== undefined && stockValues[ing.ingredientId] !== "";
                      if (!allDoneGlobal) {
                        return ingAllDone ? (
                          <div className="px-4 pb-3 bg-blue-50/30 dark:bg-blue-950/10 border-t border-blue-200/50 dark:border-blue-800/50">
                            <div className="flex items-center gap-2 py-2">
                              <Package className="w-4 h-4 text-blue-400" />
                              <p className="text-sm text-blue-600 dark:text-blue-400">Stock check after all recipes completed</p>
                            </div>
                          </div>
                        ) : null;
                      }
                      return (
                        <div ref={stockCheckRef} className="px-4 pb-4 pt-3 bg-blue-50/70 dark:bg-blue-950/30 border-t-2 border-blue-400 dark:border-blue-600">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Package className={cn("w-5 h-5 text-blue-600", !stockSaved && "animate-pulse")} />
                            <div className="flex-1 min-w-[10rem]">
                              <p className="text-lg font-bold text-blue-800 dark:text-blue-200">Stock Check</p>
                              <p className="text-sm text-blue-600 dark:text-blue-400">
                                {stockSaved ? "Counted — tap to recount if it's changed." : `How much ${ing.ingredientName.toLowerCase()} is left?`}
                              </p>
                            </div>
                            <StockCheckButton
                              ingredient={{ id: ing.ingredientId, name: ing.ingredientName, unit: ing.unit, packWeight: ing.packWeight }}
                              checkDate={checkDate}
                              isDraft={isDraft}
                              currentNative={stockSaved ? Number(stockValues[ing.ingredientId]) : null}
                              onSaved={native => {
                                setStockValues(v => ({ ...v, [ing.ingredientId]: String(native) }));
                                fetchStockChecks();
                              }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              {/* A link in THIS recipe whose meat isn't one of its raw-meat
                  rows (a stale link) has no meat panel — count it at the foot
                  of this recipe's card rather than lose it. There is no
                  page-level catch-all any more: that one took every recipe's
                  links, so opening any other recipe showed them at the bottom
                  of the page (Graeme, 2026-09-24). */}
              <StationStockChecks
                checkDate={nextPlan?.planDate ?? plan.planDate}
                isDraft={isDraft}
                stationLabel={selected.recipeName}
                ingredientIds={selLinkedChecks.unplaced}
              />
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
