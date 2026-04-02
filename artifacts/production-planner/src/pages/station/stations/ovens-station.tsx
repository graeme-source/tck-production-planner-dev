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
  Minus, Plus, Snowflake,
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

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => getStationCount(it, "ovens") < (it.batchesTarget ?? 0));

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

  const totalOvenComplete = items.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalOvenComplete / totalTarget) * 100) : 0;

  // Packs: half of (oven batches × portionsPerBatch) since each batch produces 2 packs per portion pair
  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const netPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - (item.wonlyCount ?? 0)) + (item.extraPacksBuilt ?? 0);
  // Chiller trays: never combine two recipes on one tray — each recipe's packs fill independently
  const chillerTrays = (item: ProductionPlanItem) =>
    netPacks(item) > 0 ? Math.ceil(netPacks(item) / 10) : 0;

  const sessionGrossPacks = items.reduce((s, it) => s + grossPacks(it), 0);
  const sessionWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
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
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-xl mb-1">All ovens done!</h2>
          <p className="text-muted-foreground text-base">All recipes through the ovens for today.</p>
        </div>
      )}

      {/* Session totals */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-sm text-muted-foreground mb-1">Gross Packs</p>
          <p className="text-2xl font-bold tabular-nums">{sessionGrossPacks}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
          <p className="text-sm text-red-700 dark:text-red-300 mb-1">Wonky</p>
          <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{sessionWonly}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
          <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Net Packs</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sessionNetPacks}</p>
          {sessionExtraPacks > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">+{sessionExtraPacks} extra</p>
          )}
        </div>
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
                <tr key={item.id} className={cn(
                  "border-b border-border/50 last:border-0",
                  isCurrentRow ? "bg-red-50/40 dark:bg-red-900/10" :
                  item.status === "complete" ? "bg-emerald-50/30 dark:bg-emerald-900/10" : ""
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
                    {nPacks > 0 ? nPacks : "—"}
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