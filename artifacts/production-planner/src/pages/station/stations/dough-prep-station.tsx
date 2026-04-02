import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  useCreateBatchCompletion,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Plus, Minus, CheckCircle2, RotateCcw, Timer, Droplets, Scale,
  PackageSearch, ChevronRight, Layers, ClipboardList, Check, Package,
} from "lucide-react";
import { format, parseISO, differenceInMinutes, differenceInSeconds } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { BreakTracker } from "../shared/break-tracker";
import { PrepDateBanner } from "../shared/prep-helpers";
import { getStationCount } from "../shared/constants";

// ──────────────────────────────────────────────────────────────────────────────
// Dough Prep Station
// ──────────────────────────────────────────────────────────────────────────────
interface DoughPrepData {
  totalDoughKg: number;
  totalFlourKg: number;
  mixerCapacityKg: number;
  mixCount: number;
  flourPerMix: number;
  doughPerMix: number;
  kgPerMix: number;
  ingredients: Array<{
    ingredientId: number | null;
    ingredientName: string;
    unit: string;
    totalQty: number;
    qtyPerMix: number;
    pctOfDough: number;
  }>;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    ballCount: number;
    orderPosition: number;
    doughKgPerBatch: number;
    doughKgTotal: number;
    ballWeightG: number;
    doughSubRecipeName: string;
  }>;
  nextPlan: { id: number; planDate: string; name: string } | null;
  noFuturePlan?: boolean;
  extraBalls?: {
    extraPack: { count: number; weightG: number };
    snack: { count: number; weightG: number };
    totalKg: number;
  };
}

export function useDoughPrepData(planId: number, mode?: "current") {
  const [data, setData] = useState<DoughPrepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setLoading(true);
    const url = mode
      ? `/api/production-plans/${planId}/dough-prep?mode=${mode}`
      : `/api/production-plans/${planId}/dough-prep`;
    fetch(url, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d); initialLoadDone.current = true; setLoading(false); })
      .catch(e => { if (e.name !== "AbortError") { setError(e.message); initialLoadDone.current = true; setLoading(false); } });
  }, [planId, mode]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  return { data, loading, error };
}

type DoughView = "mixing" | "balling" | "overview";

