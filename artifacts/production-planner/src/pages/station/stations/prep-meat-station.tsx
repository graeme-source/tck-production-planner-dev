import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  Loader2, CheckCircle2, Beef, ExternalLink, Package, Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, PrepDraftBanner, toKg, toastDraftBlocked } from "../shared/prep-helpers";
import { PrepSubNav, usePrepByRecipe } from "./prep-hub";
import type { PrepRecipeDetail, PrepIngredientDetail } from "./prep-hub";

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
  const { recipes, isLoading, nextPlan, targetPlanId, noFuturePlan } = usePrepByRecipe("prep_meat", plan.id, plan.planDate);
  const isDraft = nextPlan?.status === "draft";
  const { completions, refetch } = usePrepMeatCompletions(targetPlanId ?? plan.id);

  // Stock check state
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [savingStock, setSavingStock] = useState<Record<number, boolean>>({});
  const dirtyStockIds = useRef<Set<number>>(new Set());
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
            if (c.quantity) serverVals[c.ingredientId] = String(parseFloat(c.quantity));
          }
          setStockValues(prev => {
            const merged = { ...serverVals };
            for (const id of dirtyStockIds.current) {
              if (id in prev) merged[id] = prev[id];
            }
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [checkDate]);

  useEffect(() => {
    if (!checkDate) return;
    fetchStockChecks();
    const interval = setInterval(fetchStockChecks, 5000);
    return () => clearInterval(interval);
  }, [fetchStockChecks]);

  const saveStockCheck = async (ingredientId: number) => {
    const val = stockValues[ingredientId];
    if (val === undefined || val === "") return;
    if (isDraft) { toastDraftBlocked(); return; }
    setSavingStock(s => ({ ...s, [ingredientId]: true }));
    try {
      await fetch("/api/production-plans/stock-checks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate, quantity: Number(val) }),
      });
      dirtyStockIds.current.delete(ingredientId);
      toast({ title: "Stock check saved" });
    } catch {
      toast({ title: "Failed to save stock check", variant: "destructive" });
    }
    setSavingStock(s => ({ ...s, [ingredientId]: false }));
  };

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

  const totalTrays = recipes.reduce((sum, r) => sum + (r.trayCount ?? 0), 0);

  // Completion helpers
  const isCompleted = (ingredientId: number, recipeId: number, trayNum: number) =>
    completions.some(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === trayNum);

  const getCompletion = (ingredientId: number, recipeId: number, trayNum: number) =>
    completions.find(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === trayNum);

  // Counts
  const completedTrays = recipes.reduce((sum, r) => {
    return sum + r.ingredients.filter(i => i.isRawMeat).reduce((s, ing) => {
      if (!ing.trayCount) return s;
      return s + Array.from({ length: ing.trayCount }, (_, i) => i + 1)
        .filter(tn => isCompleted(ing.ingredientId, r.recipeId, tn)).length;
    }, 0);
  }, 0);

  const overallPct = totalTrays > 0 ? Math.round((completedTrays / totalTrays) * 100) : 0;

  // Auto-select first recipe
  useEffect(() => {
    if (recipes.length > 0 && (selectedRecipeId === null || !recipes.some(r => r.recipeId === selectedRecipeId))) {
      setSelectedRecipeId(recipes[0].recipeId);
    }
  }, [recipes, selectedRecipeId]);

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
        await fetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber: trayNum }),
        });
      } else {
        await fetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber: trayNum }),
        });
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
        <PrepSubNav planId={plan.id} current="prep_meat" />
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

  const selCompletedTrays = recipeCompletedTrays(selected);
  const selTotalTrays = recipeTrays(selected);
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

      <PrepSubNav planId={plan.id} current="prep_meat" />

      {/* Summary bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Beef className="w-6 h-6 text-rose-500" />
            <div>
              <h2 className="font-semibold text-base">Raw Meat Prep</h2>
              <p className="text-sm text-muted-foreground">
                {completedTrays} of {totalTrays} tray{totalTrays !== 1 ? "s" : ""} completed
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
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
            </div>
            <div className="divide-y divide-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              {recipes.map(recipe => {
                const rTotal = recipeTrays(recipe);
                const rDone = recipeCompletedTrays(recipe);
                const rAllDone = rTotal > 0 && rDone >= rTotal;
                const isSelected = recipe.recipeId === selected.recipeId;
                return (
                  <button
                    key={recipe.recipeId}
                    onClick={() => setSelectedRecipeId(recipe.recipeId)}
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
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {rTotal > 0 && (
                        <span className={cn(
                          "text-sm tabular-nums",
                          rAllDone ? "text-rose-600 font-semibold" : "text-muted-foreground"
                        )}>
                          {rDone}/{rTotal}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: selected recipe detail */}
        <div className="flex-1 min-w-0">
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
                  <h2 className={cn("font-display text-3xl font-bold leading-tight", selAllDone && "line-through text-muted-foreground")}>
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
              <p className="text-base text-muted-foreground mt-1">{selected.batchesTarget} batch{selected.batchesTarget !== 1 ? "es" : ""}</p>
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
                    <p className="text-sm text-muted-foreground">+ {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(3)} kg` : `${selTotalMarinadeG}g`} linked</p>
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
                        {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(3)}` : selTotalMarinadeG}
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
                              {ingAllDone && <CheckCircle2 className="w-4 h-4 text-rose-500" />}
                              <p className={cn("font-semibold", ingAllDone && "line-through text-muted-foreground")}>{ing.ingredientName}</p>
                            </div>
                            <p className="text-sm text-muted-foreground tabular-nums">
                              {ingKgTotal.toFixed(3)} kg total
                              {ing.rawMeatTrayCapacityKg && ` · ${ing.rawMeatTrayCapacityKg} kg cap`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-none">{perTrayKg!.toFixed(3)} kg</p>
                            <p className="text-sm text-muted-foreground mt-0.5">per tray</p>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-between">
                          <p className="font-semibold">{ing.ingredientName}</p>
                          <p className="tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{ingKgTotal.toFixed(3)} kg</p>
                        </div>
                      )}
                    </div>

                    {/* Linked ingredient sub-rows */}
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
                                <p className="text-sm text-muted-foreground">{m.totalGrams}g total</p>
                              </>
                            ) : (
                              <span className="tabular-nums font-medium text-foreground">{m.totalGrams}g</span>
                            )}
                          </div>
                        </div>
                      );
                    })}

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
                                {perTrayKg != null && (
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
                          <div className="flex items-center gap-2 mb-3">
                            <Package className="w-5 h-5 text-blue-600 animate-pulse" />
                            <p className="text-lg font-bold text-blue-800 dark:text-blue-200">Stock Check</p>
                            <p className="text-sm text-blue-600 dark:text-blue-400">— how much {ing.ingredientName.toLowerCase()} remains?</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number" step="0.01"
                              placeholder={`Remaining ${ing.unit}`}
                              className="flex-1 max-w-[160px] text-base border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 py-2 text-right bg-background focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                              value={stockValues[ing.ingredientId] ?? ""}
                              onChange={e => { dirtyStockIds.current.add(ing.ingredientId); setStockValues(v => ({ ...v, [ing.ingredientId]: e.target.value })); }}
                              onKeyDown={e => { if (e.key === "Enter") saveStockCheck(ing.ingredientId); }}
                            />
                            <span className="text-base text-muted-foreground">{ing.unit}</span>
                            <button
                              onClick={() => saveStockCheck(ing.ingredientId)}
                              disabled={!stockValues[ing.ingredientId] || savingStock[ing.ingredientId]}
                              className={cn(
                                "px-4 py-2 rounded-lg text-base font-bold transition-all",
                                stockValues[ing.ingredientId]
                                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow active:scale-95"
                                  : "bg-blue-200 text-blue-400 cursor-not-allowed"
                              )}
                            >
                              {savingStock[ing.ingredientId] ? <Loader2 className="w-4 h-4 animate-spin" /> : stockSaved ? <Check className="w-4 h-4" /> : "Save"}
                            </button>
                          </div>
                          {stockSaved && (
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {stockValues[ing.ingredientId]} {ing.unit} recorded
                            </p>
                          )}
                        </div>
                      );
                    })()}
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
