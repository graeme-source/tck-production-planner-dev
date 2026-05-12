import React, { useState, useEffect, useRef } from "react";
import {
  useCreateBatchCompletion,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, ChevronRight, ChevronDown, Info, Minus, Plus, Package, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { BreakTracker } from "../shared/break-tracker";
import { getStationCount, compareItemsForDisplay } from "../shared/constants";
import { useDoughPrepData } from "./dough-prep-station";

// ──────────────────────────────────────────────────────────────────────────────
// Dough Sheeting Station
// ──────────────────────────────────────────────────────────────────────────────
export function DoughSheetingStation({ plan, isOnBreak = false }: { plan: ProductionPlanDetail; isOnBreak?: boolean }) {
  const queryClient = useQueryClient();
  const { data: doughData } = useDoughPrepData(plan.id, "current");
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const userOverrideRef = useRef(false);

  // Extra ball sheeting state — per-ball ticks in app_settings
  const extraSheetKey = `extra_balls_sheeted_${plan.id}`;
  const [extraSheetTicks, setExtraSheetTicks] = useState<Record<string, boolean>>({});
  const [extraSheetLoaded, setExtraSheetLoaded] = useState(false);
  const [showExtraSection, setShowExtraSection] = useState(false);

  useEffect(() => {
    fetch(`/api/app-settings/${extraSheetKey}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value) {
          try { setExtraSheetTicks(JSON.parse(d.value)); } catch (err) { console.warn("[DoughSheeting] Extra sheet ticks parse failed:", err); }
        }
        setExtraSheetLoaded(true);
      })
      .catch((err) => { console.warn("[DoughSheeting] Extra sheet ticks fetch failed:", err); setExtraSheetLoaded(true); });
  }, [extraSheetKey]);

  const saveSheetTicks = (updated: Record<string, boolean>) => {
    fetch(`/api/app-settings/${extraSheetKey}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(updated) }),
    }).catch((err) => { console.warn("[DoughSheeting] Extra sheet ticks save failed:", err); });
  };

  const toggleSheetTick = (key: string) => {
    const updated = { ...extraSheetTicks, [key]: !extraSheetTicks[key] };
    setExtraSheetTicks(updated);
    saveSheetTicks(updated);
  };

  const extraBalls = doughData?.extraBalls;
  const extraSheetItems: Array<{ key: string; label: string; weightG: number }> = [];
  if (extraBalls) {
    for (let i = 0; i < extraBalls.extraPack.count; i++) {
      extraSheetItems.push({ key: `extraPack_${i}`, label: `Extra Pack Ball ${extraBalls.extraPack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.extraPack.weightG });
    }
    for (let i = 0; i < extraBalls.snack.count; i++) {
      extraSheetItems.push({ key: `snack_${i}`, label: `Snack Ball ${extraBalls.snack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.snack.weightG });
    }
  }
  const allExtrasSheeted = extraSheetItems.length > 0 && extraSheetItems.every(e => extraSheetTicks[e.key]);
  const someExtrasSheeted = extraSheetItems.some(e => extraSheetTicks[e.key]);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const items = [...(plan.items ?? [])].sort(compareItemsForDisplay);

  const nextItem = items.find(it => {
    const sheeted = getStationCount(it, "dough_sheeting");
    const target = it.batchesTarget ?? 0;
    return target > 0 && sheeted < target;
  });

  // Auto-expand current recipe
  const [prevNextId, setPrevNextId] = useState<number | null>(null);
  useEffect(() => {
    const curId = nextItem?.id ?? null;
    if (prevNextId !== null && curId !== prevNextId) {
      setExpandedItemId(curId);
      userOverrideRef.current = false;
    }
    setPrevNextId(curId);
  }, [nextItem?.id]);

  useEffect(() => {
    if (expandedItemId === null && nextItem) {
      setExpandedItemId(nextItem.id);
    }
  }, [nextItem?.id]);

  const toggleExpanded = (itemId: number) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      userOverrideRef.current = false;
    } else {
      setExpandedItemId(itemId);
      userOverrideRef.current = itemId !== nextItem?.id;
    }
  };

  const sheetBatch = (itemId: number) => {
    if (isOnBreak) return;
    createBatch.mutate({ id: plan.id, data: { planItemId: itemId, stationType: "dough_sheeting" } });
  };

  const [runUndo, undoBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const undoBatch = async (itemId: number) => {
    if (isOnBreak) return;
    await runUndo(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: itemId, stationType: "dough_sheeting" }),
        signal,
      });
    });
  };

  const totalSheeted = items.reduce((s, it) => s + getStationCount(it, "dough_sheeting"), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallProgress = totalTarget > 0 ? Math.round((totalSheeted / totalTarget) * 100) : 0;
  const allDone = totalTarget > 0 && totalSheeted >= totalTarget;

  return (
    <div className="space-y-4">
      {/* Progress + break tracker */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-base font-medium">Daily Progress — {totalSheeted} / {totalTarget} batches</p>
          <span className="text-2xl font-bold">{overallProgress}%</span>
        </div>
        <div className="w-full bg-secondary rounded-full h-2.5 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", allDone ? "bg-emerald-500" : "bg-amber-500")}
            style={{ width: `${Math.min(overallProgress, 100)}%` }}
          />
        </div>
      </div>

      {/* Sheet Extra Balls — secondary collapsible */}
      {extraSheetLoaded && extraSheetItems.length > 0 && (
        <div className={cn(
          "bg-card border rounded-xl overflow-hidden transition-all",
          allExtrasSheeted ? "border-emerald-300 dark:border-emerald-700" : someExtrasSheeted ? "border-primary/30" : "border-border/60"
        )}>
          <button
            onClick={() => setShowExtraSection(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-base font-medium text-muted-foreground">Sheet Daily Extras</span>
              {(someExtrasSheeted || allExtrasSheeted) && (
                <span className="text-sm bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {extraSheetItems.filter(e => extraSheetTicks[e.key]).length}/{extraSheetItems.length}
                </span>
              )}
              {allExtrasSheeted && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            </div>
            <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", showExtraSection && "rotate-90")} />
          </button>
          {showExtraSection && (
            <div className="px-4 pb-4 space-y-2 border-t border-border/50">
              <p className="text-sm text-muted-foreground pt-3">Tick each extra ball as it's sheeted and passed to building.</p>
              {extraSheetItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => toggleSheetTick(item.key)}
                  disabled={isOnBreak}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                    extraSheetTicks[item.key]
                      ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10"
                      : "border-border bg-secondary/20 hover:bg-secondary/40 disabled:opacity-50"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
                    extraSheetTicks[item.key] ? "bg-emerald-500 border-emerald-500" : "border-border bg-background"
                  )}>
                    {extraSheetTicks[item.key] && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className={cn("text-base font-medium flex-1", extraSheetTicks[item.key] && "line-through text-muted-foreground")}>
                    {item.label}
                  </span>
                  <span className="text-sm text-muted-foreground">{item.weightG}g</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unified accordion queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-base">Sheeting Queue</h3>
          {allDone && (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> All done
            </span>
          )}
        </div>

        <div className="divide-y divide-border/50">
          {items.map(item => {
            const target = item.batchesTarget ?? 0;
            const sheeted = getStationCount(item, "dough_sheeting");
            const isDone = sheeted >= target && target > 0;
            const isCurrent = item.id === nextItem?.id;
            const isExpanded = expandedItemId === item.id;
            const ballWeight = doughData?.recipes.find(r => r.recipeId === item.recipeId)?.ballWeightG;
            const progress = target > 0 ? Math.round((sheeted / target) * 100) : 0;
            const recipeColour = item.recipeColor || undefined;

            return (
              <div key={item.id}>
                {/* Collapsed summary row */}
                <button
                  onClick={() => toggleExpanded(item.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors",
                    isExpanded
                      ? isCurrent
                        ? "bg-amber-50/60 dark:bg-amber-900/15"
                        : "bg-blue-50/60 dark:bg-blue-900/15"
                      : isCurrent
                        ? "bg-amber-50/40 dark:bg-amber-900/10"
                        : isDone
                          ? "bg-emerald-50/30 dark:bg-emerald-900/10"
                          : "hover:bg-secondary/20"
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 font-bold text-sm truncate",
                      isDone && !isExpanded ? "line-through opacity-60" : ""
                    )}
                    style={{ color: recipeColour }}
                  >
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </span>

                  <span className="text-sm tabular-nums font-medium flex-shrink-0">
                    {sheeted}/{target}
                  </span>
                  {ballWeight && (
                    <span className="text-xs tabular-nums text-muted-foreground flex-shrink-0">
                      {ballWeight}g
                    </span>
                  )}

                  {isDone ? (
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
                    "border-t-2 px-4 py-4 space-y-3",
                    isCurrent
                      ? "border-amber-400 dark:border-amber-600"
                      : "border-blue-300 dark:border-blue-700"
                  )}>
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-2xl font-bold leading-tight" style={{ color: recipeColour }}>
                        {item.recipeName ?? `Recipe #${item.recipeId}`}
                      </h2>
                      <div className="text-right">
                        <p className="text-3xl font-bold font-display tabular-nums">
                          {sheeted} <span className="text-lg text-muted-foreground font-normal">/ {target}</span>
                        </p>
                      </div>
                    </div>

                    {ballWeight && (
                      <p className="text-base text-muted-foreground">
                        Ball weight: <span className="font-semibold text-amber-600 dark:text-amber-400">{ballWeight}g</span>
                      </p>
                    )}

                    {/* Progress bar */}
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className={cn("h-2 rounded-full transition-all", isDone ? "bg-emerald-500" : "bg-amber-500")}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>

                    {isDone && (
                      <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Complete
                      </p>
                    )}

                    {/* Sheet / Undo buttons */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => undoBatch(item.id)}
                        disabled={isOnBreak || sheeted === 0 || createBatch.isPending || undoBusy}
                        className="flex items-center gap-1.5 px-4 py-3 text-base rounded-xl border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Minus className="w-4 h-4" />
                        {undoBusy ? "Undoing\u2026" : "Undo"}
                      </button>
                      <button
                        onClick={() => sheetBatch(item.id)}
                        disabled={isOnBreak || isDone || createBatch.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-6 py-3 text-base rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                        Sheet Batch
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mac cheese items — display only (no sheeting required) */}
      {(() => {
        const macItems = (plan.items ?? []).filter(it => (it as any).recipeCategory === "Macaroni Cheese");
        if (macItems.length === 0) return null;
        return (
          <div className="bg-card border border-yellow-200 dark:border-yellow-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20">
              <h3 className="font-semibold text-base text-yellow-700 dark:text-yellow-400">Also on today's plan — No sheeting required</h3>
            </div>
            <div className="divide-y divide-border/40">
              {macItems.map(it => (
                <div key={it.id} className="flex items-center justify-between px-4 py-2.5 opacity-70">
                  <span className="text-sm font-medium">{it.recipeName}</span>
                  <span className="text-xs text-muted-foreground bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded">
                    {it.batchesTarget} batches — Mac Cheese
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Chiller Rack Visual — rolling bakery rack with tray-level recipe colour coding
// ──────────────────────────────────────────────────────────────────────────────
export const RECIPE_RACK_COLOURS = [
  '#7a8a48', '#d4883a', '#4a7fa8', '#8a4fa8', '#b04a4a',
  '#3a9470', '#c4b030', '#a07040', '#4a5ea8', '#a84a7a',
  '#2e8f8f', '#7a944a', '#6a6aa8', '#a86a3a', '#3a7a60',
];

export interface ChillerRackItem {
  recipeId: number;
  recipeName: string;
  trayCount: number;
  colour: string;
}

export interface WonkyColour {
  colour: string;
  recipeName: string;
}

export function ChillerRackVisual({
  rackItems,
  wonkyItems = [],
}: {
  rackItems: ChillerRackItem[];
  wonkyItems?: WonkyColour[];
}) {
  const TRAYS_PER_RACK = 28;
  const hasWonky = wonkyItems.length > 0;

  // Build regular trays in production order
  const allRegularTrays: Array<{ colour: string; recipeName: string }> = [];
  for (const r of rackItems) {
    for (let t = 0; t < r.trayCount; t++) {
      allRegularTrays.push({ colour: r.colour, recipeName: r.recipeName });
    }
  }

  if (allRegularTrays.length === 0 && !hasWonky) return null;

  // Wonky tray sits at position 28 (the bottom) of rack 1.
  // Reserve that slot — regular trays only fill positions 1-27 of rack 1.
  const regularSlotsRack1 = hasWonky ? TRAYS_PER_RACK - 1 : TRAYS_PER_RACK;

  // Split trays across racks
  const rack1Regular = allRegularTrays.slice(0, regularSlotsRack1);
  const rack2Regular = allRegularTrays.slice(regularSlotsRack1, regularSlotsRack1 + TRAYS_PER_RACK);
  const overflow = allRegularTrays.length > regularSlotsRack1 + TRAYS_PER_RACK
    ? allRegularTrays.length - regularSlotsRack1 - TRAYS_PER_RACK
    : 0;

  const showRack2 = rack2Regular.length > 0;

  const renderRack = (
    regularTrays: Array<{ colour: string; recipeName: string }>,
    totalSlots: number,
    rackLabel: string,
    wonky: boolean,
  ) => {
    const emptySlots = Math.max(0, totalSlots - regularTrays.length - (wonky ? 1 : 0));
    return (
      <div className="bg-card border border-border rounded-xl p-3 flex-1 min-w-[140px]">
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 text-center tracking-wider">{rackLabel}</p>
        <div className="flex flex-col gap-[3px]">
          {/* Regular trays, top-down */}
          {regularTrays.map((t, i) => (
            <div
              key={i}
              className="h-3 rounded-[3px]"
              style={{ backgroundColor: t.colour }}
              title={t.recipeName}
            />
          ))}
          {/* Empty slots */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`e-${i}`} className="h-3 rounded-[3px] bg-secondary/40" />
          ))}
          {/* Wonky slot */}
          {wonky && (
            <div className="h-3 rounded-[3px] mt-px relative overflow-hidden" title={`Wonky: ${wonkyItems.map(w => w.recipeName).join(", ")}`}>
              <div className="flex h-full">
                {wonkyItems.map((w, i) => (
                  <div
                    key={i}
                    className="h-full flex-1"
                    style={{
                      backgroundColor: w.colour,
                      backgroundImage: "repeating-linear-gradient(135deg,transparent,transparent 2px,rgba(255,0,0,0.25) 2px,rgba(255,0,0,0.25) 4px)",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className={cn("flex gap-3", !showRack2 && "max-w-xs")}>
        {renderRack(rack1Regular, TRAYS_PER_RACK, "Rack 1", hasWonky)}
        {showRack2 && renderRack(rack2Regular, TRAYS_PER_RACK, "Rack 2", false)}
      </div>
      {overflow > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400 text-center">+{overflow} trays won't fit — need another rack!</p>
      )}
      {/* Legend */}
      <div className="flex flex-wrap gap-2 justify-center">
        {rackItems.map(r => (
          <div key={r.recipeId} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: r.colour }} />
            <span className="text-xs text-muted-foreground">{r.recipeName} ({r.trayCount})</span>
          </div>
        ))}
        {hasWonky && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[2px] bg-red-400" style={{ backgroundImage: "repeating-linear-gradient(135deg,transparent,transparent 2px,rgba(255,0,0,0.3) 2px,rgba(255,0,0,0.3) 4px)" }} />
            <span className="text-xs text-red-500 font-medium">Wonky</span>
          </div>
        )}
      </div>
    </div>
  );
}
