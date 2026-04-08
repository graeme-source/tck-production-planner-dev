import React, { useState, useEffect } from "react";
import {
  useCreateBatchCompletion,
  getGetProductionPlanQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, CheckCircle2, ChevronRight, Info, Minus, Plus, Package, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useGuardedAction, guardedFetch } from "@/hooks/use-guarded-action";
import { BreakTracker } from "../shared/break-tracker";
import { getStationCount } from "../shared/constants";
import { useDoughPrepData } from "./dough-prep-station";

// ──────────────────────────────────────────────────────────────────────────────
// Dough Sheeting Station
// ──────────────────────────────────────────────────────────────────────────────
export function DoughSheetingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { data: doughData } = useDoughPrepData(plan.id, "current");
  const [isOnBreak, setIsOnBreak] = useState(false);

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

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const nextItem = items.find(it => {
    const sheeted = getStationCount(it, "dough_sheeting");
    const target = it.batchesTarget ?? 0;
    return target > 0 && sheeted < target;
  });

  const sheetNext = () => {
    if (isOnBreak || !nextItem) return;
    createBatch.mutate({ id: plan.id, data: { planItemId: nextItem.id, stationType: "dough_sheeting" } });
  };

  const [runUndo, undoBusy] = useGuardedAction({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
  });

  const undoLast = async () => {
    if (isOnBreak) return;
    const lastItemWithCount = [...items].reverse().find(it => getStationCount(it, "dough_sheeting") > 0);
    if (!lastItemWithCount) return;
    await runUndo(async (signal) => {
      await guardedFetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: lastItemWithCount.id, stationType: "dough_sheeting" }),
        signal,
      });
    });
  };

  const totalSheeted = items.reduce((s, it) => s + getStationCount(it, "dough_sheeting"), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallProgress = totalTarget > 0 ? Math.round((totalSheeted / totalTarget) * 100) : 0;
  const allDone = totalTarget > 0 && totalSheeted >= totalTarget;

  const nextBallWeight = nextItem
    ? doughData?.recipes.find(r => r.recipeId === nextItem.recipeId)?.ballWeightG
    : null;

  return (
    <div className="space-y-4">
      {allDone ? (
        <div className="bg-card border-2 border-emerald-400 dark:border-emerald-600 rounded-xl p-6">
          <div className="text-center mb-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="font-semibold text-xl mb-1">All sheeting complete!</h2>
            <p className="text-muted-foreground text-base">{totalSheeted} batches sheeted and passed to builders.</p>
          </div>
          <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden mb-4">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: "100%" }} />
          </div>
          <div className="pt-3 border-t border-border/50">
            <BreakTracker planId={plan.id} stationType="dough_sheeting" onBreakActiveChange={setIsOnBreak} />
          </div>
        </div>
      ) : (
        <div className="bg-card border-2 border-amber-400 dark:border-amber-600 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-0.5">
                Now Sheeting
              </p>
              <h2 className="font-display text-2xl font-bold">
                {nextItem?.recipeName ?? "—"}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold font-display tabular-nums">{totalSheeted} <span className="text-lg text-muted-foreground font-normal">/ {totalTarget}</span></p>
              <p className="text-sm text-muted-foreground">batches sheeted</p>
            </div>
          </div>

          <div className="w-full bg-secondary rounded-full h-3 mb-3">
            <div
              className="bg-amber-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>

          <div className="mb-3 pb-3 border-b border-border/50">
            <BreakTracker planId={plan.id} stationType="dough_sheeting" onBreakActiveChange={setIsOnBreak} />
          </div>

          {nextBallWeight && (
            <p className="text-base text-muted-foreground mb-3">
              Ball weight: <span className="font-semibold text-amber-600 dark:text-amber-400">{nextBallWeight}g</span>
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={undoLast}
              disabled={isOnBreak || totalSheeted === 0 || createBatch.isPending || undoBusy}
              className="flex items-center gap-1.5 px-4 py-3 text-base rounded-xl border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-4 h-4" />
              {undoBusy ? "Undoing\u2026" : "Undo"}
            </button>
            <button
              onClick={sheetNext}
              disabled={isOnBreak || !nextItem || createBatch.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 text-base rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-5 h-5" />
              Sheet Batch
            </button>
          </div>
        </div>
      )}

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

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-base">Recipe Breakdown</h3>
        </div>
        <div className="divide-y divide-border/50">
          {items.map(item => {
            const target = item.batchesTarget ?? 0;
            const sheeted = getStationCount(item, "dough_sheeting");
            const isDone = sheeted >= target && target > 0;
            const isActive = item.id === nextItem?.id;
            const ballWeight = doughData?.recipes.find(r => r.recipeId === item.recipeId)?.ballWeightG;
            const progress = target > 0 ? Math.round((sheeted / target) * 100) : 0;

            return (
              <div
                key={item.id}
                className={cn(
                  "px-4 py-3 transition-colors",
                  isDone ? "bg-emerald-50/30 dark:bg-emerald-900/10" :
                  isActive ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    ) : isActive ? (
                      <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                    ) : null}
                    <span className={cn("text-base font-medium truncate", isDone && "text-muted-foreground line-through")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    {ballWeight && (
                      <span className="text-sm text-muted-foreground">{ballWeight}g</span>
                    )}
                    <span className={cn("text-base font-bold tabular-nums", isDone ? "text-emerald-600 dark:text-emerald-400" : "")}>
                      {sheeted}/{target}
                    </span>
                  </div>
                </div>
                <div className="w-full bg-secondary rounded-full h-1.5">
                  <div
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      isDone ? "bg-emerald-500" : "bg-amber-500"
                    )}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
  const RACK0_REGULAR = hasWonky ? TRAYS_PER_RACK - 1 : TRAYS_PER_RACK;

  // Build wonky gradient background
  const wonkyBackground =
    wonkyItems.length === 1
      ? wonkyItems[0].colour
      : `linear-gradient(90deg, ${wonkyItems
          .map((w, i, arr) => {
            const step = 100 / arr.length;
            return `${w.colour} ${i * step}%, ${w.colour} ${(i + 1) * step}%`;
          })
          .join(", ")})`;

  type Slot = { colour: string; recipeName: string; isWonky?: boolean } | null;

  // Rack 0: regular trays fill slots 0..(RACK0_REGULAR-1), wonky tray at slot 27
  const rack0Regular = allRegularTrays.slice(0, RACK0_REGULAR);
  const restRegular = allRegularTrays.slice(RACK0_REGULAR);

  const racks: Slot[][] = [];
  const rack0: Slot[] = [...rack0Regular];
  while (rack0.length < RACK0_REGULAR) rack0.push(null);
  if (hasWonky) rack0.push({ colour: "wonky", recipeName: "Wonky", isWonky: true });
  racks.push(rack0);

  for (let i = 0; i < restRegular.length; i += TRAYS_PER_RACK) {
    racks.push(restRegular.slice(i, i + TRAYS_PER_RACK));
  }

  const totalTrays = allRegularTrays.length + (hasWonky ? 1 : 0);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      {/* Header + legend */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h3 className="font-semibold text-base">Chiller Rack</h3>
            <p className="text-sm text-muted-foreground">
              {totalTrays} tray{totalTrays !== 1 ? "s" : ""} · {racks.length} rack{racks.length !== 1 ? "s" : ""} · fills top to bottom
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {rackItems.map(r => (
            <div key={r.recipeId} className="flex items-center gap-1.5">
              <div
                className="w-3.5 h-3.5 rounded-[3px] flex-shrink-0 border border-black/10"
                style={{ backgroundColor: r.colour }}
              />
              <span className="text-sm text-muted-foreground">
                {r.recipeName.length > 18 ? r.recipeName.slice(0, 18) + "…" : r.recipeName}
                <span className="font-semibold text-foreground ml-1">×{r.trayCount}</span>
              </span>
            </div>
          ))}
          {hasWonky && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-3.5 h-3.5 rounded-[3px] flex-shrink-0 border border-black/10"
                style={{ background: wonkyBackground }}
              />
              <span className="text-sm text-muted-foreground">
                Wonky
                <span className="font-semibold text-foreground ml-1">×1 tray</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Racks — scrollable row */}
      <div className="flex gap-6 overflow-x-auto pb-1">
        {racks.map((rackSlots, rackIdx) => {
          // Pad to full 28 slots so the rack body always has a fixed height
          const slots: Slot[] = [...rackSlots];
          while (slots.length < TRAYS_PER_RACK) slots.push(null);

          return (
            <div key={rackIdx} className="flex-shrink-0">
              {racks.length > 1 && (
                <p className="text-sm text-center text-muted-foreground mb-2 font-medium">
                  Rack {rackIdx + 1}
                </p>
              )}
              <div className="flex items-stretch gap-2">
                {/* Left: top/bottom labels */}
                <div className="flex flex-col justify-between py-[6px]" style={{ height: 28 * 15 + 27 * 2 + 12 }}>
                  <span className="text-[9px] text-muted-foreground leading-none">1</span>
                  <span className="text-[9px] text-muted-foreground leading-none">28</span>
                </div>

                {/* Rack body */}
                <div
                  className="relative border-[3px] border-border rounded-md bg-secondary/10 px-1.5 py-[6px]"
                  style={{ minWidth: 140 }}
                >
                  {/* Rack rails */}
                  <div className="absolute inset-y-2 left-[7px] w-[2px] bg-border/40 rounded-full pointer-events-none" />
                  <div className="absolute inset-y-2 right-[7px] w-[2px] bg-border/40 rounded-full pointer-events-none" />

                  {/* Trays — slot 0 at top (position 1), slot 27 at bottom (position 28) */}
                  <div className="flex flex-col gap-[2px] relative z-10">
                    {slots.map((slot, i) => {
                      if (slot?.isWonky) {
                        return (
                          <div
                            key={i}
                            className="h-[15px] rounded-[2px] flex items-center px-1.5 overflow-hidden shadow-sm"
                            style={{ background: wonkyBackground }}
                            title={`Wonky packs — ${wonkyItems.map(w => w.recipeName).join(", ")}`}
                          >
                            <span
                              className="text-white text-[8px] font-semibold leading-none truncate"
                              style={{ textShadow: "0 0 4px rgba(0,0,0,0.8)" }}
                            >
                              Wonky
                            </span>
                          </div>
                        );
                      }
                      if (slot) {
                        return (
                          <div
                            key={i}
                            className="h-[15px] rounded-[2px] flex items-center px-1.5 overflow-hidden shadow-sm"
                            style={{ backgroundColor: slot.colour }}
                            title={`${slot.recipeName} — position ${i + 1}`}
                          >
                            <span
                              className="text-white text-[8px] font-semibold leading-none truncate"
                              style={{ textShadow: "0 0 4px rgba(0,0,0,0.7)" }}
                            >
                              {slot.recipeName}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          className="h-[15px] rounded-[2px] border border-dashed border-border/30"
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Right: recipe stacked bar — sub-count per recipe, total shown if split across racks */}
                {(() => {
                  // Group consecutive filled slots into recipe segments
                  const segs: Array<{ colour: string; recipeName: string; count: number; isWonky: boolean }> = [];
                  for (const slot of slots) {
                    if (!slot) continue;
                    const last = segs[segs.length - 1];
                    if (slot.isWonky) {
                      if (last?.isWonky) last.count++;
                      else segs.push({ colour: wonkyBackground, recipeName: "Wonky", count: 1, isWonky: true });
                    } else if (last && last.recipeName === slot.recipeName && !last.isWonky) {
                      last.count++;
                    } else {
                      segs.push({ colour: slot.colour, recipeName: slot.recipeName, count: 1, isWonky: false });
                    }
                  }

                  // Total trays per recipe across ALL racks
                  const totalByName = new Map<string, number>(rackItems.map(r => [r.recipeName, r.trayCount]));
                  if (hasWonky) totalByName.set("Wonky", 1);

                  // Recipes whose trays are split across multiple racks
                  const splitSegs = segs.filter(s => (totalByName.get(s.recipeName) ?? s.count) > s.count);

                  return (
                    <div className="flex flex-col" style={{ minWidth: 34 }}>
                      {/* Stacked bar — heights match tray slot heights exactly */}
                      <div className="flex flex-col gap-[2px] py-[6px]">
                        {segs.map((seg, si) => {
                          const h = seg.count * 15 + Math.max(0, seg.count - 1) * 2;
                          const total = totalByName.get(seg.recipeName) ?? seg.count;
                          const isPartial = total > seg.count;
                          return (
                            <div
                              key={si}
                              style={{ height: h, background: seg.colour }}
                              className="rounded-[2px] flex flex-col items-center justify-center overflow-hidden"
                            >
                              <span
                                className="text-white font-extrabold text-[11px] leading-none"
                                style={{ textShadow: "0 0 4px rgba(0,0,0,0.9)" }}
                              >
                                {seg.count}
                              </span>
                              {isPartial && (
                                <span
                                  className="text-white/80 text-[8px] leading-none mt-0.5"
                                  style={{ textShadow: "0 0 3px rgba(0,0,0,0.8)" }}
                                >
                                  /{total}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {/* Below bar: grand total for recipes that span multiple racks */}
                      {splitSegs.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                          {splitSegs.map((seg, si) => (
                            <div key={si} className="flex items-center gap-1 justify-center">
                              <div
                                className="w-2 h-2 rounded-[1px] flex-shrink-0 border border-black/10"
                                style={{ background: seg.colour }}
                              />
                              <span className="text-[9px] font-bold tabular-nums text-foreground">
                                {totalByName.get(seg.recipeName)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}