import React, { useState, useEffect, useRef } from "react";
import {
  useListTimingStandards,
  useGetStationKpi,
  getGetStationKpiQueryKey,
  useCreateBatchCompletion,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  Loader2, CheckCircle2, Flame, RefreshCw, AlertCircle, BarChart2,
  Minus, Plus, Snowflake, X, Eye, ChevronDown,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev, isMacCheese } from "../shared/constants";
import { effectiveBatchesTarget, netTwoPacks as computeNetTwoPacks } from "../shared/recipe-completion";
import { RECIPE_RACK_COLOURS, WonkyColour, ChillerRackItem, ChillerRackVisual } from "./dough-sheeting-station";

// ──────────────────────────────────────────────────────────────────────────────
// Ovens Station
// ──────────────────────────────────────────────────────────────────────────────
export function OvensStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  // Prompt state: when a recipe finishes all batches, prompt for wonky before moving on
  const [promptItemId, setPromptItemId] = useState<number | null>(null);
  const [prevCurrentId, setPrevCurrentId] = useState<number | null>(null);
  // Track whether user manually selected a recipe (don't auto-switch until currentItem changes)
  const userOverrideRef = useRef(false);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const combinedBuildingCount = (it: ProductionPlanItem) =>
    getStationCount(it, "building_1") + getStationCount(it, "building_2");
  const effTarget = (it: ProductionPlanItem) =>
    effectiveBatchesTarget(it, combinedBuildingCount(it));
  const currentItem = items.find(it => getStationCount(it, "ovens") < effTarget(it));

  // Auto-expand current recipe, and track when it changes
  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (prevCurrentId !== null && curId !== prevCurrentId) {
      // The previous recipe just completed — prompt for wonky
      setPromptItemId(prevCurrentId);
      // Auto-expand the new current recipe
      setExpandedItemId(curId);
      userOverrideRef.current = false;
    }
    setPrevCurrentId(curId);
  }, [currentItem?.id]);

  // Initialize expanded item on first render
  useEffect(() => {
    if (expandedItemId === null && currentItem) {
      setExpandedItemId(currentItem.id);
    }
  }, [currentItem?.id]);

  const toggleExpanded = (itemId: number) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      userOverrideRef.current = false;
    } else {
      setExpandedItemId(itemId);
      userOverrideRef.current = itemId !== currentItem?.id;
    }
  };

  const addBatch = (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const avail = getAvailableFromPrev(item, "ovens");
    if (avail <= 0) {
      toast({ title: "Waiting for Building", description: "Building station must complete more batches first.", variant: "destructive" });
      return;
    }
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "ovens", completedAt: new Date().toISOString() } });
  };

  const [runBulkBatch, bulkBatchPending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  // A blast chiller tray is always 10 packs. Mac cheese only. Partial trays
  // (fewer than 10 packs of work left) use the +1/-1 buttons instead.
  const BLAST_TRAY_SIZE = 10;
  const canAdvanceBlastTray = (item: ProductionPlanItem): boolean => {
    const avail = getAvailableFromPrev(item, "ovens");
    const remaining = Math.max(0, effTarget(item) - getStationCount(item, "ovens"));
    return avail >= BLAST_TRAY_SIZE && (isAdmin || remaining >= BLAST_TRAY_SIZE);
  };
  const canUndoBlastTray = (item: ProductionPlanItem): boolean =>
    getStationCount(item, "ovens") >= BLAST_TRAY_SIZE;
  const addBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak || !canAdvanceBlastTray(item)) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "ovens", count: BLAST_TRAY_SIZE }),
      });
      toast({ title: `Blast chiller tray — ${BLAST_TRAY_SIZE} packs advanced to wrapping` });
    });
  };
  const undoBlastChillerTray = async (item: ProductionPlanItem) => {
    if (isOnBreak || !canUndoBlastTray(item)) return;
    await runBulkBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "DELETE", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "ovens", count: BLAST_TRAY_SIZE }),
      });
      toast({ title: `Blast chiller tray — ${BLAST_TRAY_SIZE} packs returned to oven queue` });
    });
  };

  const [runRemoveBatch, removePending] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const removeBatch = async (item: ProductionPlanItem) => {
    if (isOnBreak || getStationCount(item, "ovens") === 0) return;
    await runRemoveBatch(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "ovens" }),
        signal,
      });
    });
  };

  const [runWonlyAction, wonlyBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const addWonly = async (item: ProductionPlanItem) => {
    setWonlyLoading(item.id);
    await runWonlyAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "POST", signal,
      });
      toast({ title: "Wonky recorded", description: `Quality reject logged for ${item.recipeName ?? "recipe"}.` });
    });
    setWonlyLoading(null);
  };

  const undoWonly = async (item: ProductionPlanItem) => {
    if ((item.wonlyCount ?? 0) === 0) return;
    setWonlyLoading(item.id);
    await runWonlyAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "DELETE", signal,
      });
    });
    setWonlyLoading(null);
  };

  // Extra packs adjustment
  const [runExtraAction, extraBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const addExtraPack = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    await runExtraAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/extra-packs-built`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: 1 }),
      });
    });
  };

  const removeExtraPack = async (item: ProductionPlanItem) => {
    if ((item.extraPacksBuilt ?? 0) <= 0) return;
    await runExtraAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/extra-packs-built`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: -1 }),
      });
    });
  };

  // 8-Pack bag adjustment
  const [runEightPackAction, eightPackBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const addEightPackBag = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    // Need at least 4 two-packs available to make an 8-pack bag
    const availableTwoPacks = netTwoPacks(item);
    if (availableTwoPacks < 4) {
      toast({ title: "Not enough 2-packs", description: "Need at least 4 two-packs available to build an 8-pack bag.", variant: "destructive" });
      return;
    }
    await runEightPackAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/eight-pack-bag-count`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: 1 }),
      });
    });
  };

  const removeEightPackBag = async (item: ProductionPlanItem) => {
    if ((item.eightPackBagCount ?? 0) <= 0) return;
    await runEightPackAction(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/items/${item.id}/eight-pack-bag-count`, {
        method: "PATCH", signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta: -1 }),
      });
    });
  };

  const promptItem = promptItemId != null ? items.find(it => it.id === promptItemId) : null;

  const totalOvenComplete = items.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const totalTarget = items.reduce((s, it) => s + effTarget(it), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalOvenComplete / totalTarget) * 100) : 0;
  // Split totals so mac cheese items are reported as "packs", calzones as "batches".
  const calzoneItems = items.filter(it => !isMacCheese(it as any));
  const macItems = items.filter(it => isMacCheese(it as any));
  const calzoneDone = calzoneItems.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const calzoneTarget = calzoneItems.reduce((s, it) => s + effTarget(it), 0);
  const macDone = macItems.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const macTarget = macItems.reduce((s, it) => s + effTarget(it), 0);

  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item: ProductionPlanItem) => (item.eightPackBagCount ?? 0) * 4;
  const netTwoPacks = (item: ProductionPlanItem) =>
    computeNetTwoPacks(item, getStationCount(item, "ovens"));
  // netPacks includes both two-packs and eight-pack bags for tray calc
  const netPacks = (item: ProductionPlanItem) =>
    netTwoPacks(item) + (item.eightPackBagCount ?? 0);
  const chillerTrays = (item: ProductionPlanItem) =>
    netPacks(item) > 0 ? Math.ceil(netPacks(item) / 10) : 0;

  const sessionGrossPacks = items.reduce((s, it) => s + grossPacks(it), 0);
  const sessionWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const sessionNetTwoPacks = items.reduce((s, it) => s + netTwoPacks(it), 0);
  const sessionEightPackBags = items.reduce((s, it) => s + (it.eightPackBagCount ?? 0), 0);
  const sessionExtraPacks = items.reduce((s, it) => s + (it.extraPacksBuilt ?? 0), 0);
  const sessionTotalTrays = items.reduce((s, it) => s + chillerTrays(it), 0);

  // Build rack data in production order for ChillerRackVisual
  const rackItems: ChillerRackItem[] = items
    .map((item, idx) => ({
      recipeId: item.recipeId,
      recipeName: item.recipeName ?? `Recipe #${item.recipeId}`,
      trayCount: chillerTrays(item),
      colour: item.recipeColor ?? RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length],
    }))
    .filter(r => r.trayCount > 0);

  const wonkyItems: WonkyColour[] = items
    .filter(item => (item.wonlyCount ?? 0) > 0)
    .map(item => {
      const idx = items.indexOf(item);
      return {
        colour: item.recipeColor ?? RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length],
        recipeName: item.recipeName ?? `Recipe #${item.recipeId}`,
      };
    });

  return (
    <div className="space-y-4">
      {/* Overall progress + breaks */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-base font-medium">
            Daily Progress —{" "}
            {calzoneTarget > 0 && <>{calzoneDone} / {calzoneTarget} batches</>}
            {calzoneTarget > 0 && macTarget > 0 && " · "}
            {macTarget > 0 && <>{macDone} / {macTarget} mac packs</>}
          </p>
          <span className="text-2xl font-bold">{overallPct}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-red-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Wonky prompt — shown when a recipe just finished all batches */}
      {promptItem && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-bold text-lg text-amber-800 dark:text-amber-200">
                Any wonky calzones for {promptItem.recipeName ?? "this recipe"}?
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                Record any quality rejects before moving on.
                Current wonky count: <strong>{promptItem.wonlyCount ?? 0}</strong>
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => undoWonly(promptItem)}
                disabled={(promptItem.wonlyCount ?? 0) === 0 || wonlyLoading === promptItem.id || wonlyBusy}
                className="w-12 h-12 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
              >
                <Minus className="w-5 h-5" />
              </button>
              <span className="text-3xl font-bold tabular-nums w-12 text-center text-red-600 dark:text-red-400">
                {wonlyLoading === promptItem.id ? "…" : (promptItem.wonlyCount ?? 0)}
              </span>
              <button
                onClick={() => addWonly(promptItem)}
                disabled={wonlyLoading === promptItem.id || wonlyBusy}
                className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => setPromptItemId(null)}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Unified accordion queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-base">Oven Queue</h3>
          {!currentItem && (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> All done
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {items.map((item, idx) => {
            const isExpanded = expandedItemId === item.id;
            const isCurrent = item.id === currentItem?.id;
            const isComplete = getStationCount(item, "ovens") >= effTarget(item);
            const gPacks = grossPacks(item);
            const nTwoPacks = netTwoPacks(item);
            const nPacks = netPacks(item);
            const trays = chillerTrays(item);
            const wonlys = item.wonlyCount ?? 0;
            const eightPacks = item.eightPackBagCount ?? 0;
            const recipeColour = item.recipeColor ?? RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length];

            return (
              <div key={item.id}>
                {/* Collapsed summary row */}
                <button
                  onClick={() => toggleExpanded(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors",
                    isExpanded
                      ? isCurrent
                        ? "bg-red-50/60 dark:bg-red-900/15"
                        : "bg-blue-50/60 dark:bg-blue-900/15"
                      : isCurrent
                        ? "bg-red-50/40 dark:bg-red-900/10"
                        : isComplete
                          ? "bg-emerald-50/30 dark:bg-emerald-900/10"
                          : "hover:bg-secondary/20"
                  )}
                >
                  {/* Colour dot */}
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: recipeColour }} />

                  {/* Recipe name */}
                  <span
                    className={cn(
                      "flex-1 font-bold text-sm truncate",
                      isComplete && !isExpanded ? "line-through opacity-60" : ""
                    )}
                    style={{ color: recipeColour }}
                  >
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </span>

                  {/* Batch count */}
                  <span className="text-sm tabular-nums font-medium flex-shrink-0">
                    {getStationCount(item, "ovens")}/{effTarget(item)}
                  </span>

                  {/* Status icon */}
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className={cn(
                      "w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform",
                      isExpanded ? "rotate-180" : ""
                    )} />
                  )}
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className={cn(
                    "border-t-2 px-4 py-4 space-y-4",
                    isCurrent
                      ? "border-red-400 dark:border-red-600"
                      : "border-blue-300 dark:border-blue-700"
                  )}>
                    {/* Header: recipe name + built badge */}
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <h2 className="font-display text-2xl font-bold leading-tight" style={{ color: recipeColour }}>
                          {item.recipeName ?? `Recipe #${item.recipeId}`}
                        </h2>
                        {isComplete && (
                          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium mt-0.5 flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> Complete
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Waiting for building alert */}
                    {isCurrent && getAvailableFromPrev(item, "ovens") <= 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <p className="text-base text-amber-700 dark:text-amber-300">Waiting for Building to complete more batches</p>
                      </div>
                    )}

                    {/* Batch counter */}
                    {(() => {
                      const itemIsMac = isMacCheese(item as any);
                      const unitLabel = itemIsMac ? "packs" : "batches";
                      const canBlast = itemIsMac && !isOnBreak && !bulkBatchPending && !createBatch.isPending && canAdvanceBlastTray(item);
                      const canUndoBlast = itemIsMac && !isOnBreak && !bulkBatchPending && !createBatch.isPending && canUndoBlastTray(item);
                      return (
                        <>
                          <div className="flex items-center justify-center gap-6">
                            <button
                              onClick={(e) => { e.stopPropagation(); removeBatch(item); }}
                              disabled={getStationCount(item, "ovens") === 0 || isOnBreak || createBatch.isPending || removePending}
                              className="w-14 h-14 flex items-center justify-center rounded-full border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                            >
                              <Minus className="w-5 h-5" />
                            </button>
                            <div className="text-center">
                              <div className="flex items-baseline gap-2 justify-center">
                                <span className="font-display text-5xl font-bold tabular-nums text-foreground leading-none">
                                  {getStationCount(item, "ovens")}
                                </span>
                                <span className="text-xl text-muted-foreground font-light tabular-nums">
                                  / {effTarget(item)}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1 font-medium">{unitLabel}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); addBatch(item); }}
                              disabled={
                                createBatch.isPending ||
                                (getStationCount(item, "ovens") >= effTarget(item) && !isAdmin) ||
                                getAvailableFromPrev(item, "ovens") <= 0 ||
                                isOnBreak
                              }
                              className={cn(
                                "w-14 h-14 flex items-center justify-center rounded-full transition-colors disabled:opacity-50",
                                isOnBreak ? "bg-amber-300 text-amber-700" : "bg-red-500 text-white hover:bg-red-600"
                              )}
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          </div>

                          {itemIsMac && (
                            <div className="mt-3 flex items-stretch gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); undoBlastChillerTray(item); }}
                                disabled={!canUndoBlast}
                                title={canUndoBlast ? "Remove the last blast chiller tray (−10 packs)" : "Need at least 10 packs recorded at this station to undo a tray"}
                                className={cn(
                                  "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-colors",
                                  canUndoBlast
                                    ? "bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-800"
                                    : "bg-cyan-50/40 text-cyan-400 border border-cyan-100 dark:bg-cyan-900/10 dark:text-cyan-500 dark:border-cyan-900 opacity-70 cursor-not-allowed",
                                )}
                              >
                                <Minus className="w-5 h-5" />
                                −10
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); addBlastChillerTray(item); }}
                                disabled={!canBlast}
                                className={cn(
                                  "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-colors",
                                  canBlast
                                    ? "bg-cyan-600 text-white hover:bg-cyan-700"
                                    : "bg-cyan-100 text-cyan-500 dark:bg-cyan-900/20 dark:text-cyan-300 opacity-60 cursor-not-allowed",
                                )}
                              >
                                <Snowflake className="w-5 h-5" />
                                Blast Chiller Tray (+10 packs)
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Stats: net 2-packs + 8-packs + chiller trays + wonky */}
                    <div className="flex items-center justify-center gap-6 pb-3 border-b border-border/50">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground font-medium mb-0.5">Net 2-Pk</p>
                        <p className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                          {nTwoPacks}
                        </p>
                      </div>
                      {eightPacks > 0 && (
                        <>
                          <div className="w-px h-7 bg-border/60" />
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground font-medium mb-0.5">8-Packs</p>
                            <p className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{eightPacks}</p>
                          </div>
                        </>
                      )}
                      <div className="w-px h-7 bg-border/60" />
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground font-medium mb-0.5">Chiller Trays</p>
                        <p className="text-2xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                          {trays}
                        </p>
                      </div>
                      {wonlys > 0 && (
                        <>
                          <div className="w-px h-7 bg-border/60" />
                          <div className="text-center">
                            <p className="text-xs text-muted-foreground font-medium mb-0.5">Wonky</p>
                            <p className="text-2xl font-bold tabular-nums text-red-500">{wonlys}</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Wonky quality rejects */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">Quality Rejects (Wonky)</p>
                        <p className="text-xs text-muted-foreground">Not counted in output</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); undoWonly(item); }}
                          disabled={(item.wonlyCount ?? 0) === 0 || wonlyLoading === item.id || wonlyBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-2xl font-bold tabular-nums w-9 text-center text-red-600 dark:text-red-400">
                          {wonlyLoading === item.id ? "…" : wonlys}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); addWonly(item); }}
                          disabled={wonlyLoading === item.id || wonlyBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Extra packs */}
                    <div className="flex items-center justify-between border-t border-border pt-3">
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">Extra Packs</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeExtraPack(item); }}
                          disabled={(item.extraPacksBuilt ?? 0) <= 0 || extraBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-2xl font-bold tabular-nums w-9 text-center text-emerald-600 dark:text-emerald-400">
                          {item.extraPacksBuilt ?? 0}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); addExtraPack(item); }}
                          disabled={extraBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* 8-Pack Bags */}
                    <div className="flex items-center justify-between border-t border-border pt-3">
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">8-Pack Bags</p>
                        <p className="text-xs text-muted-foreground">Uses 4 two-packs each</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeEightPackBag(item); }}
                          disabled={(item.eightPackBagCount ?? 0) <= 0 || eightPackBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-2xl font-bold tabular-nums w-9 text-center text-indigo-600 dark:text-indigo-400">
                          {item.eightPackBagCount ?? 0}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); addEightPackBag(item); }}
                          disabled={eightPackBusy || isOnBreak}
                          className="w-10 h-10 flex items-center justify-center rounded-full bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Session totals */}
      <div className={cn("grid gap-2", sessionEightPackBags > 0 ? "grid-cols-5" : "grid-cols-4")}>
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-sm text-muted-foreground mb-1">Gross Packs</p>
          <p className="text-2xl font-bold tabular-nums">{sessionGrossPacks}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
          <p className="text-sm text-red-700 dark:text-red-300 mb-1">Wonky</p>
          <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{sessionWonly}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Net 2-Pk</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sessionNetTwoPacks}</p>
          {sessionExtraPacks > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">+{sessionExtraPacks} extra</p>
          )}
        </div>
        {sessionEightPackBags > 0 && (
          <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 text-center">
            <p className="text-sm text-indigo-700 dark:text-indigo-300 mb-1">8-Packs</p>
            <p className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{sessionEightPackBags}</p>
          </div>
        )}
        <div className="bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-3 text-center">
          <p className="text-sm text-cyan-700 dark:text-cyan-300 mb-1">Trays</p>
          <p className="text-2xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">{sessionTotalTrays}</p>
        </div>
      </div>

      {/* Chiller Rack Visual */}
      <ChillerRackVisual rackItems={rackItems} wonkyItems={wonkyItems} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