export function DoughPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { data: doughData, loading: doughLoading } = useDoughPrepData(plan.id);
  const [activeMix, setActiveMix] = useState<number>(1);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [activeView, setActiveView] = useState<DoughView>("mixing");
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, Set<string>>>({});
  const [completedMixes, setCompletedMixes] = useState<Set<number>>(new Set());

  // Extra ball tick state — lifted here so compact panel + full balling view share the same data
  const extraTicksKey = `extra_balls_balled_${plan.id}`;
  const [extraTicks, setExtraTicks] = useState<Record<string, boolean>>({});
  const [extraTicksLoaded, setExtraTicksLoaded] = useState(false);
  useEffect(() => {
    fetch(`/api/app-settings/${extraTicksKey}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value) { try { setExtraTicks(JSON.parse(d.value)); } catch (err) { console.warn("[DoughPrep] Extra ticks parse failed:", err); } }
        setExtraTicksLoaded(true);
      })
      .catch((err) => { console.warn("[DoughPrep] Extra ticks fetch failed:", err); setExtraTicksLoaded(true); });
  }, [extraTicksKey]);
  const saveExtraTicks = (updated: Record<string, boolean>) => {
    fetch(`/api/app-settings/${extraTicksKey}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(updated) }),
    }).catch((err) => { console.warn("[DoughPrep] Extra ticks save failed:", err); });
  };
  const toggleExtraTick = (key: string) => {
    const updated = { ...extraTicks, [key]: !extraTicks[key] };
    setExtraTicks(updated);
    saveExtraTicks(updated);
  };

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const totalComplete = items.reduce((s, it) => s + getStationCount(it, "dough_prep"), 0);
  // Ball TARGET comes from the next day's plan (via doughData), not today's plan.
  // Today's plan items are used only for tracking completions.
  const totalBallsNeeded = doughData?.recipes?.reduce((s, r) => s + r.ballCount, 0) ?? 0;
  const overallPct = totalBallsNeeded > 0 ? Math.round((totalComplete / totalBallsNeeded) * 100) : 0;
  const mixCount = doughData?.mixCount ?? 0;

  const hasServerProgress = totalComplete > 0;
  const hasAnyMixDone = completedMixes.size > 0 || hasServerProgress;
  const BALLS_PER_TRAY = 4;

  const addBatch = async (item: ProductionPlanItem): Promise<boolean> => {
    const res = await fetch(`/api/production-plans/${plan.id}/batch-completions`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planItemId: item.id, stationType: "dough_prep", completedAt: new Date().toISOString() }),
    });
    if (res.status === 409) return false; // Target met — not an error
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    return true;
  };

  const removeBatch = async (item: ProductionPlanItem) => {
    if (getStationCount(item, "dough_prep") === 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "dough_prep" }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo batch. Please try again.", variant: "destructive" });
    }
  };

  const toggleIngredient = (mixNum: number, ingredientKey: string) => {
    if (isOnBreak) return;
    setCheckedIngredients(prev => {
      const mixSet = new Set(prev[mixNum] ?? []);
      if (mixSet.has(ingredientKey)) mixSet.delete(ingredientKey);
      else mixSet.add(ingredientKey);
      return { ...prev, [mixNum]: mixSet };
    });
  };

  const completeMix = (mixNum: number) => {
    if (isOnBreak) return;
    setCompletedMixes(prev => new Set(prev).add(mixNum));
    if (mixNum < mixCount) {
      setActiveMix(mixNum + 1);
    }
  };

  const checkedForMix = checkedIngredients[activeMix] ?? new Set<string>();
  const ingredientCount = doughData?.ingredients.length ?? 0;
  const allChecked = ingredientCount > 0 && checkedForMix.size >= ingredientCount;
  const isMixComplete = completedMixes.has(activeMix);
  const allMixesDone = mixCount > 0 && completedMixes.size >= mixCount;

  const ballCount = totalComplete;
  const allBallingDone = ballCount >= totalBallsNeeded;
  const totalTraysNeeded = totalBallsNeeded / BALLS_PER_TRAY;
  const traysDone = ballCount / BALLS_PER_TRAY;

  // Extra ball derived data (used in both compact panel and full balling view)
  type ExtraItem = { key: string; label: string; weightG: number; type: "extraPack" | "snack" };
  const extraBallsData = doughData?.extraBalls;
  const extraItems: ExtraItem[] = [];
  if (extraBallsData) {
    for (let i = 0; i < extraBallsData.extraPack.count; i++) {
      extraItems.push({ key: `extraPack_${i}`, label: `Extra Pack Ball ${extraBallsData.extraPack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBallsData.extraPack.weightG, type: "extraPack" });
    }
    for (let i = 0; i < extraBallsData.snack.count; i++) {
      extraItems.push({ key: `snack_${i}`, label: `Snack Ball ${extraBallsData.snack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBallsData.snack.weightG, type: "snack" });
    }
  }
  const extraPackItems = extraItems.filter(e => e.type === "extraPack");
  const snackItems = extraItems.filter(e => e.type === "snack");
  const extraPackDone = extraPackItems.filter(e => extraTicks[e.key]).length;
  const snackDone = snackItems.filter(e => extraTicks[e.key]).length;
  const addExtraType = (group: ExtraItem[]) => {
    const next = group.find(e => !extraTicks[e.key]);
    if (next) toggleExtraTick(next.key);
  };
  const removeExtraType = (group: ExtraItem[]) => {
    const last = [...group].reverse().find(e => extraTicks[e.key]);
    if (last) toggleExtraTick(last.key);
  };

  const [addingBalls, setAddingBalls] = useState(false);
  const addBalls = async (count: number) => {
    if (isOnBreak || !doughData || addingBalls) return;
    setAddingBalls(true);
    try {
      let remaining = count;
      for (const item of items) {
        if (remaining <= 0) break;
        // Try adding balls to this item until target met or we've added enough
        while (remaining > 0) {
          const added = await addBatch(item);
          if (!added) break; // Target met for this item — move to next
          remaining--;
        }
      }
    } finally {
      setAddingBalls(false);
    }
  };

  const undoBall = () => {
    if (isOnBreak || ballCount <= 0) return;
    const lastItemWithCount = [...items].reverse().find(it => getStationCount(it, "dough_prep") > 0);
    if (lastItemWithCount) {
      removeBatch(lastItemWithCount);
    }
  };

  const [removingBalls, setRemovingBalls] = useState(false);
  const removeBalls = async (count: number) => {
    if (isOnBreak || ballCount <= 0 || removingBalls) return;
    setRemovingBalls(true);
    try {
      let toRemove = Math.min(count, ballCount);
      const alreadyRemoved: Record<number, number> = {};
      for (const item of [...items].reverse()) {
        if (toRemove <= 0) break;
        const done = getStationCount(item, "dough_prep") - (alreadyRemoved[item.id] ?? 0);
        if (done <= 0) continue;
        const removing = Math.min(toRemove, done);
        for (let i = 0; i < removing; i++) {
          await removeBatch(item);
          alreadyRemoved[item.id] = (alreadyRemoved[item.id] ?? 0) + 1;
        }
        toRemove -= removing;
      }
    } finally {
      setRemovingBalls(false);
    }
  };

  const getBallAllocation = () => {
    if (!doughData) return [];
    return doughData.recipes.map(r => {
      const item = items.find(it => it.recipeId === r.recipeId);
      const ballsDone = item ? getStationCount(item, "dough_prep") : 0;
      return { ...r, ballsDone };
    });
  };

  if (doughLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-3" />
        <span className="text-lg">Loading dough data…</span>
      </div>
    );
  }

  if (doughData?.noFuturePlan) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
        <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
        <p className="text-muted-foreground text-sm">
          There is no upcoming active production plan to prep dough for.
          Create and activate a future plan to see dough requirements here.
        </p>
      </div>
    );
  }

  if (!doughData || doughData.totalDoughKg <= 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <Layers className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
        <h2 className="font-semibold text-lg mb-1">No dough requirements</h2>
        <p className="text-muted-foreground text-sm">No dough recipes found for this plan.</p>
      </div>
    );
  }

  const ballPct = totalBallsNeeded > 0 ? Math.round((ballCount / totalBallsNeeded) * 100) : 0;
  const mixPct = mixCount > 0 ? Math.round((completedMixes.size / mixCount) * 100) : 0;

  const fmtTrays = (n: number) => {
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
  };

  return (
    <div className="space-y-4">
      {doughData.nextPlan && (
        <PrepDateBanner
          currentPlanDate={plan.planDate}
          targetPlanDate={doughData.nextPlan.planDate ?? null}
          targetPlanName={doughData.nextPlan.name ?? null}
          isLoading={doughLoading}
          activityLabel="Dough prep"
        />
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold">Dough Prep Progress</h2>
            <p className="text-sm text-muted-foreground">
              {ballCount} of {totalBallsNeeded} balls · {completedMixes.size} / {mixCount} mixes
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold font-display">{overallPct}%</span>
            <button
              onClick={() => setActiveView("overview")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                activeView === "overview"
                  ? "bg-background text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
              )}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Overview
            </button>
          </div>
        </div>
        <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              overallPct >= 100 ? "bg-emerald-500" : "bg-amber-500"
            )}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="dough_prep" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {activeView === "overview" ? (
        <DoughOverview
          doughData={doughData}
          items={items}
          completedMixes={completedMixes}
          mixCount={mixCount}
          ballCount={ballCount}
          totalBallsNeeded={totalBallsNeeded}
          overallPct={overallPct}
          totalComplete={totalComplete}
        />
      ) : activeView === "mixing" ? (
        <>
          <DoughMixingView
            doughData={doughData}
            mixCount={mixCount}
            activeMix={activeMix}
            setActiveMix={setActiveMix}
            checkedForMix={checkedForMix}
            toggleIngredient={toggleIngredient}
            completedMixes={completedMixes}
            completeMix={completeMix}
            allChecked={allChecked}
            isMixComplete={isMixComplete}
            allMixesDone={allMixesDone}
            isOnBreak={isOnBreak}
          />

          <div
            role="button"
            tabIndex={0}
            onClick={() => hasAnyMixDone ? setActiveView("balling") : toast({ title: "Complete a mix first", description: "Balling starts after the first mix is done." })}
            className={cn(
              "w-full border-2 rounded-2xl p-4 transition-all text-left cursor-pointer",
              !hasAnyMixDone
                ? "border-border/50 bg-secondary/20 opacity-50 pointer-events-none"
                : allBallingDone
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/10"
                  : "border-primary/30 bg-primary/5 hover:border-primary/60"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                <span className="font-semibold text-sm">Balling</span>
                {allBallingDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              </div>
              <div className="flex items-center gap-3 text-sm tabular-nums">
                <span><span className="font-bold">{ballCount}</span><span className="text-muted-foreground"> / {totalBallsNeeded} balls</span></span>
                <span className="text-muted-foreground">·</span>
                <span><span className="font-bold">{fmtTrays(traysDone)}</span><span className="text-muted-foreground"> / {fmtTrays(totalTraysNeeded)} trays</span></span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mb-3">
              <div
                className={cn("h-full rounded-full transition-all", allBallingDone ? "bg-emerald-500" : "bg-primary")}
                style={{ width: `${Math.min(ballPct, 100)}%` }}
              />
            </div>
            {hasAnyMixDone && !allBallingDone && (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>

                {/* Tray controls — left */}
                <button
                  onClick={(e) => { e.stopPropagation(); removeBalls(BALLS_PER_TRAY); }}
                  disabled={ballCount < BALLS_PER_TRAY || isOnBreak || removingBalls}
                  className="h-14 px-5 rounded-xl text-lg font-bold transition-all border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30"
                >
                  {removingBalls ? "…" : "− 1 Tray"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); addBalls(BALLS_PER_TRAY); }}
                  disabled={isOnBreak || createBatch.isPending}
                  className={cn(
                    "h-14 px-6 rounded-xl text-lg font-bold transition-all",
                    isOnBreak
                      ? "bg-secondary text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                  )}
                >
                  + 1 Tray
                </button>

                {/* Secondary controls — pushed right */}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); undoBall(); }}
                    disabled={ballCount === 0 || isOnBreak}
                    className="h-14 px-4 rounded-xl text-lg font-bold border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
                  >
                    − 1 Ball
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); addBalls(1); }}
                    disabled={isOnBreak || createBatch.isPending}
                    className="h-14 px-4 rounded-xl text-lg font-bold border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-50 transition-all"
                  >
                    + 1 Ball
                  </button>

                  {extraPackItems.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); addExtraType(extraPackItems); }}
                      disabled={isOnBreak || extraPackDone >= extraPackItems.length}
                      className={cn(
                        "h-14 px-4 rounded-xl text-lg font-bold border-2 transition-all",
                        extraPackDone >= extraPackItems.length
                          ? "border-emerald-300 bg-emerald-50/50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                          : "border-border bg-background hover:bg-secondary/60 active:scale-95 disabled:opacity-50"
                      )}
                    >
                      {extraPackItems[0]?.weightG}g ({extraPackDone}/{extraPackItems.length})
                    </button>
                  )}

                  {snackItems.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); addExtraType(snackItems); }}
                      disabled={isOnBreak || snackDone >= snackItems.length}
                      className={cn(
                        "h-14 px-4 rounded-xl text-lg font-bold border-2 transition-all",
                        snackDone >= snackItems.length
                          ? "border-emerald-300 bg-emerald-50/50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                          : "border-border bg-background hover:bg-secondary/60 active:scale-95 disabled:opacity-50"
                      )}
                    >
                      Snack ({snackDone}/{snackItems.length})
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <DoughBallingView
            doughData={doughData}
            ballCount={ballCount}
            totalBallsNeeded={totalBallsNeeded}
            allBallingDone={allBallingDone}
            addBalls={addBalls}
            undoBall={undoBall}
            removeBalls={removeBalls}
            removingBalls={removingBalls}
            batchPending={createBatch.isPending}
            getBallAllocation={getBallAllocation}
            isOnBreak={isOnBreak}
            traysDone={traysDone}
            totalTraysNeeded={totalTraysNeeded}
            ballsPerTray={BALLS_PER_TRAY}
            extraTicks={extraTicks}
            ticksLoaded={extraTicksLoaded}
            toggleTick={toggleExtraTick}
          />

          <button
            onClick={() => setActiveView("mixing")}
            className={cn(
              "w-full border-2 rounded-2xl p-4 transition-all text-left",
              allMixesDone
                ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/10"
                : "border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10 hover:border-blue-400 dark:hover:border-blue-600"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-blue-600" />
                <span className="font-semibold text-sm">Mixing</span>
                {allMixesDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              </div>
              <div className="flex items-center gap-2 text-sm tabular-nums">
                <span><span className="font-bold">{completedMixes.size}</span><span className="text-muted-foreground"> / {mixCount} mixes</span></span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", allMixesDone ? "bg-emerald-500" : "bg-blue-500")}
                style={{ width: `${Math.min(mixPct, 100)}%` }}
              />
            </div>
          </button>
        </>
      )}
    </div>
  );
}

