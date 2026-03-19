import { useParams, useLocation } from "wouter";
import {
  useGetProductionPlan,
  useUpdateProductionPlanItem,
  useUpdateProductionPlanOrder,
  useCreateBatchCompletion,
  useCreateStationBreak,
  useEndStationBreak,
  useGetPrepRequirements,
  useListTimingStandards,
  useGetStationKpi,
  useGetStationActivity,
  getGetProductionPlanQueryKey,
  getGetStationKpiQueryKey,
  getGetStationActivityQueryKey,
} from "@workspace/api-client-react";
import type { ProductionPlanDetail, ProductionPlanItem, PrepRequirementItem, StationKpi } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, ChevronUp, ChevronDown, Plus, Minus,
  Coffee, Utensils, Clock, CheckCircle2,
  PlayCircle, BarChart2, Loader2,
  Construction, Waves, Flame, Gift, Box, Salad, Layers,
  Beef, TrendingUp, Trophy,
} from "lucide-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────────────────────
// Station metadata
// ──────────────────────────────────────────────────────────────────────────────
const STATIONS = [
  { key: "mixing", label: "Mixing & Cooking", short: "Mixing", icon: Waves, color: "text-blue-500" },
  { key: "building_1", label: "Building Line 1", short: "Build 1", icon: Construction, color: "text-orange-500" },
  { key: "building_2", label: "Building Line 2", short: "Build 2", icon: Construction, color: "text-orange-400" },
  { key: "ovens", label: "Ovens", short: "Ovens", icon: Flame, color: "text-red-500" },
  { key: "wrapping", label: "Wrapping", short: "Wrapping", icon: Gift, color: "text-purple-500" },
  { key: "packing", label: "Packing", short: "Packing", icon: Box, color: "text-indigo-500" },
  { key: "dough_prep", label: "Dough Prep", short: "Dough Prep", icon: Layers, color: "text-amber-600" },
  { key: "dough_sheeting", label: "Dough Sheeting", short: "Sheeting", icon: Layers, color: "text-amber-500" },
  { key: "prep_veg", label: "Veg Prep", short: "Veg", icon: Salad, color: "text-green-500" },
  { key: "prep_bases", label: "Bases & Mozz", short: "Bases", icon: Layers, color: "text-yellow-500" },
  { key: "prep_meat", label: "Raw Meat Prep", short: "Meat", icon: Beef, color: "text-rose-500" },
] as const;

type StationType = typeof STATIONS[number]["key"];

// ──────────────────────────────────────────────────────────────────────────────
// Station Layout (shared header)
// ──────────────────────────────────────────────────────────────────────────────
interface StationLayoutProps {
  planId: number;
  stationType: StationType;
  plan: ProductionPlanDetail | undefined;
  children: React.ReactNode;
}

