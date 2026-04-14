import React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import {
  ClipboardList, Loader2, CheckCircle2, Package, Plus, Minus, Check, Snowflake, Salad, Pencil, RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner, PrepDraftBanner, useNextActivePlan, fmtQty, toastDraftBlocked } from "../shared/prep-helpers";
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
  isBottle?: boolean;
  bottleSize?: number | null;
  bottlesNeeded?: number | null;
  totalQty: number;
  totalTinCount: number;
  isSubRecipe?: boolean;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    qtyForRecipe: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    tinCount: number;
    qtyPerTin: number;
    isOverridden?: boolean;
    isFillingMix?: boolean;
  }>;
}

interface PrepTinCompletion {
  id: number;
  ingredientId: number;
  isSubRecipe?: boolean;
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

export interface LinkedItem {
  ingredientName: string;
  unit: string;
  totalQty: number;
  recipes?: Array<{
    recipeId: number;
    recipeName: string;
    qtyForRecipe: number;
    tinCount: number;
    qtyPerTin: number;
  }>;
}

export function useMainPrepData(planId: number, station: string = "main_prep") {
  const [data, setData] = useState<{ ingredients: MainPrepIngredient[]; completions: PrepTinCompletion[]; linkedItems?: Record<number, LinkedItem[]> } | null>(null);
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

export function MainPrepStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const { data: nextPlanData, isLoading: isNextPlanLoading } = useNextActivePlan(plan.planDate);
  const nextPlan = nextPlanData as NextActivePlan | null;
  const noFuturePlan = !isNextPlanLoading && nextPlan != null && nextPlan.planId == null;
  const isDraft = nextPlan?.status === "draft";
  const targetPlanId = noFuturePlan ? plan.id : (nextPlan?.planId ?? plan.id);
  const { data, loading, refetch } = useMainPrepData(targetPlanId);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [savingStock, setSavingStock] = useState<Record<number, boolean>>({});
  const dirtyStockIds = useRef<Set<number>>(new Set());
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [presenceData, setPresenceData] = useState<PrepPresenceData>({});
  const activeIngIdRef = useRef<number | null>(null);
  const stockCheckRef = useRef<HTMLDivElement>(null);
  const prevNeedsStockCheckRef = useRef(false);

  // Tin count override state
  const [editingTinKey, setEditingTinKey] = useState<string | null>(null); // "ingredientId_recipeId"
  const [editTinValue, setEditTinValue] = useState("");
  const [savingTinOverride, setSavingTinOverride] = useState(false);

  const setTinOverride = async (recipeId: number, ingredientId: number, isFillingMix: boolean, tinCount: number | null) => {
    setSavingTinOverride(true);
    try {
      const res = await fetch(`/api/production-plans/${targetPlanId}/prep-tin-override`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId, ingredientId, isFillingMix, tinCount }),
      });
      if (!res.ok) throw new Error("Failed to set override");
      setEditingTinKey(null);
      setEditTinValue("");
      refetch();
    } catch (err) {
      toast({ title: "Error", description: "Failed to update tin count", variant: "destructive" });
    } finally {
      setSavingTinOverride(false);
    }
  };

  const checkDate = nextPlan?.planDate ?? plan.planDate;

  useEffect(() => {
    setSelectedItemKey(null);
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
      .catch((err) => { console.warn("[MainPrep] Stock checks fetch failed:", err); });
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
    }).catch((err) => { console.warn("[MainPrep] Presence post failed:", err); });
  }, [targetPlanId]);

  // Poll presence every 10s
  useEffect(() => {
    const poll = () => {
      fetch(`/api/production-plans/${targetPlanId}/prep-presence`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPresenceData(d); })
        .catch((err) => { console.warn("[MainPrep] Presence poll failed:", err); });
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
  const linkedItems = data?.linkedItems ?? {};

  const isCompleted = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean) =>
    completions.some(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber && !!c.isSubRecipe === !!isSubRecipe);

  const getCompletion = (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean) =>
    completions.find(c => c.ingredientId === ingredientId && c.recipeId === recipeId && c.tinNumber === tinNumber && !!c.isSubRecipe === !!isSubRecipe);

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
        if (isCompleted(ing.ingredientId, r.recipeId, tn, ing.isSubRecipe)) completedTinCount++;
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
      .filter(tn => isCompleted(ing.ingredientId, recipeId, tn, ing.isSubRecipe)).length;
    return { completedTins, totalTins, allDone: totalTins > 0 && completedTins >= totalTins };
  };

  const getPreppedByInitials = (ingredientId: number, recipeId?: number, isSubRecipe?: boolean): { initials: string; fullName: string }[] => {
    const seen = new Set<string>();
    const result: { initials: string; fullName: string }[] = [];
    for (const c of completions) {
      if (c.ingredientId !== ingredientId || !c.userName) continue;
      if (!!c.isSubRecipe !== !!isSubRecipe) continue;
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

  const itemKey = (ing: MainPrepIngredient) => ing.isSubRecipe ? `sub:${ing.ingredientId}` : `ing:${ing.ingredientId}`;

  useEffect(() => {
    if (ingredients.length === 0) return;
    if (selectedItemKey && ingredients.find(i => itemKey(i) === selectedItemKey)) return;
    const firstIncomplete = ingredients.find(ing => !ingredientDoneStatus(ing).isFullyDone);
    setSelectedItemKey(itemKey(firstIncomplete ?? ingredients[0]));
  }, [ingredients]);

  const selectedIngredient = ingredients.find(i => itemKey(i) === selectedItemKey) ?? null;

  const selectedStatus = selectedIngredient ? ingredientDoneStatus(selectedIngredient) : null;
  useEffect(() => {
    prevNeedsStockCheckRef.current = false;
  }, [selectedItemKey]);

  useEffect(() => {
    if (selectedStatus?.needsStockCheck && !selectedStatus.stockSaved && !prevNeedsStockCheckRef.current) {
      setTimeout(() => {
        stockCheckRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      toast({ title: `Stock check needed for ${selectedIngredient?.ingredientName ?? "this item"}` });
    }
    prevNeedsStockCheckRef.current = selectedStatus?.needsStockCheck ?? false;
  }, [selectedStatus?.needsStockCheck, selectedStatus?.stockSaved, selectedIngredient?.ingredientId]);

  const [runTinAction, tinPending] = useGuardedAction({
    onSuccess: () => refetch(),
  });

  const toggleTin = async (ingredientId: number, recipeId: number, tinNumber: number, isSubRecipe?: boolean) => {
    if (isOnBreak) return;
    if (isDraft) { toastDraftBlocked(); return; }
    activeIngIdRef.current = ingredientId;
    postPresence(ingredientId);
    const existing = getCompletion(ingredientId, recipeId, tinNumber, isSubRecipe);
    await runTinAction(async (signal) => {
      if (existing) {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe }),
          signal,
        });
      } else {
        await guardedFetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId, recipeId, tinNumber, isSubRecipe: !!isSubRecipe }),
          signal,
        });
      }
    });
  };

  const [runStockCheck, stockCheckBusy] = useGuardedAction();

  const saveStockCheck = async (ingredientId: number) => {
    const val = stockValues[ingredientId];
    if (val === undefined || val === "") return;
    if (isDraft) { toastDraftBlocked(); return; }
    setSavingStock(s => ({ ...s, [ingredientId]: true }));
    const cd = nextPlan?.planDate ?? plan.planDate;
    await runStockCheck(async (signal) => {
      await guardedFetch("/api/production-plans/stock-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate: cd, quantity: Number(val) }),
        signal,
      });
      dirtyStockIds.current.delete(ingredientId);
      toast({ title: "Stock check saved" });
      refetch();
    });
    setSavingStock(s => ({ ...s, [ingredientId]: false }));
  };

  const [transferringId, setTransferringId] = useState<number | null>(null);
  const [runTransfer, transferBusy] = useGuardedAction();

  const transferToFreezer = async (ingredientId: number, ingredientName: string, qty: number, unit: string) => {
    setTransferringId(ingredientId);
    await runTransfer(async (signal) => {
      await guardedFetch("/api/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId,
          fromLocation: "prep_fridge",
          toLocation: "production_freezer",
          quantity: qty,
          unit,
          notes: `Remaining after prep: ${ingredientName}`,
        }),
        signal,
      });
      toast({ title: `Transferred ${qty} ${unit} of ${ingredientName} to Freezer` });
    });
    setTransferringId(null);
  };

  const totalTins = ingredients.reduce((s, ing) => s + ing.totalTinCount, 0);
  const completedTins = ingredients.reduce((s, ing) => {
    const status = ingredientDoneStatus(ing);
    return s + status.completedTinCount;
  }, 0);
  const overallPct = totalTins > 0 ? Math.round((Math.min(completedTins, totalTins) / totalTins) * 100) : 0;

  if (loading || isNextPlanLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (noFuturePlan) {
    return (
      <div className="space-y-4">
        <PrepSubNav planId={plan.id} current="main_prep" />
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Salad className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
          <p className="text-muted-foreground text-sm">
            There is no upcoming active production plan to prep for.
            Create and activate a future plan to see prep requirements here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isDraft && nextPlan?.planId != null && nextPlan?.planDate && (
        <PrepDraftBanner
          planId={nextPlan.planId}
          planDate={nextPlan.planDate}
          planName={nextPlan.planName}
        />
      )}
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
              <h2 className="font-semibold text-lg">Main Prep</h2>
              <p className="text-sm text-muted-foreground">{completedTins} of {totalTins} items completed</p>
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
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ingredients by Recipe</p>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {leftGroups.map((group, gi) => (
                  <div key={group.recipeId} className={cn(gi > 0 && "border-t border-border")}>
                    {/* Recipe section header */}
                    <div className="px-4 py-2 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-center justify-between">
                      <p className="text-sm font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 truncate">
                        {group.recipeName}
                      </p>
                      <span className="text-sm text-emerald-600 dark:text-emerald-400 ml-2 whitespace-nowrap">
                        {group.batchesTarget} batch{group.batchesTarget !== 1 ? "es" : ""}
                      </span>
                    </div>
                    {group.items.map(({ ing, qtyForRecipe }) => {
                      const rStatus = recipeIngredientStatus(ing, group.recipeId);
                      const ingStatus = ingredientDoneStatus(ing);
                      const ik = itemKey(ing);
                      const isSelected = ik === selectedItemKey;
                      const presence = presenceData[ing.ingredientId] ?? [];
                      const ingLinkedItems = linkedItems[String(ing.ingredientId)] ?? [];
                      return (
                        <React.Fragment key={`${group.recipeId}-${ik}`}>
                        <button
                          onClick={() => {
                            setSelectedItemKey(ik);
                            activeIngIdRef.current = ing.ingredientId;
                            postPresence(ing.ingredientId);
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-t border-border/30",
                            isSelected
                              ? ingStatus.needsStockCheck
                                ? "bg-blue-500/10 border-l-4 border-l-blue-500"
                                : "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                              : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                            ingStatus.isFullyDone && !isSelected && "opacity-60"
                          )}
                        >
                          <div className="flex-shrink-0">
                            {ingStatus.isFullyDone ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : ingStatus.needsStockCheck ? (
                              <Package className="w-4 h-4 text-blue-500 animate-pulse" />
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
                              "text-lg font-medium truncate",
                              isSelected && "font-semibold",
                              ingStatus.isFullyDone && "line-through text-muted-foreground"
                            )}>
                              {ing.ingredientName}
                              {presence.length > 0 && <span className="ml-1 text-sm text-blue-500">👁</span>}
                            </p>
                            {ingStatus.needsStockCheck && (
                              <p className="text-sm text-blue-600 font-medium">Stock check needed</p>
                            )}
                            {!ingStatus.needsStockCheck && ing.recipes.length > 1 && (
                              <p className="text-sm text-muted-foreground"><span className="text-amber-500">shared</span></p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {rStatus.completedTins > 0 && getPreppedByInitials(ing.ingredientId, group.recipeId, ing.isSubRecipe).map(({ initials, fullName }) => (
                              <span
                                key={fullName}
                                title={fullName}
                                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-[9px] font-bold leading-none"
                              >
                                {initials}
                              </span>
                            ))}
                            {ing.isBottle && ing.bottlesNeeded ? (
                              <span className={cn(
                                "text-sm tabular-nums",
                                ingStatus.isFullyDone ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"
                              )}>
                                {ing.bottlesNeeded} btl{ing.bottlesNeeded === 1 ? "" : "s"}
                              </span>
                            ) : rStatus.totalTins > 0 ? (
                              <span className={cn(
                                "text-sm tabular-nums",
                                rStatus.allDone ? "text-emerald-600 font-semibold" : "text-muted-foreground"
                              )}>
                                {rStatus.completedTins}/{rStatus.totalTins}
                              </span>
                            ) : null}
                          </div>
                        </button>
                        {/* Linked ingredient sub-rows */}
                        {ingLinkedItems.map((li, liIdx) => (
                          <div
                            key={`linked-${ing.ingredientId}-${liIdx}`}
                            className="flex items-center justify-between pl-10 pr-4 py-1.5 border-t border-border/20 text-sm text-muted-foreground bg-secondary/10"
                          >
                            <span className="flex items-center gap-2">
                              <span className="text-primary/60">↳</span>
                              <span>{li.ingredientName}</span>
                            </span>
                            <span className="tabular-nums font-medium text-foreground">
                              {fmtQty(li.totalQty, li.unit)}
                            </span>
                          </div>
                        ))}
                        </React.Fragment>
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
                          <p className="text-base text-muted-foreground mt-0.5">
                            <span className="font-semibold text-foreground">{fmtQty(ing.totalQty, ing.unit)}</span>
                            {ing.isBottle && ing.bottlesNeeded
                              ? ` total · ${ing.bottlesNeeded} bottle${ing.bottlesNeeded === 1 ? "" : "s"} needed`
                              : ` total · ${status.completedTinCount}/${status.totalTinCount} tins done`
                            }
                          </p>
                          {isShared && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                              <span className="font-medium">Shared —</span>
                              {" in: "}{ing.recipes.map(r => r.recipeName).join(", ")}
                            </p>
                          )}
                          {presence.length > 0 && (
                            <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                              👁 <span className="font-medium">{presence.map(p => p.userName).join(", ")}</span> also viewing this
                            </p>
                          )}
                        </div>
                        {ing.isBottle && ing.bottlesNeeded ? (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-amber-600"
                            )}>
                              {ing.bottlesNeeded}
                            </p>
                            <p className="text-sm text-muted-foreground">bottle{ing.bottlesNeeded === 1 ? "" : "s"}</p>
                          </div>
                        ) : status.totalTinCount > 0 ? (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-foreground"
                            )}>
                              {status.completedTinCount}
                              <span className="text-base text-muted-foreground font-normal">/{status.totalTinCount}</span>
                            </p>
                            <p className="text-sm text-muted-foreground">tins</p>
                          </div>
                        ) : null}
                      </div>

                      {status.totalTinCount > 1 && (
                        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                          <div
                            className={cn("h-full rounded-full transition-all", status.allTinsDone ? "bg-emerald-500" : "bg-emerald-400")}
                            style={{ width: `${status.totalTinCount > 0 ? Math.min((status.completedTinCount / status.totalTinCount) * 100, 100) : 0}%` }}
                          />
                        </div>
                      )}

                      {ing.isBottle && ing.bottlesNeeded ? (() => {
                        const recipe = ing.recipes[0];
                        if (!recipe) return null;
                        const done = isCompleted(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe);
                        const completion = getCompletion(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe);
                        return (
                          <div>
                            <div className={cn(
                              "flex items-center justify-between px-3 py-2 rounded-lg mb-3",
                              done ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-secondary/40"
                            )}>
                              <div className="flex items-center gap-2 min-w-0">
                                {done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                                <p className={cn(
                                  "text-lg font-bold uppercase tracking-wider truncate",
                                  done ? "text-emerald-700 dark:text-emerald-300" : "text-emerald-800 dark:text-emerald-300"
                                )}>
                                  {recipe.recipeName}
                                </p>
                              </div>
                              <span className="text-sm text-muted-foreground tabular-nums ml-2 flex-shrink-0">
                                {fmtQty(ing.totalQty, ing.unit)}
                              </span>
                            </div>

                            <div className="bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-5 text-center">
                              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wider mb-2">
                                Bottles Required
                              </p>
                              <p className="text-5xl font-bold text-amber-700 dark:text-amber-300 tabular-nums mb-1">
                                {ing.bottlesNeeded}
                              </p>
                              <p className="text-sm text-amber-600 dark:text-amber-400 mb-1">
                                bottle{ing.bottlesNeeded === 1 ? "" : "s"} × {fmtQty(ing.bottleSize ?? 0, ing.unit)} each
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {fmtQty(ing.totalQty, ing.unit)} total needed
                              </p>
                            </div>

                            <button
                              onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, 1, ing.isSubRecipe)}
                              disabled={isOnBreak}
                              className={cn(
                                "mt-3 w-full flex items-center justify-center gap-2 border-2 rounded-2xl px-4 py-3.5 transition-all active:scale-95 text-base font-bold",
                                isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                done
                                  ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300"
                                  : "bg-background border-border hover:border-emerald-400 hover:shadow-md text-foreground"
                              )}
                            >
                              {done ? (
                                <>
                                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                  Bottles Collected
                                </>
                              ) : (
                                <>
                                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/40" />
                                  Mark Bottles as Collected
                                </>
                              )}
                            </button>
                            {done && completion && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 text-center">
                                {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                              </p>
                            )}
                          </div>
                        );
                      })() : ing.recipes.map((recipe, ri) => {
                        const rTins = Array.from({ length: recipe.tinCount }, (_, i) => i + 1);
                        const rDone = rTins.filter(tn => isCompleted(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe)).length;
                        const allRecipeDone = rTins.length > 0 && rDone >= rTins.length;
                        const tinEditKey = `${ing.ingredientId}_${recipe.recipeId}`;
                        const isEditingTins = editingTinKey === tinEditKey;
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
                                  "text-lg font-bold uppercase tracking-wider truncate",
                                  allRecipeDone ? "text-emerald-700 dark:text-emerald-300" : "text-emerald-800 dark:text-emerald-300"
                                )}>
                                  {recipe.recipeName}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <span className="text-sm text-muted-foreground tabular-nums">
                                  {fmtQty(recipe.qtyForRecipe, ing.unit)}
                                </span>
                                {isEditingTins ? (
                                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      autoFocus
                                      className="w-12 px-1.5 py-0.5 text-sm text-center border border-primary rounded-md bg-background tabular-nums"
                                      value={editTinValue}
                                      onChange={e => setEditTinValue(e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") {
                                          const v = parseInt(editTinValue);
                                          if (v >= 1) setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, v);
                                        }
                                        if (e.key === "Escape") { setEditingTinKey(null); setEditTinValue(""); }
                                      }}
                                    />
                                    <button
                                      disabled={savingTinOverride}
                                      onClick={() => {
                                        const v = parseInt(editTinValue);
                                        if (v >= 1) setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, v);
                                      }}
                                      className="p-1 text-primary hover:bg-primary/10 rounded"
                                    >
                                      {savingTinOverride ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      onClick={() => { setEditingTinKey(null); setEditTinValue(""); }}
                                      className="p-1 text-muted-foreground hover:bg-secondary rounded"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <span className={cn(
                                      "text-sm font-semibold tabular-nums",
                                      recipe.isOverridden ? "text-blue-600" : (allRecipeDone ? "text-emerald-600" : "text-muted-foreground")
                                    )}>
                                      {rDone}/{rTins.length}
                                    </span>
                                    {recipe.isOverridden && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setTinOverride(recipe.recipeId, ing.ingredientId, !!recipe.isFillingMix, null); }}
                                        className="p-0.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                        title="Reset to auto"
                                      >
                                        <RotateCcw className="w-3 h-3" />
                                      </button>
                                    )}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setEditingTinKey(tinEditKey); setEditTinValue(String(recipe.tinCount)); }}
                                      className="p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary rounded"
                                      title="Edit tin count"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {recipe.isFillingMix && recipe.isOverridden && (
                              <p className="text-xs text-blue-600 dark:text-blue-400 px-3 -mt-1 mb-2">Mixing tin count overridden for this recipe</p>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                              {rTins.map(tn => {
                                const done = isCompleted(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe);
                                const completion = getCompletion(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe);
                                return (
                                  <button
                                    key={tn}
                                    onClick={() => toggleTin(ing.ingredientId, recipe.recipeId, tn, ing.isSubRecipe)}
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
                                      <span className="text-base font-bold">Tin {tn}{recipe.tinSize ? ` (${recipe.tinSize})` : ""}</span>
                                    </div>
                                    <span className={cn("text-2xl font-bold tabular-nums", done ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
                                      {fmtQty(recipe.qtyPerTin, ing.unit)}
                                    </span>
                                    {done && completion && (
                                      <span className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 leading-tight text-center">
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
                      {stockCheckActiveToday(ing) && !status.allTinsDone && (
                        <div className="mt-4 bg-blue-50/30 dark:bg-blue-950/10 border border-blue-200/50 dark:border-blue-800/50 rounded-xl p-3 opacity-60">
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-blue-400" />
                            <p className="text-sm text-blue-600 dark:text-blue-400">Stock check required after all tins are completed</p>
                          </div>
                        </div>
                      )}
                      {status.needsStockCheck && (
                        <div ref={stockCheckRef} className="mt-4 bg-blue-50/70 dark:bg-blue-950/30 border-2 border-blue-400 dark:border-blue-600 rounded-xl p-4 shadow-md">
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
                              {savingStock[ing.ingredientId] ? <Loader2 className="w-4 h-4 animate-spin" /> : status.stockSaved ? <Check className="w-4 h-4" /> : "Save"}
                            </button>
                          </div>
                          {status.stockSaved && (
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
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
                            className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300 rounded-xl text-base font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors"
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