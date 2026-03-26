import React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  ClipboardList, Loader2, CheckCircle2, Package, Plus, Minus, Check, Snowflake,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, useNextActivePlan, fmtQty } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";
import { PrepSubNav } from "./prep-hub";

export interface MainPrepIngredient {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  totalQty: number;
  totalTinCount: number;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    qtyForRecipe: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    tinCount: number;
    qtyPerTin: number;
  }>;
}

interface PrepTinCompletion {
  id: number;
  ingredientId: number;
  recipeId: number;
  tinNumber: number;
  userId: number | null;
  userName: string | null;
  completedAt: string;
}

type PrepPresenceData = Record<number, { userId: number; userName: string }[]>;

interface StockCheckEntry {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: string | null;
  checkedAt: string;
  userId: number | null;
}

export function useMainPrepData(planId: number, station: string = "main_prep") {
  const [data, setData] = useState<{ ingredients: MainPrepIngredient[]; completions: PrepTinCompletion[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setLoading(true);
    fetch(`/api/production-plans/${planId}/main-prep?station=${station}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d); initialLoadDone.current = true; setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setLoading(false); } });
  }, [planId, station]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  const refetch = useCallback(() => doFetch(), [doFetch]);
  return { data, loading, refetch };
}

export function MainPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const { data: nextPlanData, isLoading: isNextPlanLoading } = useNextActivePlan(plan.planDate);
  const nextPlan = nextPlanData as NextActivePlan | null;
  const targetPlanId = nextPlan?.planId ?? plan.id;
  const { data, loading, refetch } = useMainPrepData(targetPlanId);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [savingStock, setSavingStock] = useState<Record<number, boolean>>({});
  const dirtyStockIds = useRef<Set<number>>(new Set());
  const [selectedIngredientId, setSelectedIngredientId] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [presenceData, setPresenceData] = useState<PrepPresenceData>({});
  const activeIngIdRef = useRef<number | null>(null);
  const stockCheckRef = useRef<HTMLDivElement>(null);
  const prevNeedsStockCheckRef = useRef(false);

  const checkDate = nextPlan?.planDate ?? plan.planDate;

  useEffect(() => {
    setSelectedIngredientId(null);
    setStockValues({});
    dirtyStockIds.current.clear();
  }, [targetPlanId]);

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

  const postPresence = useCallback((ingredientId: number | null) => {
    fetch(`/api/production-plans/${targetPlanId}/prep-presence`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId }),
    }).catch(() => {});
  }, [targetPlanId]);

  // Poll presence every 10s
  useEffect(() => {
    const poll = () => {
      fetch(`/api/production-plans/${targetPlanId}/prep-presence`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPresenceData(d); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [targetPlanId]);

  // Heartbeat presence every 15s
  useEffect(() => {
    const hb = setInterval(() => postPresence(activeIngIdRef.current), 15_000);
    return () => { clearInterval(hb); postPresence(null); };
  }, [postPresence]);

  const ingredients = data?.ingredients ?? [];
  const completions = data?.completions ?? [];

  const isCompleted = (ingredientId: number, recipeId: number, tinNumber: number) =>
    completions.some(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber);

  const getCompletion = (ingredientId: number, recipeId: number, tinNumber: number) =>
    completions.find(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber);

  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];

  const stockCheckActiveToday = (ing: MainPrepIngredient): boolean => {
    if (!ing.stockCheckEnabled) return false;
    if (ing.stockCheckFrequency === "weekly") return ing.stockCheckDay === todayDayName;
    return true;
  };

  const ingredientDoneStatus = (ing: MainPrepIngredient) => {
    let totalTinCount = 0;
    let completedTinCount = 0;
    for (const r of ing.recipes) {
      totalTinCount += r.tinCount;
      for (let tn = 1; tn <= r.tinCount; tn++) {
        if (isCompleted(ing.ingredientId, r.recipeId, tn)) completedTinCount++;
      }
    }
    const allTinsDone = totalTinCount > 0 && completedTinCount >= totalTinCount;
    const stockSaved = stockValues[ing.ingredientId] !== undefined && stockValues[ing.ingredientId] !== "";
    const activeStockCheck = stockCheckActiveToday(ing);
    const needsStockCheck = activeStockCheck && allTinsDone;
    const isFullyDone = allTinsDone && (!activeStockCheck || stockSaved);
    return { allTinsDone, needsStockCheck, stockSaved, isFullyDone, totalTinCount, completedTinCount };
  };

  const recipeIngredientStatus = (ing: MainPrepIngredient, recipeId: number) => {
    const recipe = ing.recipes.find(r => r.recipeId === recipeId);
    if (!recipe) return { completedTins: 0, totalTins: 0, allDone: false };
    const totalTins = recipe.tinCount;
    const completedTins = Array.from({ length: totalTins }, (_, i) => i + 1)
      .filter(tn => isCompleted(ing.ingredientId, recipeId, tn)).length;
    return { completedTins, totalTins, allDone: totalTins > 0 && completedTins >= totalTins };
  };

  const getPreppedByInitials = (ingredientId: number, recipeId?: number): { initials: string; fullName: string }[] => {
    const seen = new Set<string>();
    const result: { initials: string; fullName: string }[] = [];
    for (const c of completions) {
      if (c.ingredientId !== ingredientId || !c.userName) continue;
      if (recipeId !== undefined && c.recipeId !== recipeId) continue;
      if (seen.has(c.userName)) continue;
      seen.add(c.userName);
      result.push({
        initials: c.userName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
        fullName: c.userName,
      });
    }
    return result;
  };

  // Build left-panel groups: recipe → list of {ingredient, qty for that recipe}
  // An ingredient may appear in multiple recipe groups if shared across recipes.
  const leftGroups = useMemo(() => {
    const map = new Map<number, {
      recipeId: number;
      recipeName: string;
      batchesTarget: number;
      items: Array<{ ing: MainPrepIngredient; qtyForRecipe: number }>;
    }>();
    for (const ing of ingredients) {
      for (const r of ing.recipes) {
        if (!map.has(r.recipeId)) {
          map.set(r.recipeId, { recipeId: r.recipeId, recipeName: r.recipeName, batchesTarget: r.batchesTarget, items: [] });
        }
        map.get(r.recipeId)!.items.push({ ing, qtyForRecipe: r.qtyForRecipe });
      }
    }
    return [...map.values()];
  }, [ingredients]);

  // Auto-select first incomplete ingredient
  useEffect(() => {
    if (ingredients.length === 0) return;
    if (selectedIngredientId && ingredients.find(i => i.ingredientId === selectedIngredientId)) return;
    const firstIncomplete = ingredients.find(ing => !ingredientDoneStatus(ing).isFullyDone);
    setSelectedIngredientId((firstIncomplete ?? ingredients[0]).ingredientId);
  }, [ingredients]);

  const selectedIngredient = ingredients.find(i => i.ingredientId === selectedIngredientId) ?? null;

  const selectedStatus = selectedIngredient ? ingredientDoneStatus(selectedIngredient) : null;
  useEffect(() => {
    prevNeedsStockCheckRef.current = false;
  }, [selectedIngredientId]);

  useEffect(() => {
    if (selectedStatus?.needsStockCheck && !selectedStatus.stockSaved && !prevNeedsStockCheckRef.current) {
      setTimeout(() => {
        stockCheckRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      toast({ title: `Stock check needed for ${selectedIngredient?.ingredientName ?? "this item"}` });
    }
    prevNeedsStockCheckRef.current = selectedStatus?.needsStockCheck ?? false;
  }, [selectedStatus?.needsStockCheck, selectedStatus?.stockSaved, selectedIngredient?.ingredientId]);

  const toggleTin = async (ingredientId: number, recipeId: number, tinNumber: number) => {
    if (isOnBreak) return;
    activeIngIdRef.current = ingredientId;
    postPresence(ingredientId);
    const existing = getCompletion(ingredientId, recipeId, tinNumber);
    if (existing) {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, recipeId, tinNumber }),
      });
    } else {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, recipeId, tinNumber }),
      });
    }
    refetch();
  };

  const saveStockCheck = async (ingredientId: number) => {
    const val = stockValues[ingredientId];
    if (val === undefined || val === "") return;
    setSavingStock(s => ({ ...s, [ingredientId]: true }));
    const cd = nextPlan?.planDate ?? plan.planDate;
    try {
      const resp = await fetch("/api/production-plans/stock-checks", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate: cd, quantity: Number(val) }),
      });
      if (!resp.ok) throw new Error("Save failed");
      dirtyStockIds.current.delete(ingredientId);
      toast({ title: "Stock check saved" });
      refetch();
    } catch {
      toast({ title: "Failed to save stock check", variant: "destructive" });
    } finally {
      setSavingStock(s => ({ ...s, [ingredientId]: false }));
    }
  };

  const [transferringId, setTransferringId] = useState<number | null>(null);

  const transferToFreezer = async (ingredientId: number, ingredientName: string, qty: number, unit: string) => {
    setTransferringId(ingredientId);
    try {
      const resp = await fetch("/api/stock-transfers", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId,
          fromLocation: "prep_fridge",
          toLocation: "production_freezer",
          quantity: qty,
          unit,
          notes: `Remaining after prep: ${ingredientName}`,
        }),
      });
      if (!resp.ok) throw new Error("Transfer failed");
      toast({ title: `Transferred ${qty} ${unit} of ${ingredientName} to Freezer` });
    } catch {
      toast({ title: "Transfer failed", variant: "destructive" });
    } finally {
      setTransferringId(null);
    }
  };

  const totalTins = ingredients.reduce((s, ing) => s + ing.totalTinCount, 0);
  const completedTins = completions.length;
  const overallPct = totalTins > 0 ? Math.round((completedTins / totalTins) * 100) : 0;

  if (loading || isNextPlanLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <PrepDateBanner
        currentPlanDate={plan.planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
        isLoading={false}
      />

      <PrepSubNav planId={plan.id} current="main_prep" />

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            <div>
              <h2 className="font-semibold text-base">Main Prep</h2>
              <p className="text-xs text-muted-foreground">{completedTins} of {totalTins} tins completed</p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-emerald-400")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={targetPlanId} stationType="main_prep" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {ingredients.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No ingredients to prep</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT — Ingredients grouped by recipe (menu + sub-items layout) */}
          <div className="lg:w-80 xl:w-96 flex-shrink-0">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ingredients by Recipe</p>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {leftGroups.map((group, gi) => (
                  <div key={group.recipeId} className={cn(gi > 0 && "border-t border-border")}>
                    {/* Recipe section header */}
                    <div className="px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 truncate">
                        {group.recipeName}
                      </p>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-2 whitespace-nowrap">
                        {group.batchesTarget} batch{group.batchesTarget !== 1 ? "es" : ""}
                      </span>
                    </div>
                    {group.items.map(({ ing, qtyForRecipe }) => {
                      const rStatus = recipeIngredientStatus(ing, group.recipeId);
                      const isSelected = ing.ingredientId === selectedIngredientId;
                      const presence = presenceData[ing.ingredientId] ?? [];
                      return (
                        <button
                          key={`${group.recipeId}-${ing.ingredientId}`}
                          onClick={() => {
                            setSelectedIngredientId(ing.ingredientId);
                            activeIngIdRef.current = ing.ingredientId;
                            postPresence(ing.ingredientId);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-t border-border/30",
                            isSelected
                              ? "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                              : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                            rStatus.allDone && !isSelected && "opacity-60"
                          )}
                        >
                          <div className="flex-shrink-0">
                            {rStatus.allDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : rStatus.totalTins > 0 ? (
                              <div className="relative w-4 h-4">
                                <svg className="w-4 h-4 -rotate-90" viewBox="0 0 16 16">
                                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                                  {rStatus.completedTins > 0 && (
                                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2"
                                      className="text-emerald-500"
                                      strokeDasharray={`${(rStatus.completedTins / rStatus.totalTins) * 37.7} 37.7`}
                                    />
                                  )}
                                </svg>
                              </div>
                            ) : (
                              <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn(
                              "text-sm font-medium truncate",
                              isSelected && "font-semibold",
                              rStatus.allDone && "line-through text-muted-foreground"
                            )}>
                              {ing.ingredientName}
                              {presence.length > 0 && <span className="ml-1 text-[10px] text-blue-500">👁</span>}
                            </p>
                            {ing.recipes.length > 1 && (
                              <p className="text-xs text-muted-foreground"><span className="text-amber-500">shared</span></p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {rStatus.completedTins > 0 && getPreppedByInitials(ing.ingredientId, group.recipeId).map(({ initials, fullName }) => (
                              <span
                                key={fullName}
                                title={fullName}
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[9px] font-bold leading-none"
                              >
                                {initials}
                              </span>
                            ))}
                            {rStatus.totalTins > 0 && (
                              <span className={cn(
                                "text-xs tabular-nums",
                                rStatus.allDone ? "text-emerald-600 font-semibold" : "text-muted-foreground"
                              )}>
                                {rStatus.completedTins}/{rStatus.totalTins}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT — Detail card for selected ingredient */}
          <div className="flex-1 min-w-0">
            {selectedIngredient ? (() => {
              const ing = selectedIngredient;
              const status = ingredientDoneStatus(ing);
              const presence = presenceData[ing.ingredientId] ?? [];
              const isShared = ing.recipes.length > 1;
              return (
              <div
                className={cn(
                  "bg-card border-2 rounded-2xl p-5 transition-colors",
                  status.isFullyDone
                    ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/20 dark:bg-emerald-950/10"
                    : status.needsStockCheck
                      ? "border-blue-300 dark:border-blue-700"
                      : "border-border"
                )}
              >
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {status.isFullyDone ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            ) : status.needsStockCheck ? (
                              <Package className="w-5 h-5 text-blue-500 flex-shrink-0 animate-pulse" />
                            ) : null}
                            <h3 className={cn(
                              "font-bold text-lg leading-tight",
                              status.isFullyDone && "line-through text-muted-foreground"
                            )}>
                              {ing.ingredientName}
                            </h3>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            <span className="font-semibold text-foreground">{fmtQty(ing.totalQty, ing.unit)}</span>
                            {" total · "}{status.completedTinCount}/{status.totalTinCount} tins done
                          </p>
                          {isShared && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              <span className="font-medium">Shared —</span>
                              {" in: "}{ing.recipes.map(r => r.recipeName).join(", ")}
                            </p>
                          )}
                          {presence.length > 0 && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                              👁 <span className="font-medium">{presence.map(p => p.userName).join(", ")}</span> also viewing this
                            </p>
                          )}
                        </div>
                        {status.totalTinCount > 0 && (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-foreground"
                            )}>
                              {status.completedTinCount}
                              <span className="text-base text-muted-foreground font-normal">/{status.totalTinCount}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">tins</p>
                          </div>
                        )}
                      </div>

                      {status.totalTinCount > 1 && (
                        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                          <div
                            className={cn("h-full rounded-full transition-all", status.allTinsDone ? "bg-emerald-500" : "bg-emerald-400")}
                            style={{ width: `${status.totalTinCount > 0 ? Math.min((status.completedTinCount / status.totalTinCount) * 100, 100) : 0}%` }}
                          />
                        </div>
                      )}

                      {ing.recipes.map((recipe, ri) => {
                        const rTins = Array.from({ length: recipe.tinCount }, (_, i) => i + 1);
                        const rDone = rTins.filter(tn => isCompleted(ing.ingredientId, recipe.recipeId, tn)).length;
                        const allRecipeDone = rTins.length > 0 && rDone >= rTins.length;
                        return (
                          <div key={recipe.recipeId} className={cn(ri > 0 && "mt-4")}>
                            <div className={cn(
                              "flex items-center justify-between px-3 py-2 rounded-lg mb-2",
                              allRecipeDone
                                ? "bg-emerald-50 dark:bg-emerald-900/20"
                                : "bg-secondary/40"
                            )}>
                              <div className="flex items-center gap-2 min-w-0">
                                {allRecipeDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                                <p className={cn(
                                  "text-sm font-bold uppercase tracking-wider truncate",
                                  allRecipeDone ? "text-emerald-700 dark:text-emerald-300" : "text-emerald-800 dark:text-emerald-300"
                                )}>
                                  {recipe.recipeName}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {fmtQty(recipe.qtyForRecipe, ing.unit)}
                                </span>
                                <span className={cn(
                                  "text-xs font-semibold tabular-nums",
                                  allRecipeDone ? "text-emerald-600" : "text-muted-foreground"
                                )}>
                                  {rDone}/{rTins.length}
                                </span>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                              {rTins.map(tn => {
                                const done = isCompleted(ing.ingredientId, recipe.recipeId, tn);
                                const completion = getCompletion(ing.ingredientId, recipe.recipeId, tn);
                                return (
                                  <button
                                    key={tn}
                                    onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, tn)}
                                    disabled={isOnBreak}
                                    className={cn(
                                      "relative flex flex-col items-center border-2 rounded-2xl px-3 py-3.5 transition-all active:scale-95",
                                      isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                      done
                                        ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 shadow-sm"
                                        : "bg-background border-border hover:border-emerald-400 hover:shadow-md"
                                    )}
                                  >
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      {done ? (
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                      ) : (
                                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />
                                      )}
                                      <span className="text-sm font-bold">Tin {tn}</span>
                                    </div>
                                    <span className={cn("text-lg font-bold tabular-nums", done ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
                                      {fmtQty(recipe.qtyPerTin, ing.unit)}
                                    </span>
                                    {done && completion && (
                                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 leading-tight text-center">
                                        {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Stock check */}
                      {status.needsStockCheck && (
                        <div ref={stockCheckRef} className="mt-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Package className="w-4 h-4 text-blue-600 animate-pulse" />
                            <p className="text-sm font-bold text-blue-800 dark:text-blue-200">Stock Check</p>
                            <p className="text-xs text-blue-600 dark:text-blue-400">— how much {ing.ingredientName.toLowerCase()} remains?</p>
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
                            <span className="text-sm text-muted-foreground">{ing.unit}</span>
                            <button
                              onClick={() => saveStockCheck(ing.ingredientId)}
                              disabled={!stockValues[ing.ingredientId] || savingStock[ing.ingredientId]}
                              className={cn(
                                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                                stockValues[ing.ingredientId]
                                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow active:scale-95"
                                  : "bg-blue-200 text-blue-400 cursor-not-allowed"
                              )}
                            >
                              {savingStock[ing.ingredientId] ? <Loader2 className="w-4 h-4 animate-spin" /> : status.stockSaved ? <Check className="w-4 h-4" /> : "Save"}
                            </button>
                          </div>
                          {status.stockSaved && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {stockValues[ing.ingredientId]} {ing.unit} recorded
                            </p>
                          )}
                        </div>
                      )}

                      {status.allTinsDone && status.stockSaved && (() => {
                        const remaining = Number(stockValues[ing.ingredientId] || 0);
                        if (remaining <= 0) return null;
                        return (
                          <button
                            onClick={() => transferToFreezer(ing.ingredientId, ing.ingredientName, remaining, ing.unit)}
                            disabled={transferringId === ing.ingredientId}
                            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300 rounded-xl text-sm font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors"
                          >
                            {transferringId === ing.ingredientId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Snowflake className="w-4 h-4" />}
                            Transfer {remaining} {ing.unit} to Freezer
                          </button>
                        );
                      })()}
              </div>
              );
            })() : (
              <div className="bg-card border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center text-muted-foreground">
                <ClipboardList className="w-12 h-12 mb-3 opacity-40" />
                <p className="font-medium">Select an ingredient to view its tins</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}