function StationLayout({ planId, stationType, plan, children }: StationLayoutProps) {
  const [, navigate] = useLocation();
  const station = STATIONS.find(s => s.key === stationType);
  const StationIcon = station?.icon ?? BarChart2;

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal station header */}
      <div className="border-b border-border bg-card sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <StationIcon className={cn("w-5 h-5 flex-shrink-0", station?.color)} />
                <div className="min-w-0">
                  <h1 className="font-semibold truncate">{station?.label}</h1>
                  {plan && (
                    <p className="text-xs text-muted-foreground truncate">
                      Batch #{plan.batchNumber ?? ""} · {format(parseISO(plan.planDate), "EEEE d MMM yyyy")}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Station switcher — compact */}
              <div className="hidden md:flex items-center gap-1 overflow-x-auto">
                {STATIONS.map(s => {
                  const Icon = s.icon;
                  const isActive = s.key === stationType;
                  return (
                    <button
                      key={s.key}
                      onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      )}
                      title={s.label}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {s.short}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => navigate(`/plans`)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3 py-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
                Exit Station
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Break Tracker Widget
// ──────────────────────────────────────────────────────────────────────────────
interface BreakTrackerProps {
  planId: number;
  stationType: StationType;
  /** Called with active break duration in minutes whenever break state changes */
  onBreakChange?: (activeBreakMinutes: number | null) => void;
}

interface ActiveBreak {
  id: number;
  type: "morning" | "lunch";
  startedAt: string;
}

function BreakTracker({ planId, stationType, onBreakChange }: BreakTrackerProps) {
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const createBreak = useCreateStationBreak();
  const endBreak = useEndStationBreak();

  useEffect(() => {
    if (!activeBreak) {
      onBreakChange?.(null);
      return;
    }
    const update = () => {
      const mins = differenceInMinutes(new Date(), parseISO(activeBreak.startedAt));
      setElapsed(mins);
      onBreakChange?.(mins);
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [activeBreak]);

  const startBreak = (type: "morning" | "lunch") => {
    createBreak.mutate(
      {
        id: planId,
        data: { stationType, breakType: type, startedAt: new Date().toISOString() },
      },
      {
        onSuccess: (b: { id: number; startedAt?: string | null }) => {
          setActiveBreak({ id: b.id, type, startedAt: b.startedAt! });
        },
      }
    );
  };

  const stopBreak = () => {
    if (!activeBreak) return;
    endBreak.mutate(
      {
        id: planId,
        breakId: activeBreak.id,
        data: { endedAt: new Date().toISOString() },
      },
      {
        onSuccess: () => { setActiveBreak(null); onBreakChange?.(null); },
      }
    );
  };

  if (activeBreak) {
    return (
      <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-xl px-4 py-3">
        <Clock className="w-5 h-5 text-amber-600 animate-pulse" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {activeBreak.type === "morning" ? "Morning" : "Lunch"} break · {elapsed} min
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Started {format(parseISO(activeBreak.startedAt), "HH:mm")}
          </p>
        </div>
        <button
          onClick={stopBreak}
          className="ml-auto px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 transition-colors font-medium"
        >
          End Break
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Breaks:</span>
      <button
        onClick={() => startBreak("morning")}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary/60 transition-colors"
      >
        <Coffee className="w-3.5 h-3.5" />
        Morning
      </button>
      <button
        onClick={() => startBreak("lunch")}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary/60 transition-colors"
      >
        <Utensils className="w-3.5 h-3.5" />
        Lunch
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// KPI Bar — computes batches/hour from completions, excludes break time
// ──────────────────────────────────────────────────────────────────────────────
interface KpiBarProps {
  /** Local session fallback (used before server data loads) */
  sessionBatches: number;
  sessionStartedAt: Date | null;
  activeBreakMinutes: number;
  totalBreakMinutes: number;
  targetBph: number | null;
  minBph: number | null;
  /** Server-side KPI (overrides local when available) */
  serverKpi?: StationKpi | null;
}

function KpiBar({ sessionBatches, sessionStartedAt, activeBreakMinutes, totalBreakMinutes, targetBph, minBph, serverKpi }: KpiBarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const localActiveMinutes = sessionStartedAt
    ? Math.max(0, differenceInMinutes(now, sessionStartedAt) - totalBreakMinutes - activeBreakMinutes)
    : 0;
  const localBph = localActiveMinutes > 0 ? sessionBatches / (localActiveMinutes / 60) : 0;

  // Prefer server-side KPI when available (authoritative DB-based calculation)
  const activeMinutes = serverKpi?.activeMinutes ?? localActiveMinutes;
  const bph = serverKpi?.batchesPerHour ?? localBph;
  const batchCount = serverKpi?.batchesCompleted ?? sessionBatches;
  const breakMins = serverKpi?.breakMinutes ?? totalBreakMinutes;

  const bphColor = targetBph && minBph
    ? bph >= targetBph ? "text-emerald-700 dark:text-emerald-300"
      : bph >= minBph ? "text-amber-700 dark:text-amber-300"
      : "text-red-700 dark:text-red-300"
    : "text-foreground";

  const bgColor = targetBph && minBph
    ? bph >= targetBph ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800"
      : bph >= minBph ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
      : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
    : "bg-card border-border";

  return (
    <div className={cn("border rounded-xl px-4 py-3 flex items-center gap-6", bgColor)}>
      <TrendingUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
      <div className="flex items-center gap-6 flex-1 flex-wrap">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Today's batches</p>
          <p className="text-xl font-bold tabular-nums">{batchCount}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Active time</p>
          <p className="text-xl font-bold tabular-nums">
            {activeMinutes >= 60
              ? `${Math.floor(activeMinutes / 60)}h ${activeMinutes % 60}m`
              : `${activeMinutes}m`}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Break time</p>
          <p className="text-xl font-bold tabular-nums">{breakMins}m</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Batches / hour</p>
          <p className={cn("text-2xl font-bold tabular-nums", bphColor)}>
            {bph.toFixed(1)}
          </p>
        </div>
        {targetBph && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-lg font-semibold tabular-nums text-muted-foreground">{targetBph}</p>
          </div>
        )}
        {minBph && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Minimum</p>
            <p className="text-lg font-semibold tabular-nums text-muted-foreground">{minBph}</p>
          </div>
        )}
      </div>
      {serverKpi && (
        <span className="text-xs text-muted-foreground opacity-50 flex-shrink-0">live</span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// End-of-day summary modal for Building stations
// ──────────────────────────────────────────────────────────────────────────────
interface EodSummaryProps {
  items: ProductionPlanItem[];
  stationType: string;
  sessionBatches: number;
  totalBreakMinutes: number;
  sessionStartedAt: Date | null;
  onClose: () => void;
}

function EodSummary({ items, stationType, sessionBatches, totalBreakMinutes, sessionStartedAt, onClose }: EodSummaryProps) {
  const now = new Date();
  const totalMinutes = sessionStartedAt ? differenceInMinutes(now, sessionStartedAt) : 0;
  const activeMinutes = Math.max(0, totalMinutes - totalBreakMinutes);
  const activeHours = activeMinutes / 60;
  const bph = activeHours > 0 ? sessionBatches / activeHours : 0;
  const minsPerBatch = sessionBatches > 0 && activeMinutes > 0 ? activeMinutes / sessionBatches : null;

  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const completionRate = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  const stationLabel = stationType === "building_1" ? "Building Line 1"
    : stationType === "building_2" ? "Building Line 2"
    : stationType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl max-w-lg w-full shadow-xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-amber-500" />
            <div>
              <h2 className="font-semibold text-lg">End of Day Summary</h2>
              <p className="text-xs text-muted-foreground">{stationLabel}</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Session Batches</p>
              <p className="text-3xl font-bold tabular-nums">{sessionBatches}</p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Batches / Hour</p>
              <p className="text-3xl font-bold tabular-nums">{bph.toFixed(1)}</p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Active Time</p>
              <p className="text-2xl font-bold tabular-nums">
                {activeMinutes >= 60
                  ? `${Math.floor(activeMinutes / 60)}h ${activeMinutes % 60}m`
                  : `${activeMinutes}m`}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Break Time</p>
              <p className="text-2xl font-bold tabular-nums">{totalBreakMinutes}m</p>
            </div>
            {minsPerBatch != null && (
              <div className="bg-secondary/30 rounded-xl p-3 text-center col-span-1">
                <p className="text-xs text-muted-foreground mb-1">Avg Mins/Batch</p>
                <p className="text-2xl font-bold tabular-nums">{minsPerBatch.toFixed(1)}</p>
              </div>
            )}
            <div className="bg-secondary/30 rounded-xl p-3 text-center col-span-1">
              <p className="text-xs text-muted-foreground mb-1">Plan Completion</p>
              <p className={cn(
                "text-2xl font-bold tabular-nums",
                completionRate >= 100 ? "text-emerald-600 dark:text-emerald-400"
                  : completionRate >= 50 ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}>
                {completionRate}%
              </p>
            </div>
          </div>

          {/* Per-recipe breakdown */}
          <div className="bg-secondary/20 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Per-Recipe Breakdown
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="px-3 py-1.5 text-left font-medium">Recipe</th>
                  <th className="px-3 py-1.5 text-center font-medium">Target</th>
                  <th className="px-3 py-1.5 text-center font-medium">Done</th>
                  <th className="px-3 py-1.5 text-center font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const rate = (item.batchesTarget ?? 0) > 0
                    ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
                    : 0;
                  const rateColor = rate >= 100
                    ? "text-emerald-600 dark:text-emerald-400"
                    : rate >= 50 ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400";
                  return (
                    <tr key={item.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-medium truncate max-w-[160px]">
                        {item.recipeName ?? `Recipe #${item.recipeId}`}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {item.batchesTarget ?? 0}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums font-bold">
                        {item.batchesComplete ?? 0}
                      </td>
                      <td className={cn("px-3 py-2 text-center tabular-nums font-semibold text-xs", rateColor)}>
                        {rate}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-secondary/30 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-center tabular-nums">{totalBatchesTarget}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{totalBatchesComplete}</td>
                  <td className={cn(
                    "px-3 py-2 text-center tabular-nums text-xs",
                    completionRate >= 100 ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground"
                  )}>
                    {completionRate}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="p-6 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Mixing & Cooking Station
// ──────────────────────────────────────────────────────────────────────────────
interface MixingStationProps {
  plan: ProductionPlanDetail;
}

function MixingStation({ plan }: MixingStationProps) {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const queryClient = useQueryClient();

  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const updateOrder = useUpdateProductionPlanOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const canReorder = (item: ProductionPlanItem) => {
    if (isAdmin) return true;
    return (item.batchesComplete ?? 0) === 0 && item.status === "pending";
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const newItems = [...items];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const movingItem = newItems[index];
    const swappingWith = newItems[targetIndex];

    // Block if either item is started/in-progress (unless admin)
    if (!isAdmin) {
      if (movingItem.status !== "pending") return;
      if (swappingWith.status !== "pending") return;
    }

    [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
    const order = newItems.map((it, i) => ({ itemId: it.id, orderPosition: i + 1 }));
    updateOrder.mutate({ id: plan.id, data: { order } });
  };

  // addBatch: only via createBatchCompletion (server increments batchesComplete + status)
  const addBatch = (item: ProductionPlanItem) => {
    createBatch.mutate({
      id: plan.id,
      data: {
        planItemId: item.id,
        stationType: "mixing",
        completedAt: new Date().toISOString(),
      },
    });
  };

  // removeBatch: decrease via PATCH item only (no batch_completion row for undos)
  const removeBatch = (item: ProductionPlanItem) => {
    const newComplete = Math.max(0, (item.batchesComplete ?? 0) - 1);
    const newStatus = newComplete === 0 ? "pending" : newComplete >= (item.batchesTarget ?? 0) ? "complete" : "in-progress";
    updateItem.mutate({
      id: plan.id,
      itemId: item.id,
      data: { batchesComplete: newComplete, status: newStatus },
    });
  };

  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const overallProgress = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold">Today's Production</h2>
            <p className="text-sm text-muted-foreground">
              {totalBatchesComplete} of {totalBatchesTarget} batches complete
            </p>
          </div>
          <span className="text-2xl font-bold font-display">{overallProgress}%</span>
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

        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
          <BreakTracker planId={plan.id} stationType="mixing" />
        </div>
      </div>

      {/* Recipes list */}
      <div className="space-y-2">
        {items.map((item, index) => {
          const progress = (item.batchesTarget ?? 0) > 0
            ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
            : 0;
          const isComplete = item.status === "complete";
          const isStarted = (item.batchesComplete ?? 0) > 0;
          const isLocked = isStarted && !isAdmin;

          const statusColors = {
            pending: "border-border",
            "in-progress": "border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10",
            complete: "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10",
          };

          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl overflow-hidden transition-all",
                statusColors[item.status as keyof typeof statusColors] ?? "border-border"
              )}
            >
              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Order + move buttons */}
                  <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                    <span className="text-xs font-mono text-muted-foreground w-6 text-center">
                      {item.orderPosition}
                    </span>
                    {canReorder(item) && (
                      <>
                        <button
                          onClick={() => moveItem(index, "up")}
                          disabled={index === 0}
                          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => moveItem(index, "down")}
                          disabled={index === items.length - 1}
                          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {isLocked && (
                      <div className="text-muted-foreground opacity-40 mt-1" title="Locked — recipe in progress">
                        🔒
                      </div>
                    )}
                  </div>

                  {/* Recipe info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className={cn(
                        "font-semibold",
                        isComplete ? "line-through text-muted-foreground" : ""
                      )}>
                        {item.recipeName ?? `Recipe #${item.recipeId}`}
                      </h3>
                      {isComplete && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      )}
                      {item.status === "in-progress" && (
                        <PlayCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            isComplete ? "bg-emerald-500" : "bg-primary"
                          )}
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {item.batchesComplete ?? 0} / {item.batchesTarget ?? 0}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {item.tinSize && (
                        <span>{item.tinSize} tin</span>
                      )}
                      {item.maxBatchesPerTin && (item.batchesTarget ?? 0) > 0 && (
                        <span>
                          {Math.ceil((item.batchesTarget ?? 0) / item.maxBatchesPerTin)} tin{Math.ceil((item.batchesTarget ?? 0) / item.maxBatchesPerTin) !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Batch counter */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => removeBatch(item)}
                      disabled={(item.batchesComplete ?? 0) === 0}
                      className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <div className="w-12 text-center">
                      <span className="text-xl font-bold">{item.batchesComplete ?? 0}</span>
                    </div>
                    <button
                      onClick={() => addBatch(item)}
                      disabled={isComplete && !isAdmin}
                      className={cn(
                        "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                        isComplete
                          ? "border border-emerald-300 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 opacity-60"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      )}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Building Station (shared for building_1 and building_2)
// Full-screen recipe display, large BATCH COMPLETE button, KPI bar, auto-advance
// ──────────────────────────────────────────────────────────────────────────────
interface BuildingStationProps {
  plan: ProductionPlanDetail;
  lineNumber: 1 | 2;
}

function BuildingStation({ plan, lineNumber }: BuildingStationProps) {
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

  // Load timing standards for KPI color coding
  const { data: timingStandards } = useListTimingStandards();
  const standard = (timingStandards ?? []).find((s: { stationType?: string }) => s.stationType === stationType);
  const targetBph = standard?.targetBatchesPerHour != null ? Number(standard.targetBatchesPerHour) : null;
  const minBph = standard?.minBatchesPerHour != null ? Number(standard.minBatchesPerHour) : null;

  // Server-side KPI (polled every 30s — refreshes from DB-persisted completions and breaks)
  const { data: serverKpi } = useGetStationKpi(plan.id, { stationType }, {
    query: { queryKey: getGetStationKpiQueryKey(plan.id, { stationType }), refetchInterval: 30000 },
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

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => it.status === "in-progress") ?? items.find(it => it.status === "pending");
  const remaining = currentItem ? Math.max(0, (currentItem.batchesTarget ?? 0) - (currentItem.batchesComplete ?? 0)) : 0;
  const allDone = items.length > 0 && !currentItem;

  // Large "BATCH COMPLETE" tap — single write via createBatchCompletion only
  const handleBatchComplete = () => {
    if (!currentItem || pendingTap) return;
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

  // Undo last batch — PATCH item directly (no batch_completion for undos)
  const handleUndo = () => {
    if (!currentItem || (currentItem.batchesComplete ?? 0) === 0) return;
    const newComplete = (currentItem.batchesComplete ?? 0) - 1;
    const newStatus = newComplete === 0 ? "pending" : "in-progress";
    updateItem.mutate({
      id: plan.id,
      itemId: currentItem.id,
      data: { batchesComplete: newComplete, status: newStatus },
    });
    setSessionBatches(prev => Math.max(0, prev - 1));
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
    ? Math.round(((currentItem.batchesComplete ?? 0) / (currentItem.batchesTarget ?? 0)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {showEod && (
        <EodSummary
          items={items}
          stationType={stationType}
          sessionBatches={sessionBatches}
          totalBreakMinutes={totalBreakMinutes + activeBreakMinutes}
          sessionStartedAt={sessionStartedAt}
          onClose={() => setShowEod(false)}
        />
      )}

      {/* Current recipe — full-screen focus card */}
      {currentItem ? (
        <div className="bg-card border-2 border-primary rounded-2xl p-6">
          {/* Recipe name + progress */}
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Currently Building — Line {lineNumber}
            </p>
            <h2 className="font-display text-3xl font-bold leading-tight">
              {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
              {currentItem.tinSize && (
                <span className="bg-secondary/50 rounded px-2 py-0.5">{currentItem.tinSize} tin</span>
              )}
              {currentItem.portionsPerBatch > 0 && (
                <span className="bg-secondary/50 rounded px-2 py-0.5">{currentItem.portionsPerBatch} portions/batch</span>
              )}
              {currentItem.maxBatchesPerTin && (
                <span className="bg-secondary/50 rounded px-2 py-0.5">Max {currentItem.maxBatchesPerTin} batches/tin</span>
              )}
              {currentItem.notes && (
                <span className="italic text-xs">{currentItem.notes}</span>
              )}
            </div>
          </div>

          {/* Large batch counter */}
          <div className="flex items-center justify-center gap-8 my-6">
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Complete</p>
              <p className="text-6xl font-bold font-display tabular-nums text-primary">
                {currentItem.batchesComplete ?? 0}
              </p>
            </div>
            <div className="text-4xl font-light text-muted-foreground">/</div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Target</p>
              <p className="text-6xl font-bold font-display tabular-nums">
                {currentItem.batchesTarget ?? 0}
              </p>
            </div>
            {currentItem.maxBatchesPerTin && (currentItem.batchesTarget ?? 0) > 0 && (
              <>
                <div className="text-4xl font-light text-muted-foreground hidden sm:block">·</div>
                <div className="text-center hidden sm:block">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tins</p>
                  <p className="text-4xl font-bold font-display tabular-nums text-amber-600 dark:text-amber-400">
                    {Math.ceil((currentItem.batchesTarget ?? 0) / currentItem.maxBatchesPerTin)}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Remaining + progress */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>{remaining} batch{remaining !== 1 ? "es" : ""} remaining</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full h-4 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  pct >= 100 ? "bg-emerald-500" : "bg-primary"
                )}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>

          {/* Large BATCH COMPLETE button */}
          <button
            onClick={handleBatchComplete}
            disabled={pendingTap || activeBreakMinutes > 0}
            className={cn(
              "w-full py-6 rounded-2xl text-2xl font-bold transition-all select-none active:scale-95",
              remaining === 0
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-2 border-emerald-400 opacity-60 cursor-not-allowed"
                : pendingTap
                  ? "bg-primary/60 text-primary-foreground cursor-wait"
                  : activeBreakMinutes > 0
                    ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl"
            )}
          >
            {activeBreakMinutes > 0
              ? "On Break — End Break First"
              : remaining === 0
                ? "✓ All Batches Complete"
                : pendingTap
                  ? "Recording..."
                  : "BATCH COMPLETE ✓"}
          </button>

          {/* Undo */}
          {(currentItem.batchesComplete ?? 0) > 0 && (
            <button
              onClick={handleUndo}
              className="mt-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Undo last batch
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl p-10 text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">All Done! 🎉</h2>
          <p className="text-muted-foreground">Building Line {lineNumber} — all recipes complete for today.</p>
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

      {/* Break tracker */}
      <BreakTracker planId={plan.id} stationType={stationType} onBreakChange={handleBreakChange} />

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

      {/* Production Queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Production Queue — Line {lineNumber}</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border">
              <th className="py-2 px-4 text-left font-medium text-muted-foreground">#</th>
              <th className="py-2 px-4 text-left font-medium text-muted-foreground">Recipe</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Target</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Done</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Remaining</th>
              <th className="py-2 px-4 text-center font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const rem = Math.max(0, (item.batchesTarget ?? 0) - (item.batchesComplete ?? 0));
              const isCurrent = item.id === currentItem?.id;
              const statusColors = {
                pending: "text-muted-foreground",
                "in-progress": "text-blue-600 dark:text-blue-400 font-medium",
                complete: "text-emerald-600 dark:text-emerald-400",
              };
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-b border-border/50 last:border-0",
                    isCurrent ? "bg-primary/5" : ""
                  )}
                >
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                    {isCurrent && <span className="ml-2 text-xs text-primary font-normal">← now</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center font-medium">{item.batchesComplete ?? 0}</td>
                  <td className="py-2.5 px-4 text-center">
                    {item.status === "complete"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      : <span className="font-bold text-primary">{rem}</span>
                    }
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={cn("text-xs capitalize", statusColors[item.status as keyof typeof statusColors] ?? "text-muted-foreground")}>
                      {item.status === "in-progress" ? "In Progress" : item.status}
                    </span>
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
// Shared prep ingredient table
// ──────────────────────────────────────────────────────────────────────────────
function PrepIngredientTable({ items }: { items: PrepRequirementItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <p className="font-medium">No ingredients to display</p>
        <p className="text-sm mt-1">Make sure ingredient categories are set in the ingredients library</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary/20 border-b border-border">
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Ingredient</th>
            <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">Recipes</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Cooked Qty</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Raw Qty</th>
            <th className="py-2.5 px-4 text-right font-medium text-muted-foreground">Trays</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const hasProcLoss = item.processingRatio != null && item.processingRatio < 1;
            const formatQty = (q: number, unit: string) => {
              if (unit === "g" && q >= 1000) return `${(q / 1000).toFixed(2)} kg`;
              if (unit === "ml" && q >= 1000) return `${(q / 1000).toFixed(2)} l`;
              return `${q % 1 === 0 ? q : q.toFixed(2)} ${unit}`;
            };
            return (
              <tr key={item.ingredientId} className="border-b border-border/50 last:border-0">
                <td className="py-3 px-4 font-medium">{item.ingredientName}</td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{item.recipes.join(", ")}</td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {formatQty(item.totalCookedQty, item.unit)}
                </td>
                <td className={cn("py-3 px-4 text-right tabular-nums font-medium", hasProcLoss ? "text-amber-600 dark:text-amber-400" : "")}>
                  {formatQty(item.totalRawQty, item.unit)}
                  {hasProcLoss && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({((item.processingRatio ?? 1) * 100).toFixed(0)}%)
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  {item.trayCount != null ? (
                    <span className="font-bold text-base text-rose-600 dark:text-rose-400">{item.trayCount}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Veg Prep Station
// ──────────────────────────────────────────────────────────────────────────────
function PrepVegStation({ plan }: { plan: ProductionPlanDetail }) {
  const { data, isLoading } = useGetPrepRequirements(plan.id, { station: "prep_veg" });

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Salad className="w-6 h-6 text-green-500" />
          <div>
            <h2 className="font-semibold text-base">Vegetable Prep</h2>
            <p className="text-xs text-muted-foreground">
              Total raw vegetable quantities to prepare for this production run
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading requirements...
        </div>
      ) : (
        <PrepIngredientTable items={data?.items ?? []} />
      )}

      <BreakTracker planId={plan.id} stationType="prep_veg" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bases & Mozzarella Prep Station
// ──────────────────────────────────────────────────────────────────────────────
function PrepBasesStation({ plan }: { plan: ProductionPlanDetail }) {
  const { data, isLoading } = useGetPrepRequirements(plan.id, { station: "prep_bases" });

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Layers className="w-6 h-6 text-yellow-500" />
          <div>
            <h2 className="font-semibold text-base">Bases & Mozzarella Prep</h2>
            <p className="text-xs text-muted-foreground">
              Sauce, base, and cheese quantities to portion for this production run
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading requirements...
        </div>
      ) : (
        <PrepIngredientTable items={data?.items ?? []} />
      )}

      <BreakTracker planId={plan.id} stationType="prep_bases" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// ──────────────────────────────────────────────────────────────────────────────
function PrepMeatStation({ plan }: { plan: ProductionPlanDetail }) {
  const { data, isLoading } = useGetPrepRequirements(plan.id, { station: "prep_meat" });

  const totalTrays = (data?.items ?? []).reduce((sum: number, i: PrepRequirementItem) => sum + (i.trayCount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Beef className="w-6 h-6 text-rose-500" />
            <div>
              <h2 className="font-semibold text-base">Raw Meat Prep</h2>
              <p className="text-xs text-muted-foreground">
                Raw meat quantities and tray counts for this production run
              </p>
            </div>
          </div>
          {!isLoading && totalTrays > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Trays</p>
              <p className="text-3xl font-bold text-rose-600 dark:text-rose-400">{totalTrays}</p>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading requirements...
        </div>
      ) : (
        <PrepIngredientTable items={data?.items ?? []} />
      )}

      {data?.nextPlanDate && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <span className="font-medium">Next production day:</span> {data.nextPlanDate}
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="prep_meat" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Dough Prep Station
// ──────────────────────────────────────────────────────────────────────────────
function DoughPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });
  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);

  // addBatch: only via createBatchCompletion (server increments)
  const addBatch = (item: ProductionPlanItem) => {
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "dough_prep", completedAt: new Date().toISOString() } });
  };

  // removeBatch: PATCH item directly (no batch_completion for undos)
  const removeBatch = (item: ProductionPlanItem) => {
    const newComplete = Math.max(0, (item.batchesComplete ?? 0) - 1);
    const newStatus = newComplete === 0 ? "pending" : newComplete >= (item.batchesTarget ?? 0) ? "complete" : "in-progress";
    updateItem.mutate({ id: plan.id, itemId: item.id, data: { batchesComplete: newComplete, status: newStatus } });
  };

  const totalComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const overallPct = totalBatchesTarget > 0 ? Math.round((totalComplete / totalBatchesTarget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="font-semibold text-base">Dough Prep</h2>
              <p className="text-xs text-muted-foreground">
                {totalComplete} of {totalBatchesTarget} dough batches mixed
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-amber-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="dough_prep" />
        </div>
      </div>

      {/* Per-recipe dough batches */}
      <div className="space-y-2">
        {items.map(item => {
          const isComplete = item.status === "complete";
          const prog = (item.batchesTarget ?? 0) > 0
            ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
            : 0;
          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                isComplete
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : (item.batchesComplete ?? 0) > 0
                    ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10"
                    : "border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className={cn("font-semibold", isComplete ? "line-through text-muted-foreground" : "")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </h3>
                    {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-amber-500")}
                        style={{ width: `${Math.min(prog, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {item.batchesComplete ?? 0} / {item.batchesTarget ?? 0} batches
                    </span>
                  </div>
                  {item.tinSize && (
                    <p className="text-xs text-muted-foreground mt-1">{item.tinSize} tin</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => removeBatch(item)}
                    disabled={(item.batchesComplete ?? 0) === 0}
                    className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="w-10 text-center">
                    <span className="text-xl font-bold">{item.batchesComplete ?? 0}</span>
                  </div>
                  <button
                    onClick={() => addBatch(item)}
                    disabled={isComplete}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                      isComplete
                        ? "border border-emerald-300 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 opacity-60"
                        : "bg-amber-500 text-white hover:bg-amber-600"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Dough Sheeting Station
// ──────────────────────────────────────────────────────────────────────────────
function DoughSheetingStation({ plan }: { plan: ProductionPlanDetail }) {
  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => it.status === "in-progress") ?? items.find(it => it.status === "pending");

  return (
    <div className="space-y-4">
      {/* Active recipe spotlight */}
      {currentItem ? (
        <div className="bg-card border-2 border-amber-400 dark:border-amber-600 rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
            Now Sheeting
          </p>
          <h2 className="font-display text-2xl font-bold mb-3">
            {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <div className="bg-secondary/50 rounded-lg px-4 py-2.5 text-center min-w-[80px]">
              <p className="text-xs text-muted-foreground">Batches</p>
              <p className="text-2xl font-bold">{currentItem.batchesTarget ?? 0}</p>
            </div>
            {currentItem.tinSize && (
              <div className="bg-secondary/50 rounded-lg px-4 py-2.5 text-center min-w-[80px]">
                <p className="text-xs text-muted-foreground">Tin Size</p>
                <p className="text-2xl font-bold">{currentItem.tinSize}</p>
              </div>
            )}
            {currentItem.maxBatchesPerTin && (currentItem.batchesTarget ?? 0) > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-2.5 text-center min-w-[80px]">
                <p className="text-xs text-muted-foreground">Tins to Cut</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {Math.ceil((currentItem.batchesTarget ?? 0) / currentItem.maxBatchesPerTin)}
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">All sheeting complete!</h2>
          <p className="text-muted-foreground text-sm">Dough sheeting is done for today.</p>
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="dough_sheeting" />

      {/* Full queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Sheeting Queue</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
              <th className="py-2.5 px-4 text-left font-medium">#</th>
              <th className="py-2.5 px-4 text-left font-medium">Recipe</th>
              <th className="py-2.5 px-4 text-center font-medium">Batches</th>
              <th className="py-2.5 px-4 text-center font-medium">Tin</th>
              <th className="py-2.5 px-4 text-center font-medium">Tins to Cut</th>
              <th className="py-2.5 px-4 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const tins = item.maxBatchesPerTin && (item.batchesTarget ?? 0) > 0
                ? Math.ceil((item.batchesTarget ?? 0) / item.maxBatchesPerTin)
                : null;
              const isCurrent = item.id === currentItem?.id;
              return (
                <tr
                  key={item.id}
                  className={cn("border-b border-border/50 last:border-0", isCurrent ? "bg-amber-50/60 dark:bg-amber-900/10" : "")}
                >
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                    {isCurrent && <span className="ml-2 text-xs text-amber-600 font-normal">← current</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center text-muted-foreground">{item.tinSize ?? "—"}</td>
                  <td className="py-2.5 px-4 text-center font-semibold">
                    {tins != null ? tins : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={cn(
                      "text-xs capitalize",
                      item.status === "complete" ? "text-emerald-600 dark:text-emerald-400" :
                      item.status === "in-progress" ? "text-amber-600 dark:text-amber-400 font-medium" :
                      "text-muted-foreground"
                    )}>
                      {item.status === "in-progress" ? "In Progress" : item.status}
                    </span>
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
// Ovens Station
// ──────────────────────────────────────────────────────────────────────────────
function OvensStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });
  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => it.status === "in-progress") ?? items.find(it => it.status === "pending");

  // addBatch: only via createBatchCompletion (server increments)
  const addBatch = (item: ProductionPlanItem) => {
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "ovens", completedAt: new Date().toISOString() } });
  };

  // removeBatch: PATCH item directly
  const removeBatch = (item: ProductionPlanItem) => {
    const newComplete = Math.max(0, (item.batchesComplete ?? 0) - 1);
    const newStatus = newComplete === 0 ? "pending" : newComplete >= (item.batchesTarget ?? 0) ? "complete" : "in-progress";
    updateItem.mutate({ id: plan.id, itemId: item.id, data: { batchesComplete: newComplete, status: newStatus } });
  };

  const totalComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalComplete / totalTarget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Current recipe */}
      {currentItem ? (
        <div className="bg-card border-2 border-red-400 dark:border-red-600 rounded-xl p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">
            In Ovens Now
          </p>
          <h2 className="font-display text-2xl font-bold mb-3">
            {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
          </h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-secondary/50 rounded-lg px-4 py-2 text-center">
              <p className="text-xs text-muted-foreground">Loads Done</p>
              <p className="text-3xl font-bold">{currentItem.batchesComplete ?? 0}</p>
            </div>
            <div className="bg-secondary/50 rounded-lg px-4 py-2 text-center">
              <p className="text-xs text-muted-foreground">Target</p>
              <p className="text-3xl font-bold">{currentItem.batchesTarget ?? 0}</p>
            </div>
            {currentItem.maxBatchesPerTin && (currentItem.batchesTarget ?? 0) > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2 text-center">
                <p className="text-xs text-muted-foreground">Oven Loads</p>
                <p className="text-3xl font-bold text-red-600 dark:text-red-400">
                  {Math.ceil((currentItem.batchesTarget ?? 0) / currentItem.maxBatchesPerTin)}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => removeBatch(currentItem)}
              disabled={(currentItem.batchesComplete ?? 0) === 0}
              className="w-12 h-12 flex items-center justify-center rounded-full border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-5 h-5" />
            </button>
            <div className="text-5xl font-bold font-display tabular-nums w-20 text-center">
              {currentItem.batchesComplete ?? 0}
            </div>
            <button
              onClick={() => addBatch(currentItem)}
              disabled={currentItem.status === "complete" && !isAdmin}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">All ovens done!</h2>
          <p className="text-muted-foreground text-sm">All recipes through the ovens for today.</p>
        </div>
      )}

      {/* Overall progress */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Daily Progress</p>
          <span className="text-lg font-bold">{overallPct}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-red-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="ovens" />
        </div>
      </div>

      {/* Queue */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Oven Queue</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
              <th className="py-2 px-4 text-left font-medium">#</th>
              <th className="py-2 px-4 text-left font-medium">Recipe</th>
              <th className="py-2 px-4 text-center font-medium">Target</th>
              <th className="py-2 px-4 text-center font-medium">Done</th>
              <th className="py-2 px-4 text-center font-medium">Oven Loads</th>
              <th className="py-2 px-4 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const loads = item.maxBatchesPerTin && (item.batchesTarget ?? 0) > 0
                ? Math.ceil((item.batchesTarget ?? 0) / item.maxBatchesPerTin)
                : null;
              return (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center">{item.batchesComplete ?? 0}</td>
                  <td className="py-2.5 px-4 text-center font-medium">
                    {loads != null ? loads : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className={cn(
                      "text-xs capitalize",
                      item.status === "complete" ? "text-emerald-600 dark:text-emerald-400" :
                      item.status === "in-progress" ? "text-red-500 font-medium" :
                      "text-muted-foreground"
                    )}>
                      {item.status === "in-progress" ? "In Oven" : item.status}
                    </span>
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
// Wrapping Station
// ──────────────────────────────────────────────────────────────────────────────
function WrappingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";

  const updateItem = useUpdateProductionPlanItem({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });
  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const totalComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalComplete / totalTarget) * 100) : 0;

  // addBatch: only via createBatchCompletion
  const addBatch = (item: ProductionPlanItem) => {
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "wrapping", completedAt: new Date().toISOString() } });
  };

  // removeBatch: PATCH item directly
  const removeBatch = (item: ProductionPlanItem) => {
    const newComplete = Math.max(0, (item.batchesComplete ?? 0) - 1);
    const newStatus = newComplete === 0 ? "pending" : newComplete >= (item.batchesTarget ?? 0) ? "complete" : "in-progress";
    updateItem.mutate({ id: plan.id, itemId: item.id, data: { batchesComplete: newComplete, status: newStatus } });
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Gift className="w-6 h-6 text-purple-500" />
            <div>
              <h2 className="font-semibold text-base">Wrapping Station</h2>
              <p className="text-xs text-muted-foreground">
                {totalComplete} of {totalTarget} batches wrapped
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-purple-500")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="wrapping" />
        </div>
      </div>

      {/* Per-recipe wrapping list */}
      <div className="space-y-2">
        {items.map(item => {
          const isComplete = item.status === "complete";
          const prog = (item.batchesTarget ?? 0) > 0
            ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
            : 0;
          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                isComplete
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : (item.batchesComplete ?? 0) > 0
                    ? "border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10"
                    : "border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className={cn("font-semibold", isComplete ? "line-through text-muted-foreground" : "")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </h3>
                    {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-purple-500")}
                        style={{ width: `${Math.min(prog, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {item.batchesComplete ?? 0} / {item.batchesTarget ?? 0}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => removeBatch(item)}
                    disabled={(item.batchesComplete ?? 0) === 0}
                    className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="w-10 text-center">
                    <span className="text-xl font-bold">{item.batchesComplete ?? 0}</span>
                  </div>
                  <button
                    onClick={() => addBatch(item)}
                    disabled={isComplete && !isAdmin}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                      isComplete
                        ? "border border-emerald-300 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 opacity-60"
                        : "bg-purple-500 text-white hover:bg-purple-600"
                    )}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Packing Station
// ──────────────────────────────────────────────────────────────────────────────
function PackingStation({ plan }: { plan: ProductionPlanDetail }) {
  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const totalCompleteItems = items.filter(it => it.status === "complete").length;
  const grandTotalBatches = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const allDone = items.length > 0 && items.every(it => it.status === "complete");

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box className="w-6 h-6 text-indigo-500" />
            <div>
              <h2 className="font-semibold text-base">Packing Station</h2>
              <p className="text-xs text-muted-foreground">
                Final pack counts for today's production
              </p>
            </div>
          </div>
          {allDone && (
            <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Production Complete!</span>
            </div>
          )}
        </div>
      </div>

      {/* Per-recipe packing summary */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm">Pack Summary</h3>
          <span className="text-xs text-muted-foreground">
            {totalCompleteItems} of {items.length} recipes complete
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
              <th className="py-2.5 px-4 text-left font-medium">Recipe</th>
              <th className="py-2.5 px-4 text-center font-medium">Batches Done</th>
              <th className="py-2.5 px-4 text-center font-medium">Target Batches</th>
              <th className="py-2.5 px-4 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const isComplete = item.status === "complete";
              const batchDone = item.batchesComplete ?? 0;
              const batchTarget = item.batchesTarget ?? 0;
              const pct = batchTarget > 0 ? Math.round((batchDone / batchTarget) * 100) : 0;

              return (
                <tr key={item.id} className={cn("border-b border-border/50 last:border-0", isComplete ? "bg-emerald-50/30 dark:bg-emerald-900/10" : "")}>
                  <td className={cn("py-3 px-4 font-medium", isComplete ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </td>
                  <td className="py-3 px-4 text-center tabular-nums">
                    <span className={cn("text-base font-bold", isComplete ? "text-emerald-600 dark:text-emerald-400" : batchDone > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground")}>
                      {batchDone}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center text-muted-foreground">{batchTarget}</td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {isComplete ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Done</span>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full transition-all"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{pct}%</span>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-border bg-secondary/20 flex items-center justify-between">
          <span className="text-sm font-semibold">Grand Total Batches</span>
          <span className="text-lg font-bold tabular-nums">{grandTotalBatches}</span>
        </div>
      </div>

      <BreakTracker planId={plan.id} stationType="packing" />

      {allDone && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">
            Production complete for {format(parseISO(plan.planDate), "EEEE d MMMM")}
          </p>
          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
            All {items.length} recipes packed — great work!
          </p>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Station Page — 5-second polling via refetchInterval
// ──────────────────────────────────────────────────────────────────────────────
export default function StationPage() {
  const params = useParams<{ planId: string; stationType: string }>();
  const planId = Number(params.planId);
  const stationType = params.stationType as StationType;

  const { data: plan, isLoading } = useGetProductionPlan(planId, {
    query: {
      queryKey: getGetProductionPlanQueryKey(planId),
      refetchInterval: 5000,
    },
  }) as {
    data: ProductionPlanDetail | undefined;
    isLoading: boolean;
  };

  if (isNaN(planId)) {
    return <div className="p-8 text-center text-muted-foreground">Invalid plan ID</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  const stationContent = () => {
    if (!plan) return <div className="text-center py-12 text-muted-foreground">Plan not found</div>;

    switch (stationType) {
      case "mixing":
        return <MixingStation plan={plan} />;
      case "building_1":
        return <BuildingStation plan={plan} lineNumber={1} />;
      case "building_2":
        return <BuildingStation plan={plan} lineNumber={2} />;
      case "ovens":
        return <OvensStation plan={plan} />;
      case "wrapping":
        return <WrappingStation plan={plan} />;
      case "packing":
        return <PackingStation plan={plan} />;
      case "dough_prep":
        return <DoughPrepStation plan={plan} />;
      case "dough_sheeting":
        return <DoughSheetingStation plan={plan} />;
      case "prep_veg":
        return <PrepVegStation plan={plan} />;
      case "prep_bases":
        return <PrepBasesStation plan={plan} />;
      case "prep_meat":
        return <PrepMeatStation plan={plan} />;
      default:
        return <div className="text-center py-12 text-muted-foreground">Unknown station: {stationType}</div>;
    }
  };

  return (
    <StationLayout planId={planId} stationType={stationType} plan={plan}>
      {stationContent()}
    </StationLayout>
  );
}
