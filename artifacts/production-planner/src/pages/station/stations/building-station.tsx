import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  useCreateBatchCompletion,
  useUpdateProductionPlanItem,
  useListTimingStandards,
  useGetStationKpi,
  getGetProductionPlanQueryKey,
  getGetStationKpiQueryKey,
  getGetStationActivityQueryKey,
  useGetStationActivity,
  useListBatchCompletions,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import {
  Plus, Minus, CheckCircle2, Loader2, Package, ChevronRight, RotateCcw,
  BarChart2, BookOpen, Target, Scale, GripVertical, Check, ExternalLink,
  ClipboardList, CheckSquare, Square, AlertCircle, Trophy, Eye, X, AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ShopifyConfirmDialog } from "@/components/shopify-confirm-dialog";
import { ExtraPackControl } from "./mixing-station";
import { BreakTracker } from "../shared/break-tracker";
import { KpiBar } from "../shared/kpi-bar";
import { EodSummary } from "../shared/eod-summary";
import { getStationCount, getAvailableFromPrev } from "../shared/constants";
import { fmtQty } from "../shared/prep-helpers";

// ──────────────────────────────────────────────────────────────────────────────
// Building Station (shared for building_1 and building_2)
// Full-screen recipe display, large BATCH COMPLETE button, KPI bar, auto-advance
// ──────────────────────────────────────────────────────────────────────────────
interface BuildingStationProps {
  plan: ProductionPlanDetail;
  lineNumber: 1 | 2;
}

