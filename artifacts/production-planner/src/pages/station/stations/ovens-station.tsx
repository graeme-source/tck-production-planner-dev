import React, { useState, useEffect } from "react";
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
  Minus, Plus, Snowflake, X, Eye,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { getStationCount, getAvailableFromPrev, getPrevStationCount } from "../shared/constants";
import { RECIPE_RACK_COLOURS, WonkyColour, ChillerRackItem, ChillerRackVisual } from "./dough-sheeting-station";

// ──────────────────────────────────────────────────────────────────────────────
// Ovens Station
// ──────────────────────────────────────────────────────────────────────────────
export function OvensStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  // Prompt state: when a recipe finishes all batches, prompt for wonky before moving on
  const [promptItemId, setPromptItemId] = useState<number | null>(null);
  const [prevCurrentId, setPrevCurrentId] = useState<number | null>(null);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => getStationCount(it, "ovens") < (it.batchesTarget ?? 0));

  // Detect when the current recipe changes (one recipe finished, moved to next)
  // and prompt for wonky packs on the just-completed recipe.
  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (prevCurrentId !== null && curId !== prevCurrentId) {
      // The previous recipe just completed — prompt for wonky
      setPromptItemId(prevCurrentId);
    }
    setPrevCurrentId(curId);
  }, [currentItem?.id]);

  const addBatch = (item: ProductionPlanItem) => {
    if (isOnBreak) return;
    const avail = getAvailableFromPrev(item, "ovens");
    if (avail <= 0) {
      toast({ title: "Waiting for Building", description: "Building station must complete more batches first.", variant: "destructive" });
      return;
    }
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "ovens", completedAt: new Date().toISOString() } });
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

  // 8-pack bag adjustment
  const [runEightPackAction, eightPackBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const addEightPackBag = async (item: ProductionPlanItem) => {
    // Ensure enough gross packs for another 8-pack bag (need 4 two-packs per 8-pack bag)
    const availableTwoPacks = grossPacks(item) - eightPackDeduction(item) - (item.wonlyCount ?? 0) - (item.shortCount ?? 0) + (item.extraPacksBuilt ?? 0);
    if (availableTwoPacks < 4) {
      toast({ title: "Not enough packs", description: "Need at least 4 more two-packs to make an 8-pack bag.", variant: "destructive" });
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

  const selectedItem = selectedItemId != null ? items.find(it => it.id === selectedItemId) : null;
  const promptItem = promptItemId != null ? items.find(it => it.id === promptItemId) : null;

  const totalOvenComplete = items.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalOvenComplete / totalTarget) * 100) : 0;

  // Packs: half of (oven batches × portionsPerBatch) since each batch produces 2 packs per portion pair
  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const eightPackDeduction = (item: ProductionPlanItem) => (item.eightPackBagCount ?? 0) * 4;
  const netTwoPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - eightPackDeduction(item) - (item.wonlyCount ?? 0) - (item.shortCount ?? 0)) + (item.extraPacksBuilt ?? 0);
  // Keep netPacks as alias for backward compat in chiller tray calc (2-packs + 8-pack bags as total packs for tray count)
  const netPacks = (item: ProductionPlanItem) =>
    netTwoPacks(item) + (item.eightPackBagCount ?? 0);
  // Chiller trays: never combine two recipes on one tray — each recipe's packs fill independently
  const chillerTrays = (item: ProductionPlanItem) =>
    netPacks(item) > 0 ? Math.ceil(netPacks(item) / 10) : 0;

  const sessionGrossPacks = items.reduce((s, it) => s + grossPacks(it), 0);
  const sessionWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const sessionEightPackBags = items.reduce((s, it) => s + (it.eightPackBagCount ?? 0), 0);
  const sessionNetPacks = items.reduce((s, it) => s + netPacks(it), 0);
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

  // Wonky items — recipes that have at least one wonky pack get a shared tray at the bottom of rack 1
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
          <p className="text-base font-medium">Daily Progress — {totalOvenComplete} / {totalTarget} batches</p>
          <span className="text-2xl font-bold">{overallPct}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-red-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="ovens" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {/* Current recipe — batches as focus */}
      {currentItem ? (
        <div className="bg-card border-2 border-red-400 dark:border-red-600 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">
                In Ovens Now
              </p>
              <h2 className="font-display text-3xl font-bold leading-tight">
                {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
              </h2>
            </div>
            {/* Built from building station — context only */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-1.5 text-center flex-shrink-0">
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">Built</p>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                {getPrevStationCount(currentItem, "ovens")}
              </p>
            </div>
          </div>

          {getAvailableFromPrev(currentItem, "ovens") <= 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg mb-3">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-base text-amber-700 dark:text-amber-300">Waiting for Building to complete more batches</p>
            </div>
          )}

          {/* Primary: batch counter */}
          <div className="flex items-center justify-center gap-6 my-5">
            <button
              onClick={() => removeBatch(currentItem)}
              disabled={getStationCount(currentItem, "ovens") === 0 || isOnBreak || createBatch.isPending || removePending}
              className="w-14 h-14 flex items-center justify-center rounded-full border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-5 h-5" />
            </button>
            <div className="text-center">
              <div className="flex items-baseline gap-2 justify-center">
                <span className="font-display text-6xl font-bold tabular-nums text-foreground leading-none">
                  {getStationCount(currentItem, "ovens")}
                </span>
                <span className="text-2xl text-muted-foreground font-light tabular-nums">
                  / {currentItem.batchesTarget ?? 0}
                </span>
              </div>
              <p className="text-base text-muted-foreground mt-1.5 font-medium">batches</p>
            </div>
            <button
              onClick={() => addBatch(currentItem)}
              disabled={
                createBatch.isPending ||
                (getStationCount(currentItem, "ovens") >= (currentItem.batchesTarget ?? 0) && !isAdmin) ||
                getAvailableFromPrev(currentItem, "ovens") <= 0 ||
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

          {/* Secondary: net packs + chiller trays */}
          <div className="flex items-center justify-center gap-6 pb-4 border-b border-border/50 mb-3">
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-medium mb-0.5">Net Packs</p>
              <p className="text-3xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {netPacks(currentItem)}
              </p>
            </div>
            <div className="w-px h-8 bg-border/60" />
            <div className="text-center">
              <p className="text-sm text-muted-foreground font-medium mb-0.5">Chiller Trays</p>
              <p className="text-3xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                {chillerTrays(currentItem)}
              </p>
            </div>
            {(currentItem.wonlyCount ?? 0) > 0 && (
              <>
                <div className="w-px h-8 bg-border/60" />
                <div className="text-center">
                  <p className="text-sm text-muted-foreground font-medium mb-0.5">Wonky</p>
                  <p className="text-3xl font-bold tabular-nums text-red-500">{currentItem.wonlyCount}</p>
                </div>
              </>
            )}
          </div>

          {/* Wonky quality rejects */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Quality Rejects (Wonky)</p>
              <p className="text-sm text-muted-foreground">Not counted in output</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => undoWonly(currentItem)}
                disabled={(currentItem.wonlyCount ?? 0) === 0 || wonlyLoading === currentItem.id || wonlyBusy || isOnBreak}
                className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-2xl font-bold tabular-nums w-9 text-center text-red-600 dark:text-red-400">
                {wonlyLoading === currentItem.id ? "…" : (currentItem.wonlyCount ?? 0)}
              </span>
              <button
                onClick={() => addWonly(currentItem)}
                disabled={wonlyLoading === currentItem.id || wonlyBusy || isOnBreak}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 8-Pack Bags — deducts from 2-pack output (each bag = 4 fewer 2-packs) */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">8-Pack Bags</p>
              <p className="text-sm text-muted-foreground">
                {(currentItem.eightPackBagCount ?? 0) > 0
                  ? `Deducts ${eightPackDeduction(currentItem)} from 2-packs → ${netTwoPacks(currentItem)} two-packs remain`
                  : "Deducts 4 two-packs per bag"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => removeEightPackBag(currentItem)}
                disabled={(currentItem.eightPackBagCount ?? 0) === 0 || eightPackBusy || isOnBreak}
                className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-2xl font-bold tabular-nums w-9 text-center text-indigo-600 dark:text-indigo-400">
                {eightPackBusy ? "…" : (currentItem.eightPackBagCount ?? 0)}
              </span>
              <button
                onClick={() => addEightPackBag(currentItem)}
                disabled={eightPackBusy || isOnBreak}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-xl mb-1">All ovens done!</h2>
          <p className="text-muted-foreground text-base">All recipes through the ovens for today.</p>
        </div>
      )}

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

      {/* Selected recipe editing panel — tap any recipe in the queue to edit */}
      {selectedItem && (
        <div className="bg-card border-2 border-blue-300 dark:border-blue-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-700">
            <Eye className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg leading-tight truncate">
                {selectedItem.recipeName ?? `Recipe #${selectedItem.recipeId}`}
              </h3>
              <p className="text-sm text-muted-foreground">
                {getStationCount(selectedItem, "ovens")} / {selectedItem.batchesTarget ?? 0} batches
                {" · "}{netPacks(selectedItem)} net packs
                {(selectedItem.wonlyCount ?? 0) > 0 && ` · ${selectedItem.wonlyCount} wonky`}
              </p>
            </div>
            <button
              onClick={() => setSelectedItemId(null)}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-500 transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Batch adjustment */}
            <div>
              <p className="text-sm font-semibold text-muted-foreground mb-2">Batches</p>
              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={() => removeBatch(selectedItem)}
                  disabled={getStationCount(selectedItem, "ovens") === 0 || isOnBreak || removePending}
                  className="w-12 h-12 flex items-center justify-center rounded-full border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <span className="font-display text-4xl font-bold tabular-nums">
                    {getStationCount(selectedItem, "ovens")}
                  </span>
                  <span className="text-xl text-muted-foreground font-light tabular-nums ml-1">
                    / {selectedItem.batchesTarget ?? 0}
                  </span>
                </div>
                <button
                  onClick={() => addBatch(selectedItem)}
                  disabled={
                    createBatch.isPending ||
                    (getStationCount(selectedItem, "ovens") >= (selectedItem.batchesTarget ?? 0) && !isAdmin) ||
                    getAvailableFromPrev(selectedItem, "ovens") <= 0 ||
                    isOnBreak
                  }
                  className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Wonky adjustment */}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Wonky</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => undoWonly(selectedItem)}
                  disabled={(selectedItem.wonlyCount ?? 0) === 0 || wonlyLoading === selectedItem.id || wonlyBusy || isOnBreak}
                  className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-2xl font-bold tabular-nums w-9 text-center text-red-600 dark:text-red-400">
                  {wonlyLoading === selectedItem.id ? "…" : (selectedItem.wonlyCount ?? 0)}
                </span>
                <button
                  onClick={() => addWonly(selectedItem)}
                  disabled={wonlyLoading === selectedItem.id || wonlyBusy || isOnBreak}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Extra packs adjustment */}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Extra Packs</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => removeExtraPack(selectedItem)}
                  disabled={(selectedItem.extraPacksBuilt ?? 0) <= 0 || extraBusy || isOnBreak}
                  className="w-10 h-10 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-2xl font-bold tabular-nums w-9 text-center text-emerald-600 dark:text-emerald-400">
                  {selectedItem.extraPacksBuilt ?? 0}
                </span>
                <button
                  onClick={() => addExtraPack(selectedItem)}
                  disabled={extraBusy || isOnBreak}
                  className="w-10 h-10 flex items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session totals */}
      <div className="grid grid-cols-5 gap-2">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-sm text-muted-foreground mb-1">Gross</p>
          <p className="text-2xl font-bold tabular-nums">{sessionGrossPacks}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
          <p className="text-sm text-red-700 dark:text-red-300 mb-1">Wonky</p>
          <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{sessionWonly}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Net 2-Pk</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{items.reduce((s, it) => s + netTwoPacks(it), 0)}</p>
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

      {/* Per-recipe summary table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-base">Oven Queue</h3>
        </div>
        <table className="w-full text-base">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-sm text-muted-foreground">
              <th className="py-2 px-3 text-left font-medium">Recipe</th>
              <th className="py-2 px-3 text-center font-medium">Batches</th>
              <th className="py-2 px-3 text-center font-medium">Packs</th>
              <th className="py-2 px-3 text-center font-medium">Wonky</th>
              <th className="py-2 px-3 text-center font-medium">Net</th>
              <th className="py-2 px-3 text-center font-medium">
                <Snowflake className="w-3.5 h-3.5 inline text-cyan-500" />
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const isCurrentRow = item.id === currentItem?.id;
              const gPacks = grossPacks(item);
              const nPacks = netPacks(item);
              const trays = chillerTrays(item);
              const wonlys = item.wonlyCount ?? 0;
              const recipeColour = item.recipeColor ?? RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length];
              return (
                <tr
                  key={item.id}
                  onClick={() => setSelectedItemId(selectedItemId === item.id ? null : item.id)}
                  className={cn(
                    "border-b border-border/50 last:border-0 cursor-pointer transition-colors",
                    selectedItemId === item.id ? "bg-blue-50/60 dark:bg-blue-900/20 ring-1 ring-blue-300 dark:ring-blue-700" :
                    isCurrentRow ? "bg-red-50/40 dark:bg-red-900/10" :
                    item.status === "complete" ? "bg-emerald-50/30 dark:bg-emerald-900/10" : "hover:bg-secondary/20"
                  )}>
                  <td className={cn("py-2 px-3 font-medium text-sm", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    <div className="flex items-center gap-1.5">
                      {trays > 0 && (
                        <div className="w-2.5 h-2.5 rounded-[2px] flex-shrink-0" style={{ backgroundColor: recipeColour }} />
                      )}
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-sm font-medium">
                    {getStationCount(item, "ovens")}/{item.batchesTarget ?? 0}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-sm">{gPacks > 0 ? gPacks : "—"}</td>
                  <td className="py-2 px-3 text-center tabular-nums text-sm">
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn(wonlys > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground")}>
                        {wonlys}
                      </span>
                      {isCurrentRow && (
                        <button
                          onClick={() => addWonly(item)}
                          disabled={wonlyLoading === item.id || wonlyBusy}
                          className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center ml-0.5"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {netTwoPacks(item) > 0 ? netTwoPacks(item) : "—"}
                    {(item.eightPackBagCount ?? 0) > 0 && (
                      <span className="ml-1 text-xs font-normal text-indigo-500" title={`${item.eightPackBagCount} eight-pack bags`}>+{item.eightPackBagCount}×8pk</span>
                    )}
                    {(item.extraPacksBuilt ?? 0) > 0 && (
                      <span className="ml-1 text-amber-500" title={`Includes ${item.extraPacksBuilt} extra`}>●</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-sm font-semibold text-cyan-600 dark:text-cyan-400">
                    {trays > 0 ? trays : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────