function fmtDoughQty(qty: number, unit: string, name: string): string {
  const isYeast = name.toLowerCase().includes("yeast");
  if (unit === "kg") {
    if (qty < 1) {
      const g = qty * 1000;
      return isYeast ? `${g.toFixed(1)}g` : `${Math.round(g)}g`;
    }
    return `${qty.toFixed(3)} kg`;
  }
  if (unit === "g") {
    return isYeast ? `${qty.toFixed(1)}g` : `${Math.round(qty)}g`;
  }
  return `${qty.toFixed(3)} ${unit}`;
}

function DoughMixingView({
  doughData, mixCount, activeMix, setActiveMix,
  checkedForMix, toggleIngredient, completedMixes, completeMix,
  allChecked, isMixComplete, allMixesDone, isOnBreak,
}: {
  doughData: DoughPrepData;
  mixCount: number;
  activeMix: number;
  setActiveMix: (n: number) => void;
  checkedForMix: Set<string>;
  toggleIngredient: (mix: number, key: string) => void;
  completedMixes: Set<number>;
  completeMix: (mix: number) => void;
  allChecked: boolean;
  isMixComplete: boolean;
  allMixesDone: boolean;
  isOnBreak: boolean;
}) {
  if (allMixesDone) {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-700 rounded-2xl p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
        <h2 className="font-display text-2xl font-bold text-emerald-800 dark:text-emerald-200 mb-2">
          All {mixCount} mix{mixCount !== 1 ? "es" : ""} complete!
        </h2>
        <p className="text-emerald-700 dark:text-emerald-300">
          Switch to Balling to start portioning dough balls.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {Array.from({ length: mixCount }, (_, i) => {
            const n = i + 1;
            const done = completedMixes.has(n);
            return (
              <button
                key={n}
                onClick={() => setActiveMix(n)}
                className={cn(
                  "w-14 h-14 rounded-full text-lg font-bold transition-all",
                  activeMix === n
                    ? done
                      ? "bg-emerald-500 text-white ring-2 ring-emerald-300"
                      : "bg-primary text-primary-foreground ring-2 ring-primary/30"
                    : done
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                )}
              >
                {done ? <Check className="w-5 h-5 mx-auto" /> : n}
              </button>
            );
          })}
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">
            {completedMixes.size} of {mixCount} mixes done
          </p>
          <p className="text-sm text-muted-foreground">
            {(doughData.flourPerMix ?? 0).toFixed(3)} kg flour → ~{(doughData.doughPerMix ?? 0).toFixed(3)} kg dough per mix
          </p>
          <p className="text-sm text-muted-foreground font-semibold">
            Day total: {doughData.totalDoughKg.toFixed(3)} kg dough ({mixCount} mixes)
          </p>
        </div>
      </div>

      <div className={cn(
        "border-2 rounded-2xl overflow-hidden transition-all",
        isMixComplete
          ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/10"
          : "border-primary/50 bg-card"
      )}>
        <div className={cn(
          "px-5 py-4 flex items-center justify-between",
          isMixComplete
            ? "bg-emerald-100/50 dark:bg-emerald-900/20"
            : "bg-primary/5 dark:bg-primary/10"
        )}>
          <div>
            <h2 className="font-display text-2xl font-bold">Mix {activeMix}</h2>
            <p className="text-base text-muted-foreground">
              {checkedForMix.size} of {doughData.ingredients.length} ingredients added
            </p>
          </div>
          {isMixComplete && <CheckCircle2 className="w-8 h-8 text-emerald-500" />}
        </div>

        <div className="divide-y divide-border/40">
          {doughData.ingredients.map(ing => {
            const key = ing.ingredientId != null ? String(ing.ingredientId) : ing.ingredientName;
            const isChecked = checkedForMix.has(key) || isMixComplete;
            return (
              <button
                key={key}
                onClick={() => !isMixComplete && toggleIngredient(activeMix, key)}
                disabled={isOnBreak || isMixComplete}
                className={cn(
                  "w-full flex items-center gap-4 px-5 py-4 text-left transition-all",
                  isChecked
                    ? "bg-emerald-50/50 dark:bg-emerald-900/10"
                    : "hover:bg-secondary/30",
                  isOnBreak && "opacity-50"
                )}
              >
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all border-2",
                  isChecked
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-border bg-background"
                )}>
                  {isChecked && <Check className="w-6 h-6" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "font-semibold text-3xl",
                    isChecked && "line-through text-muted-foreground"
                  )}>
                    {ing.ingredientName}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={cn(
                    "text-3xl font-semibold tabular-nums",
                    isChecked ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
                  )}>
                    {fmtDoughQty(ing.qtyPerMix, ing.unit, ing.ingredientName)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {!isMixComplete && (
          <div className="px-5 py-4 border-t border-border/40">
            <button
              onClick={() => completeMix(activeMix)}
              disabled={!allChecked || isOnBreak}
              className={cn(
                "w-full py-4 rounded-xl text-lg font-bold transition-all",
                allChecked && !isOnBreak
                  ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"
              )}
            >
              {allChecked ? `✓ Mix ${activeMix} Complete` : `Add all ingredients to continue`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DoughBallingView({
  doughData, ballCount, totalBallsNeeded, allBallingDone,
  addBalls, undoBall, removeBalls, removingBalls, batchPending, getBallAllocation, isOnBreak,
  traysDone, totalTraysNeeded, ballsPerTray,
  extraTicks, ticksLoaded, toggleTick,
}: {
  doughData: DoughPrepData;
  ballCount: number;
  totalBallsNeeded: number;
  allBallingDone: boolean;
  addBalls: (n: number) => void;
  undoBall: () => void;
  removeBalls: (n: number) => void;
  removingBalls: boolean;
  batchPending: boolean;
  getBallAllocation: () => Array<{ recipeId: number; recipeName: string; ballCount: number; ballWeightG: number; portionsPerBatch: number; ballsDone: number }>;
  isOnBreak: boolean;
  traysDone: number;
  totalTraysNeeded: number;
  ballsPerTray: number;
  extraTicks: Record<string, boolean>;
  ticksLoaded: boolean;
  toggleTick: (key: string) => void;
}) {
  const extraBalls = doughData.extraBalls;
  const extraItems: Array<{ key: string; label: string; weightG: number; type: "extraPack" | "snack" }> = [];
  if (extraBalls) {
    for (let i = 0; i < extraBalls.extraPack.count; i++) {
      extraItems.push({ key: `extraPack_${i}`, label: `Extra Pack Ball ${extraBalls.extraPack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.extraPack.weightG, type: "extraPack" });
    }
    for (let i = 0; i < extraBalls.snack.count; i++) {
      extraItems.push({ key: `snack_${i}`, label: `Snack Ball ${extraBalls.snack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.snack.weightG, type: "snack" });
    }
  }
  const allExtraTicked = extraItems.length > 0 && extraItems.every(e => extraTicks[e.key]);

  const extraPackItems = extraItems.filter(e => e.type === "extraPack");
  const snackItems = extraItems.filter(e => e.type === "snack");
  const extraPackDone = extraPackItems.filter(e => extraTicks[e.key]).length;
  const snackDone = snackItems.filter(e => extraTicks[e.key]).length;

  const addExtraType = (group: typeof extraItems) => {
    const next = group.find(e => !extraTicks[e.key]);
    if (next) toggleTick(next.key);
  };
  const removeExtraType = (group: typeof extraItems) => {
    const last = [...group].reverse().find(e => extraTicks[e.key]);
    if (last) toggleTick(last.key);
  };

  const allocation = getBallAllocation();
  const ballPct = totalBallsNeeded > 0 ? Math.round((ballCount / totalBallsNeeded) * 100) : 0;

  const fmtTrays = (n: number) => {
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
  };

  return (
    <div className="space-y-4">
      <div className={cn(
        "border-2 rounded-2xl p-6 text-center transition-all",
        allBallingDone
          ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20"
          : "border-primary/50 bg-card"
      )}>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xl text-muted-foreground mb-1">Balls</p>
            <p className={cn(
              "font-display text-8xl font-bold tabular-nums",
              allBallingDone ? "text-emerald-600" : "text-foreground"
            )}>
              {ballCount}
            </p>
            <p className="text-2xl text-muted-foreground">of {totalBallsNeeded}</p>
          </div>
          <div>
            <p className="text-xl text-muted-foreground mb-1">Trays</p>
            <p className={cn(
              "font-display text-8xl font-bold tabular-nums",
              allBallingDone ? "text-emerald-600" : "text-foreground"
            )}>
              {fmtTrays(traysDone)}
            </p>
            <p className="text-2xl text-muted-foreground">of {fmtTrays(totalTraysNeeded)}</p>
          </div>
        </div>

        <p className="text-xl text-muted-foreground mb-4">
          Each ball = {doughData.recipes[0]?.ballWeightG ?? 0}g · {ballsPerTray} balls per tray
        </p>

        <div className="w-full h-5 bg-secondary rounded-full overflow-hidden mb-8">
          <div
            className={cn("h-full rounded-full transition-all", allBallingDone ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${Math.min(ballPct, 100)}%` }}
          />
        </div>

        {!allBallingDone ? (
          <div className="flex flex-col items-center gap-4">

            {/* PRIMARY — Tray controls */}
            <div className="flex gap-3 items-stretch w-full">
              <button
                onClick={() => removeBalls(ballsPerTray)}
                disabled={ballCount < ballsPerTray || isOnBreak || removingBalls}
                className="flex-1 h-20 rounded-2xl text-2xl font-bold transition-all border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30"
              >
                {removingBalls ? "…" : "− 1 Tray"}
              </button>
              <button
                onClick={() => addBalls(ballsPerTray)}
                disabled={isOnBreak || batchPending}
                className={cn(
                  "flex-[2] h-20 rounded-2xl text-3xl font-bold transition-all shadow-lg",
                  isOnBreak
                    ? "bg-secondary text-muted-foreground"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20 active:scale-95"
                )}
              >
                + 1 Tray
              </button>
            </div>

            {/* SECONDARY — Single ball controls */}
            <div className="flex gap-3 items-stretch w-full">
              <button
                onClick={undoBall}
                disabled={ballCount === 0 || isOnBreak}
                className="flex-1 h-16 rounded-2xl text-xl font-bold border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
              >
                − 1 Ball
              </button>
              <button
                onClick={() => addBalls(1)}
                disabled={isOnBreak || batchPending}
                className={cn(
                  "flex-1 h-16 rounded-2xl text-xl font-bold border-2 transition-all",
                  isOnBreak
                    ? "border-border bg-background text-muted-foreground opacity-50"
                    : "border-border bg-background hover:bg-secondary/60 active:scale-95"
                )}
              >
                + 1 Ball
              </button>
            </div>

            {/* Extra ball type controls */}
            {(extraPackItems.length > 0 || snackItems.length > 0) && (
              <div className="flex gap-3 items-stretch w-full">
                {extraPackItems.length > 0 && (
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex gap-3 items-stretch">
                      <button
                        onClick={() => removeExtraType(extraPackItems)}
                        disabled={extraPackDone === 0 || isOnBreak}
                        className="w-14 flex items-center justify-center rounded-2xl border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
                      >
                        <Minus className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() => addExtraType(extraPackItems)}
                        disabled={isOnBreak || extraPackDone >= extraPackItems.length}
                        className={cn(
                          "flex-1 h-16 rounded-2xl text-xl font-bold border-2 transition-all",
                          extraPackDone >= extraPackItems.length
                            ? "border-emerald-300 bg-emerald-50/50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                            : isOnBreak
                            ? "border-border bg-background text-muted-foreground opacity-50"
                            : "border-border bg-background hover:bg-secondary/60 active:scale-95"
                        )}
                      >
                        Add {extraPackItems[0]?.weightG}g ball
                      </button>
                    </div>
                    <p className="text-lg text-muted-foreground text-center">
                      {extraPackDone} of {extraPackItems.length}
                    </p>
                  </div>
                )}

                {snackItems.length > 0 && (
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex gap-3 items-stretch">
                      <button
                        onClick={() => removeExtraType(snackItems)}
                        disabled={snackDone === 0 || isOnBreak}
                        className="w-14 flex items-center justify-center rounded-2xl border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
                      >
                        <Minus className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() => addExtraType(snackItems)}
                        disabled={isOnBreak || snackDone >= snackItems.length}
                        className={cn(
                          "flex-1 h-16 rounded-2xl text-xl font-bold border-2 transition-all",
                          snackDone >= snackItems.length
                            ? "border-emerald-300 bg-emerald-50/50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                            : isOnBreak
                            ? "border-border bg-background text-muted-foreground opacity-50"
                            : "border-border bg-background hover:bg-secondary/60 active:scale-95"
                        )}
                      >
                        Add {snackItems[0]?.weightG}g Snack
                      </button>
                    </div>
                    <p className="text-lg text-muted-foreground text-center">
                      {snackDone} of {snackItems.length}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3 text-emerald-600">
            <CheckCircle2 className="w-10 h-10" />
            <span className="text-3xl font-semibold">All balls complete!</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {allocation.map(r => {
          const pct = r.ballCount > 0 ? Math.round((r.ballsDone / r.ballCount) * 100) : 0;
          const done = r.ballsDone >= r.ballCount;
          const recipeTrays = r.ballCount / ballsPerTray;
          const recipeTraysDone = r.ballsDone / ballsPerTray;
          return (
            <div
              key={r.recipeId}
              className={cn(
                "bg-card border rounded-xl px-4 py-3 transition-all",
                done
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : r.ballsDone > 0
                    ? "border-primary/30"
                    : "border-border"
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold text-base", done && "text-muted-foreground line-through")}>
                    {r.recipeName}
                  </span>
                  {done && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                </div>
                <div className="text-right">
                  <span className="text-base tabular-nums">
                    <span className="font-bold">{r.ballsDone}</span>
                    <span className="text-muted-foreground"> / {r.ballCount} balls</span>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", done ? "bg-emerald-500" : "bg-primary")}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{r.ballWeightG}g per ball</span>
                <span className="font-semibold text-primary">
                  {fmtTrays(recipeTraysDone)} / {fmtTrays(recipeTrays)} trays
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Daily Extras tick-off */}
      {ticksLoaded && extraItems.length > 0 && (
        <div className={cn(
          "bg-card border rounded-xl px-4 py-3 space-y-2",
          allExtraTicked ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10" : "border-border/60"
        )}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-muted-foreground" />
              <span className="text-base font-semibold text-muted-foreground">Daily Extras</span>
            </div>
            {allExtraTicked && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </div>
          {extraItems.map(item => (
            <button
              key={item.key}
              onClick={() => toggleTick(item.key)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all",
                extraTicks[item.key]
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10"
                  : "border-border bg-secondary/20 hover:bg-secondary/40"
              )}
            >
              <div className={cn(
                "w-7 h-7 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
                extraTicks[item.key]
                  ? "bg-emerald-500 border-emerald-500"
                  : "border-border bg-background"
              )}>
                {extraTicks[item.key] && <Check className="w-4 h-4 text-white" />}
              </div>
              <span className={cn("text-base font-medium flex-1", extraTicks[item.key] && "line-through text-muted-foreground")}>
                {item.label}
              </span>
              <span className="text-sm text-muted-foreground">{item.weightG}g</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DoughOverview({
  doughData, items, completedMixes, mixCount,
  ballCount, totalBallsNeeded, overallPct, totalComplete,
}: {
  doughData: DoughPrepData;
  items: ProductionPlanItem[];
  completedMixes: Set<number>;
  mixCount: number;
  ballCount: number;
  totalBallsNeeded: number;
  overallPct: number;
  totalComplete: number;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="font-semibold text-lg">Day Overview</h2>
              <p className="text-sm text-muted-foreground">
                {totalComplete} of {totalBallsNeeded} balls
              </p>
            </div>
          </div>
          <span className="text-3xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-amber-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground mb-1">Mixes</p>
          <p className="text-3xl font-bold tabular-nums">{completedMixes.size} / {mixCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground mb-1">Balls</p>
          <p className="text-3xl font-bold tabular-nums">{ballCount} / {totalBallsNeeded}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-sm text-muted-foreground mb-1">Trays</p>
          <p className="text-3xl font-bold tabular-nums">
            {(ballCount / 4).toFixed(ballCount % 4 === 0 ? 0 : 1)} / {(totalBallsNeeded / 4).toFixed(totalBallsNeeded % 4 === 0 ? 0 : 1)}
          </p>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2 text-base">Dough Requirements</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">Total Dough</p>
            <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{doughData.totalDoughKg.toFixed(3)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">Total Flour</p>
            <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{(doughData.totalFlourKg ?? 0).toFixed(3)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">Flour/Mix</p>
            <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{(doughData.flourPerMix ?? 0).toFixed(3)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">Mixes</p>
            <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{doughData.mixCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-base">Recipe Breakdown</h3>
        </div>
        <table className="w-full text-base">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-sm text-muted-foreground">
              <th className="py-2 px-4 text-left font-medium">Recipe</th>
              <th className="py-2 px-4 text-center font-medium">Balls</th>
              <th className="py-2 px-4 text-center font-medium">Trays</th>
              <th className="py-2 px-4 text-center font-medium">Ball Wt</th>
              <th className="py-2 px-4 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const recipeInfo = doughData.recipes.find(r => r.recipeId === item.recipeId);
              const dpCount = getStationCount(item, "dough_prep");
              const target = item.batchesTarget ?? 0;
              const isComplete = dpCount >= target;
              const trays = target / 4;
              const fmtT = Number.isInteger(trays) ? String(trays) : trays.toFixed(2).replace(/0$/, "");
              return (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className={cn("py-2.5 px-4 font-medium", isComplete && "text-muted-foreground line-through")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {dpCount} / {target}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums font-medium text-amber-700 dark:text-amber-400">
                    {fmtT}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-muted-foreground">
                    {recipeInfo ? `${recipeInfo.ballWeightG}g` : "—"}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {isComplete
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      : <span className="text-xs text-muted-foreground">In progress</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-base">Dough Recipe (per mix)</h3>
        </div>
        <div className="divide-y divide-border/40">
          {doughData.ingredients.map(ing => (
            <div key={ing.ingredientId ?? ing.ingredientName} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-base font-medium">{ing.ingredientName}</span>
              <div className="flex items-center gap-4 text-right">
                <span className="text-base font-bold tabular-nums">
                  {ing.unit === "g" ? `${ing.qtyPerMix.toFixed(0)}g` : `${ing.qtyPerMix.toFixed(2)} ${ing.unit}`}
                </span>
                <span className="text-sm text-muted-foreground w-20 text-right">
                  ({ing.pctOfDough > 0 ? `${ing.pctOfDough}%` : "<0.1%"})
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}