export function BuildingStation({ plan, lineNumber }: BuildingStationProps) {
  const stationType = lineNumber === 1 ? "building_1" : "building_2";
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  // Session tracking
  const [sessionStartedAt] = useState<Date>(() => new Date());
  const [sessionBatches, setSessionBatches] = useState(0);
  const [totalBreakMinutes, setTotalBreakMinutes] = useState(0);
  const [activeBreakMinutes, setActiveBreakMinutes] = useState(0);
  const [showEod, setShowEod] = useState(false);
  const [pendingTap, setPendingTap] = useState(false);
  const [isOnBreak, setIsOnBreak] = useState(false);

  // Load timing standards for KPI color coding
  const { data: timingStandards } = useListTimingStandards();
  const standard = (timingStandards ?? []).find((s: { stationType?: string }) => s.stationType === stationType);
  const targetBph = standard?.targetBatchesPerHour != null ? Number(standard.targetBatchesPerHour) : null;
  const minBph = standard?.minBatchesPerHour != null ? Number(standard.minBatchesPerHour) : null;

  // Server-side KPI (polled every 5s — refreshes from DB-persisted completions and breaks)
  const { data: serverKpi } = useGetStationKpi(plan.id, { stationType }, {
    query: { queryKey: getGetStationKpiQueryKey(plan.id, { stationType }), refetchInterval: 5000 },
  });

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
        setSessionBatches(prev => prev + 1);
        setPendingTap(false);
      },
      onError: () => setPendingTap(false),
    },
  });

  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const [paceData, setPaceData] = useState<Record<number, number>>({});
  useEffect(() => {
    const fetchPace = async () => {
      try {
        const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/pace?stationType=${stationType}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setPaceData(data.pace ?? {});
        }
      } catch {}
    };
    fetchPace();
    const interval = setInterval(fetchPace, 5000);
    return () => clearInterval(interval);
  }, [plan.id, stationType, sessionBatches]);

  type AssemblyItemData = { name: string; unit: string; weightPerBatch: number; weightHalfBatch: number };
  type AssemblyData = { itemId: number; fillingWeightPerBatch: number; fillingWeightHalfBatch: number; assemblyItems: AssemblyItemData[]; postOvenItems?: AssemblyItemData[] };
  const [assemblyMap, setAssemblyMap] = useState<Record<number, AssemblyData>>({});
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/assembly-items`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.items) {
          const map: Record<number, AssemblyData> = {};
          for (const it of d.items) map[it.itemId] = it;
          setAssemblyMap(map);
        }
      })
      .catch(() => {});
  }, [plan.id]);

  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [checklistLockedForItem, setChecklistLockedForItem] = useState<number | null>(null);
  const [checklistLoadedForItem, setChecklistLoadedForItem] = useState<number | null>(null);
  const prevRecipeIdRef = useRef<number | null>(null);
  const [viewingItemId, setViewingItemId] = useState<number | null>(null);

  const checklistKey = (itemId: number) => `checklist_done_${plan.id}_${stationType}_${itemId}`;

  // Mozzarella closing check — total to load to building fridges (in 2kg bags)
  type MozzarellaLoad = { name: string; unit: string; totalQty: number; bagWeight: number; bags: number };
  const [mozzLoad, setMozzLoad] = useState<MozzarellaLoad | null>(null);
  const [mozzConfirmed, setMozzConfirmed] = useState(false);
  const [showMozzPopup, setShowMozzPopup] = useState(false);
  const mozzPopupShownRef = useRef(false);
  const MOZZ_KEY = `mozz_load_confirmed_${plan.id}`;
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/mozzarella-load`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMozzLoad(d); })
      .catch(() => {});
    fetch(`/api/app-settings/${MOZZ_KEY}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.value === "true") setMozzConfirmed(true); })
      .catch(() => {});
  }, [plan.id]);
  const confirmMozz = async () => {
    setMozzConfirmed(true);
    await fetch(`/api/app-settings/${MOZZ_KEY}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "true" }),
    }).catch(() => {});
  };
  const unconfirmMozz = async () => {
    setMozzConfirmed(false);
    await fetch(`/api/app-settings/${MOZZ_KEY}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "false" }),
    }).catch(() => {});
  };

  function getCombinedBuildCount(it: ProductionPlanItem) {
    return getStationCount(it, "building_1") + getStationCount(it, "building_2");
  }

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const otherStation = stationType === "building_1" ? "building_2" : "building_1";
  const currentItem = items.find(it => {
    const combined = getCombinedBuildCount(it);
    const target = it.batchesTarget ?? 0;
    if (combined >= target) return false;
    const myBatches = getStationCount(it, stationType);
    const otherBatches = getStationCount(it, otherStation);
    const mixDone = getStationCount(it, "mixing");
    const remaining = target - combined;
    if (mixDone >= target && remaining > 0 && myBatches > otherBatches) return false;
    return true;
  });

  // Combined count from both lines — used for display and progress
  const buildingCount = currentItem ? getCombinedBuildCount(currentItem) : 0;
  // This builder's own contribution — used for undo guard and KPI
  const myCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  // Available = how many more batches can be built before outpacing mixing
  const mixingCount = currentItem ? getStationCount(currentItem, "mixing") : 0;
  const available = currentItem ? Math.max(0, mixingCount - buildingCount) : 0;
  const remaining = currentItem ? Math.max(0, (currentItem.batchesTarget ?? 0) - buildingCount) : 0;
  const allDone = items.length > 0 && !currentItem;

  useEffect(() => {
    if (!currentItem) return;
    if (checklistLoadedForItem === currentItem.id) return;
    fetch(`/api/app-settings/${checklistKey(currentItem.id)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value === "true") {
          setChecklistLockedForItem(currentItem.id);
        }
        setChecklistLoadedForItem(currentItem.id);
      })
      .catch(() => setChecklistLoadedForItem(currentItem.id));
  }, [currentItem?.id, stationType]);

  useEffect(() => {
    const curId = currentItem?.id ?? null;
    if (curId === null) return;
    if (curId !== prevRecipeIdRef.current) {
      prevRecipeIdRef.current = curId;
      setCheckedItems({});
      setChecklistLockedForItem(null);
      setChecklistLoadedForItem(null);
    }
  }, [currentItem?.id]);

  useEffect(() => {
    if (!currentItem || checklistLockedForItem === currentItem.id) return;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return;
    const allKeys: string[] = [];
    if (asm.fillingWeightPerBatch > 0) allKeys.push("filling");
    asm.assemblyItems.forEach((_, i) => allKeys.push(`item-${i}`));
    if (allKeys.length > 0 && allKeys.every(k => checkedItems[k])) {
      setChecklistLockedForItem(currentItem.id);
      fetch(`/api/app-settings/${checklistKey(currentItem.id)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "true" }),
      }).catch(() => {});
    }
  }, [checkedItems, currentItem?.id, assemblyMap, checklistLockedForItem]);

  // Auto-show mozzarella popup once when production completes
  useEffect(() => {
    if (allDone && mozzLoad && !mozzPopupShownRef.current) {
      mozzPopupShownRef.current = true;
      setShowMozzPopup(true);
    }
  }, [allDone, mozzLoad]);

  const checklistPending = (() => {
    if (!currentItem) return false;
    const asm = assemblyMap[currentItem.id];
    if (!asm) return false;
    if (asm.fillingWeightPerBatch === 0 && asm.assemblyItems.length === 0) return false;
    return checklistLockedForItem !== currentItem.id;
  })();

  // Large "BATCH COMPLETE" tap — single write via createBatchCompletion only
  const handleBatchComplete = () => {
    if (!currentItem || pendingTap || available <= 0 || isOnBreak || checklistPending) return;
    setPendingTap(true);
    createBatch.mutate({
      id: plan.id,
      data: {
        planItemId: currentItem.id,
        stationType,
        completedAt: new Date().toISOString(),
      },
    });
  };

  // Undo last batch — deletes the most recent batch_completion row for this user/station
  // and decrements batches_complete atomically, keeping KPI metrics consistent.
  const handleUndo = async () => {
    if (!currentItem || myCount === 0 || isOnBreak) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: currentItem.id, stationType }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setSessionBatches(prev => Math.max(0, prev - 1));
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo batch. Please try again.", variant: "destructive" });
    }
  };

  const handleBreakChange = useCallback((breakMins: number | null) => {
    if (breakMins === null) {
      setTotalBreakMinutes(prev => prev + activeBreakMinutes);
      setActiveBreakMinutes(0);
    } else {
      setActiveBreakMinutes(breakMins);
    }
  }, [activeBreakMinutes]);

  const pct = currentItem && (currentItem.batchesTarget ?? 0) > 0
    ? Math.round((buildingCount / (currentItem.batchesTarget ?? 0)) * 100)
    : 0;

  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesDone = items.reduce((s, it) => s + getCombinedBuildCount(it), 0);
  const overallProgress = totalBatchesTarget > 0 ? Math.round((totalBatchesDone / totalBatchesTarget) * 100) : 0;

  return (
    <div className="space-y-4">
      {showEod && (
        <EodSummary
          planId={plan.id}
          items={items}
          stationType={stationType}
          sessionBatches={sessionBatches}
          totalBreakMinutes={totalBreakMinutes + activeBreakMinutes}
          sessionStartedAt={sessionStartedAt}
          onClose={() => setShowEod(false)}
        />
      )}

      {/* Mozzarella load popup — fires once when all production is complete */}
      {showMozzPopup && mozzLoad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border-2 border-amber-400 dark:border-amber-600 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="font-bold text-lg leading-tight">Closing Check</h2>
                <p className="text-xs text-muted-foreground">Production complete — load mozzarella to fridges</p>
              </div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4 text-center">
              <p className="text-4xl font-display font-bold text-amber-700 dark:text-amber-300">{mozzLoad.bags}</p>
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">× 2kg bags</p>
              <p className="text-xs text-muted-foreground mt-1">{fmtQty(mozzLoad.totalQty, mozzLoad.unit)} {mozzLoad.name} total</p>
            </div>
            <p className="text-sm text-center text-muted-foreground">Load these to the building fridges before closing</p>
            <div className="flex gap-3">
              <button
                onClick={() => { confirmMozz(); setShowMozzPopup(false); }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-semibold transition-colors"
              >
                <Check className="w-4 h-4" />
                Confirmed — loaded
              </button>
              <button
                onClick={() => setShowMozzPopup(false)}
                className="px-4 py-3 rounded-xl border border-border hover:bg-secondary/60 text-sm font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily progress + break buttons */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold text-lg">Today's Production</h2>
            <p className="text-base text-muted-foreground">
              {totalBatchesDone} / {totalBatchesTarget} batches complete · Line {lineNumber}
            </p>
          </div>
          <span className="text-3xl font-bold font-display">{overallProgress}%</span>
        </div>
        <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              overallProgress >= 100 ? "bg-emerald-500" : "bg-primary"
            )}
            style={{ width: `${Math.min(overallProgress, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType={stationType} onBreakChange={handleBreakChange} onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {/* Current recipe — driving-view focus card */}
      {currentItem ? (
        <div className="bg-card border-2 border-primary rounded-2xl p-4 sm:p-5">
          {/* Header: recipe name + SOP */}
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight flex-1 truncate">
              {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
            </h2>
            {currentItem.sopUrl && (
              <a
                href={currentItem.sopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-blue-700 dark:text-blue-300 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap"
              >
                SOP <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Two-column driving layout */}
          <div className="flex gap-3">
            {/* LEFT — Assembly items checklist */}
            <div className="w-1/2 min-w-0">
              {(() => {
                const asm = currentItem ? assemblyMap[currentItem.id] : null;
                if (!asm) return null;
                const hasFilling = asm.fillingWeightPerBatch > 0;
                const hasItems = asm.assemblyItems.length > 0;
                if (!hasFilling && !hasItems) return null;

                const isLocked = checklistLockedForItem === currentItem.id;

                const toggleCheck = (key: string) => {
                  if (isLocked) return;
                  setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
                };

                return (
                  <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        {isLocked ? "Ready" : "Items needed"}
                      </span>
                      {isLocked && <Check className="w-4 h-4 text-emerald-500 ml-auto" />}
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {hasFilling && (
                        <button
                          type="button"
                          onClick={() => toggleCheck("filling")}
                          disabled={isLocked}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors",
                            !isLocked && "active:bg-slate-200 dark:active:bg-slate-700"
                          )}
                        >
                          {isLocked || checkedItems["filling"]
                            ? <CheckSquare className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                            : <Square className="w-6 h-6 text-slate-400 flex-shrink-0" />}
                          <span className="text-lg font-semibold text-blue-700 dark:text-blue-400 flex-1">Filling</span>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xl font-bold font-mono tabular-nums">{Math.round(asm.fillingWeightPerBatch)}g</span>
                            <span className="block text-sm text-muted-foreground font-mono tabular-nums">{Math.round(asm.fillingWeightHalfBatch)}g half</span>
                          </div>
                        </button>
                      )}
                      {asm.assemblyItems.map((ai, i) => {
                        const key = `item-${i}`;
                        return (
                          <button
                            type="button"
                            key={key}
                            onClick={() => toggleCheck(key)}
                            disabled={isLocked}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-3 text-left transition-colors",
                              !isLocked && "active:bg-slate-200 dark:active:bg-slate-700"
                            )}
                          >
                            {isLocked || checkedItems[key]
                              ? <CheckSquare className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                              : <Square className="w-6 h-6 text-slate-400 flex-shrink-0" />}
                            <span className="text-lg font-semibold flex-1">{ai.name}</span>
                            <div className="text-right flex-shrink-0">
                              <span className="text-xl font-bold font-mono tabular-nums">{Math.round(ai.weightPerBatch)}g</span>
                              <span className="block text-sm text-muted-foreground font-mono tabular-nums">{Math.round(ai.weightHalfBatch)}g half</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Compact meta row */}
              <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-muted-foreground">
                {currentItem.tinSize && (
                  <span className="bg-secondary/50 rounded px-1.5 py-0.5">{currentItem.tinSize} tin</span>
                )}
                {currentItem.portionsPerBatch > 0 && (
                  <span className="bg-secondary/50 rounded px-1.5 py-0.5">{currentItem.portionsPerBatch}/batch</span>
                )}
                {paceData[currentItem.id] != null && (
                  <span className="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded px-1.5 py-0.5 font-medium">
                    {paceData[currentItem.id]} min/batch
                  </span>
                )}
                {currentItem.notes && (
                  <span className="italic">{currentItem.notes}</span>
                )}
              </div>
            </div>

            {/* RIGHT — Batch counter + action column */}
            <div className="flex flex-col items-center justify-between w-1/2">
              {/* Batch counter */}
              <div className="text-center mb-3">
                <p className="text-5xl sm:text-6xl font-bold font-display tabular-nums text-primary leading-none">
                  {buildingCount}
                </p>
                <p className="text-lg font-light text-muted-foreground">/ {currentItem.batchesTarget ?? 0}</p>
                {currentItem.maxBatchesPerTin && (currentItem.batchesTarget ?? 0) > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                    {Math.ceil((currentItem.batchesTarget ?? 0) / currentItem.maxBatchesPerTin)} tins
                  </p>
                )}
                {myCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">Mine: {myCount}</p>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full mb-3">
                <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct >= 100 ? "bg-emerald-500" : "bg-primary"
                    )}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-0.5">{remaining} left</p>
              </div>

              {/* Waiting badge */}
              {available <= 0 && (
                <div className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 leading-tight">Waiting for Mixing</p>
                </div>
              )}

              {/* BATCH COMPLETE button — large, easy to tap */}
              <button
                onClick={handleBatchComplete}
                disabled={pendingTap || isOnBreak || available <= 0 || checklistPending}
                className={cn(
                  "w-full flex-1 min-h-[100px] rounded-2xl text-xl sm:text-2xl font-bold transition-all select-none active:scale-95 flex items-center justify-center",
                  remaining === 0
                    ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-2 border-emerald-400 opacity-60 cursor-not-allowed"
                    : isOnBreak
                      ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                      : checklistPending
                        ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500 border-2 border-slate-300 dark:border-slate-600 cursor-not-allowed opacity-70"
                        : available <= 0
                          ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                          : pendingTap
                            ? "bg-primary/60 text-primary-foreground cursor-wait"
                            : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl"
                )}
              >
                {isOnBreak
                  ? "On Break"
                  : remaining === 0
                    ? "All Done ✓"
                    : checklistPending
                      ? "Tick items ←"
                      : available <= 0
                        ? "Waiting…"
                        : pendingTap
                          ? "Recording..."
                          : "BATCH DONE ✓"}
              </button>

              {/* Undo */}
              {buildingCount > 0 && !isOnBreak && (
                <button
                  onClick={handleUndo}
                  className="mt-1.5 w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
                >
                  Undo
                </button>
              )}
            </div>
          </div>

          {/* Extra Pack secondary control */}
          {currentItem && (
            <ExtraPackControl
              planId={plan.id}
              item={currentItem}
              isOnBreak={isOnBreak}
            />
          )}

          {/* Shortfall recording */}
          {currentItem && (
            <ShortfallControl
              planId={plan.id}
              item={currentItem}
              isOnBreak={isOnBreak}
            />
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-10 text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">All Done! 🎉</h2>
          <p className="text-muted-foreground">Building Table {lineNumber} — all recipes complete for today.</p>
          <button
            onClick={() => setShowEod(true)}
            className="mt-4 px-5 py-2.5 bg-secondary text-foreground rounded-xl hover:bg-secondary/80 transition-colors font-medium"
          >
            <Trophy className="w-4 h-4 inline mr-2" />
            View Summary
          </button>
        </div>
      )}

      {/* KPI bar — uses server-side KPI from DB when available, falls back to local session state */}
      <KpiBar
        sessionBatches={sessionBatches}
        sessionStartedAt={sessionStartedAt}
        activeBreakMinutes={activeBreakMinutes}
        totalBreakMinutes={totalBreakMinutes}
        targetBph={targetBph}
        minBph={minBph}
        serverKpi={serverKpi}
      />

      {/* End of day button + queue */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowEod(true)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
        >
          <Trophy className="w-4 h-4" />
          End of Day Summary
        </button>
      </div>

      {/* Viewing panel — read-only assembly/filling info for any selected recipe */}
      {(() => {
        const viewItem = viewingItemId != null ? items.find(it => it.id === viewingItemId) : null;
        if (!viewItem) return null;
        const asm = assemblyMap[viewItem.id];
        const hasFilling = asm && asm.fillingWeightPerBatch > 0;
        const hasItems = asm && asm.assemblyItems.length > 0;
        const viewBuildCount = getCombinedBuildCount(viewItem);
        const viewIsDone = viewBuildCount >= (viewItem.batchesTarget ?? 0);
        const viewMixing = getStationCount(viewItem, "mixing");

        return (
          <div className="bg-card border-2 border-blue-300 dark:border-blue-700 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-700">
              <Eye className="w-5 h-5 text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg leading-tight truncate">
                  {viewItem.recipeName ?? `Recipe #${viewItem.recipeId}`}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {viewBuildCount} / {viewItem.batchesTarget ?? 0} built · {viewMixing} mixed
                  {viewIsDone ? " · Complete" : ""}
                </p>
              </div>
              <button
                onClick={() => setViewingItemId(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-500 transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4">
              {!asm || (!hasFilling && !hasItems) ? (
                <p className="text-sm text-muted-foreground text-center py-4">No assembly items for this recipe.</p>
              ) : (
                <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                      Assembly Items
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {hasFilling && (
                      <div className="flex items-center gap-3 px-3 py-3">
                        <span className="text-base font-semibold text-blue-700 dark:text-blue-400 flex-1">Filling</span>
                        <div className="text-right flex-shrink-0">
                          <span className="text-lg font-bold font-mono tabular-nums">{Math.round(asm.fillingWeightPerBatch)}g</span>
                          <span className="block text-xs text-muted-foreground font-mono tabular-nums">{Math.round(asm.fillingWeightHalfBatch)}g half</span>
                        </div>
                      </div>
                    )}
                    {hasItems && asm.assemblyItems.map((ai, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-3">
                        <span className="text-base font-semibold flex-1">{ai.name}</span>
                        <div className="text-right flex-shrink-0">
                          <span className="text-lg font-bold font-mono tabular-nums">{Math.round(ai.weightPerBatch)}g</span>
                          <span className="block text-xs text-muted-foreground font-mono tabular-nums">{Math.round(ai.weightHalfBatch)}g half</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-foreground">
                {viewItem.tinSize && (
                  <span className="bg-secondary/50 rounded px-1.5 py-0.5">{viewItem.tinSize} tin</span>
                )}
                {viewItem.portionsPerBatch > 0 && (
                  <span className="bg-secondary/50 rounded px-1.5 py-0.5">{viewItem.portionsPerBatch}/batch</span>
                )}
                {viewItem.sopUrl && (
                  <a
                    href={viewItem.sopUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  >
                    SOP <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {viewItem.notes && (
                  <span className="italic">{viewItem.notes}</span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Production Queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-base">Production Queue — Line {lineNumber}</h3>
          <p className="text-sm text-muted-foreground">Tap a recipe to view its filling mix</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border">
              <th className="py-2 px-4 text-left font-medium text-muted-foreground">#</th>
              <th className="py-2 px-4 text-left font-medium text-muted-foreground">Recipe</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Target</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Done</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Mins/Batch</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const stCount = getCombinedBuildCount(item);
              const rem = Math.max(0, (item.batchesTarget ?? 0) - stCount);
              const isCurrent = item.id === currentItem?.id;
              const isDone = stCount >= (item.batchesTarget ?? 0);
              const isViewing = viewingItemId === item.id;
              return (
                <tr
                  key={item.id}
                  onClick={() => setViewingItemId(isViewing ? null : item.id)}
                  className={cn(
                    "border-b border-border/50 last:border-0 cursor-pointer transition-colors",
                    isViewing
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : isCurrent
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-secondary/30"
                  )}
                >
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", isDone ? "line-through text-muted-foreground" : "")}>
                    <div className="flex items-center gap-1.5">
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                      {isCurrent && <span className="text-xs text-primary font-normal">← now</span>}
                      {isViewing && <Eye className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center font-medium">{stCount}</td>
                  <td className="py-2.5 px-4 text-center">
                    {paceData[item.id] != null
                      ? <span className="text-violet-600 dark:text-violet-400 font-medium">{paceData[item.id]}</span>
                      : <span className="text-muted-foreground">—</span>
                    }
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {isDone
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      : stCount > 0
                        ? <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">In Progress</span>
                        : <span className="text-xs text-muted-foreground">Pending</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mozzarella closing check — permanent card at bottom of page */}
      {mozzLoad && (
        <div className={cn(
          "border-2 rounded-2xl p-4 flex items-center gap-4 transition-all",
          mozzConfirmed
            ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20"
            : "border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20"
        )}>
          <button
            onClick={mozzConfirmed ? unconfirmMozz : confirmMozz}
            className={cn(
              "flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all",
              mozzConfirmed
                ? "bg-emerald-500 border-emerald-500 text-white"
                : "border-amber-400 bg-background hover:border-amber-500"
            )}
          >
            {mozzConfirmed && <Check className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={cn(
              "font-bold text-base",
              mozzConfirmed && "line-through text-muted-foreground"
            )}>
              Load {mozzLoad.bags} × 2kg bags {mozzLoad.name} to the building fridges
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Closing check · {fmtQty(mozzLoad.totalQty, mozzLoad.unit)} needed · 2kg per bag
            </p>
          </div>
          {mozzConfirmed && (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
          )}
          {!mozzConfirmed && (
            <button
              onClick={() => setShowMozzPopup(true)}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-500 transition-colors"
              title="View details"
            >
              <Package className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShortfallControl({ planId, item, isOnBreak }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const shortCount = item.shortCount ?? 0;

  const addShort = async () => {
    if (isOnBreak || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/items/${item.id}/short`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
      toast({ title: "Shortfall recorded", description: `${item.recipeName ?? "Recipe"}: ${shortCount + 1} pack${shortCount + 1 !== 1 ? "s" : ""} short` });
    } catch (err: unknown) {
      toast({ title: "Error recording shortfall", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const removeShort = async () => {
    if (loading || shortCount <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/items/${item.id}/short`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
    } catch (err: unknown) {
      toast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-red-50/50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">Pack Shortfall</p>
          <p className="text-xs text-muted-foreground">Record packs lost during building</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={removeShort}
            disabled={loading || shortCount <= 0}
            className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-40 transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className={cn(
            "text-lg font-bold tabular-nums min-w-[2ch] text-center",
            shortCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
          )}>
            {shortCount}
          </span>
          <button
            onClick={addShort}
            disabled={loading || isOnBreak}
            className="w-8 h-8 rounded-full border border-red-300 dark:border-red-700 flex items-center justify-center text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}