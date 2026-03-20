import React from "react";
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
  useListBatchCompletions,
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
  Beef, TrendingUp, Trophy, ExternalLink, ChevronRight,
  List, LayoutGrid, CalendarCheck,
} from "lucide-react";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

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
  { key: "prep", label: "Prep", short: "Prep", icon: Salad, color: "text-green-500" },
] as const;

type StationType = typeof STATIONS[number]["key"] | "prep_veg" | "prep_bases" | "prep_meat";

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
  // Resolve station label for sub-stations
  const resolveStationMeta = (key: StationType): { label: string; icon: React.ComponentType<{ className?: string }>; color: string } => {
    if (key === "prep_veg") return { label: "Veg Prep", icon: Salad, color: "text-green-500" };
    if (key === "prep_bases") return { label: "Bases & Mozzarella", icon: Layers, color: "text-yellow-500" };
    if (key === "prep_meat") return { label: "Raw Meat Prep", icon: Beef, color: "text-rose-500" };
    return station ?? { label: key, icon: BarChart2, color: "" };
  };
  const meta = resolveStationMeta(stationType);
  const StationIcon = meta.icon;

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal station header */}
      <div className="border-b border-border bg-card sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <StationIcon className={cn("w-5 h-5 flex-shrink-0", meta.color)} />
                <div className="min-w-0">
                  <h1 className="font-semibold truncate">{meta.label}</h1>
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
                  const prepSubStations = ["prep_veg", "prep_bases", "prep_meat"] as const;
                  const isActive = s.key === stationType || (s.key === "prep" && prepSubStations.includes(stationType as typeof prepSubStations[number]));
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
  const [hydrated, setHydrated] = useState(false);
  const createBreak = useCreateStationBreak();
  const endBreak = useEndStationBreak();

  // Hydrate active break from server on mount — recovers state after refresh/navigation
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/production-plans/${planId}/station-breaks/active?stationType=${encodeURIComponent(stationType)}`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: { id: number; breakType: string; startedAt: string } | null) => {
        if (cancelled) return;
        if (data && data.id) {
          setActiveBreak({ id: data.id, type: (data.breakType as "morning" | "lunch") ?? "morning", startedAt: data.startedAt });
        }
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [planId, stationType]);

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

  if (!hydrated) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading break status…
      </div>
    );
  }

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
  planId: number;
  items: ProductionPlanItem[];
  stationType: string;
  sessionBatches: number;
  totalBreakMinutes: number;
  sessionStartedAt: Date | null;
  onClose: () => void;
}

interface EodServerData {
  totalBatches: number;
  activeMinutes: number;
  breakMinutes: number;
  bph: number;
  minsPerBatch: number | null;
  planCompletionRate: number;
  perRecipe: Array<{ name: string; count: number; avgMins: number | null }>;
}

function EodSummary({ planId, items, stationType, sessionBatches, totalBreakMinutes, sessionStartedAt, onClose }: EodSummaryProps) {
  // Server-derived aggregates — authoritative, persisted, per-builder
  const [serverData, setServerData] = useState<EodServerData | null>(null);
  const [serverLoading, setServerLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/production-plans/${planId}/eod-summary?stationType=${encodeURIComponent(stationType)}`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: EodServerData | null) => {
        if (!cancelled) { setServerData(data); setServerLoading(false); }
      })
      .catch(() => { if (!cancelled) setServerLoading(false); });
    return () => { cancelled = true; };
  }, [planId, stationType]);

  // Fallback to local session state if server hasn't responded yet or returned no data
  const now = new Date();
  const localTotalMinutes = sessionStartedAt ? differenceInMinutes(now, sessionStartedAt) : 0;
  const localActiveMinutes = Math.max(0, localTotalMinutes - totalBreakMinutes);
  const localActiveHours = localActiveMinutes / 60;
  const localBph = localActiveHours > 0 ? sessionBatches / localActiveHours : 0;
  const localMinsPerBatch = sessionBatches > 0 && localActiveMinutes > 0 ? localActiveMinutes / sessionBatches : null;
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesComplete = items.reduce((s, it) => s + (it.batchesComplete ?? 0), 0);
  const localCompletionRate = totalBatchesTarget > 0 ? Math.round((totalBatchesComplete / totalBatchesTarget) * 100) : 0;

  const displayBatches = serverData?.totalBatches ?? sessionBatches;
  const displayActiveMinutes = serverData?.activeMinutes ?? localActiveMinutes;
  const displayBreakMinutes = serverData?.breakMinutes ?? totalBreakMinutes;
  const displayBph = serverData?.bph ?? localBph;
  const displayMinsPerBatch = serverData?.minsPerBatch ?? localMinsPerBatch;
  const displayCompletionRate = serverData?.planCompletionRate ?? localCompletionRate;

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
          {serverLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading server stats…
            </div>
          )}
          {/* KPI grid — server-derived, per-builder */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Your Batches</p>
              <p className="text-3xl font-bold tabular-nums">{displayBatches}</p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Batches / Hour</p>
              <p className="text-3xl font-bold tabular-nums">{displayBph.toFixed(1)}</p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Active Time</p>
              <p className="text-2xl font-bold tabular-nums">
                {displayActiveMinutes >= 60
                  ? `${Math.floor(displayActiveMinutes / 60)}h ${displayActiveMinutes % 60}m`
                  : `${displayActiveMinutes}m`}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Break Time</p>
              <p className="text-2xl font-bold tabular-nums">{displayBreakMinutes}m</p>
            </div>
            {displayMinsPerBatch != null && (
              <div className="bg-secondary/30 rounded-xl p-3 text-center col-span-1">
                <p className="text-xs text-muted-foreground mb-1">Avg Mins/Batch</p>
                <p className="text-2xl font-bold tabular-nums">{displayMinsPerBatch.toFixed(1)}</p>
              </div>
            )}
            <div className="bg-secondary/30 rounded-xl p-3 text-center col-span-1">
              <p className="text-xs text-muted-foreground mb-1">Plan Completion</p>
              <p className={cn(
                "text-2xl font-bold tabular-nums",
                displayCompletionRate >= 100 ? "text-emerald-600 dark:text-emerald-400"
                  : displayCompletionRate >= 50 ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              )}>
                {displayCompletionRate}%
              </p>
            </div>
          </div>

          {/* Per-recipe breakdown — server data (user-scoped) when available, else plan-level fallback */}
          <div className="bg-secondary/20 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Per-Recipe Breakdown {serverData ? "(your output)" : "(plan totals)"}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/50">
                  <th className="px-3 py-1.5 text-left font-medium">Recipe</th>
                  <th className="px-3 py-1.5 text-center font-medium">{serverData ? "Batches" : "Done"}</th>
                  <th className="px-3 py-1.5 text-center font-medium">Avg m/batch</th>
                </tr>
              </thead>
              <tbody>
                {serverData ? serverData.perRecipe.map(r => (
                  <tr key={r.name} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-medium truncate max-w-[160px]">{r.name}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{r.count}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                      {r.avgMins != null ? `${r.avgMins.toFixed(1)}m` : "—"}
                    </td>
                  </tr>
                )) : items.map(item => {
                  return (
                    <tr key={item.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-medium truncate max-w-[140px]">
                        {item.recipeName ?? `Recipe #${item.recipeId}`}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums font-bold">
                        {item.batchesComplete ?? 0}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">—</td>
                    </tr>
                  );
                })}
              </tbody>
              {!serverData && (
                <tfoot>
                  <tr className="bg-secondary/30 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-center tabular-nums">{totalBatchesComplete}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(it => it.id === active.id);
    const newIndex = items.findIndex(it => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const movingItem = items[oldIndex];
    const swappingWith = items[newIndex];

    // Block if either item is started/in-progress (unless admin)
    if (!isAdmin) {
      if (movingItem.status !== "pending" || swappingWith.status !== "pending") return;
    }

    const reordered = arrayMove(items, oldIndex, newIndex);
    const order = reordered.map((it, i) => ({ itemId: it.id, orderPosition: i + 1 }));
    updateOrder.mutate(
      { id: plan.id, data: { order } },
      {
        onSuccess: () => toast({ title: "Order saved", description: "Recipe order has been updated for all stations." }),
        onError: () => toast({ title: "Reorder failed", description: "Could not save the new order. Please try again.", variant: "destructive" }),
      }
    );
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

  // removeBatch: delete most recent batch_completion row + atomic decrement (keeps KPI metrics consistent)
  const removeBatch = async (item: ProductionPlanItem) => {
    if ((item.batchesComplete ?? 0) === 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "mixing" }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo batch. Please try again.", variant: "destructive" });
    }
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

      {/* Recipes list — drag-to-reorder (pending items only, unless admin) */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map(item => (
              <SortableMixingItem
                key={item.id}
                item={item}
                isAdmin={isAdmin}
                onAdd={() => addBatch(item)}
                onRemove={() => removeBatch(item)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableMixingItemProps {
  item: ProductionPlanItem;
  isAdmin: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

function SortableMixingItem({ item, isAdmin, onAdd, onRemove }: SortableMixingItemProps) {
  const isDraggable = isAdmin || (item.status === "pending" && (item.batchesComplete ?? 0) === 0);
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: item.id, disabled: !isDraggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  const progress = (item.batchesTarget ?? 0) > 0
    ? Math.round(((item.batchesComplete ?? 0) / (item.batchesTarget ?? 0)) * 100)
    : 0;
  const isComplete = item.status === "complete";

  const statusColors = {
    pending: "border-border",
    "in-progress": "border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10",
    complete: "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "bg-card border rounded-xl overflow-hidden transition-colors",
        statusColors[item.status as keyof typeof statusColors] ?? "border-border",
        isDragging && "shadow-xl"
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <div className="flex flex-col items-center gap-0.5 flex-shrink-0 pt-1">
            <span className="text-xs font-mono text-muted-foreground w-6 text-center leading-tight">
              {item.orderPosition}
            </span>
            {isDraggable ? (
              <div
                {...attributes}
                {...listeners}
                className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
                title="Drag to reorder"
              >
                <GripVertical className="w-4 h-4" />
              </div>
            ) : (
              <div className="p-1 text-muted-foreground opacity-30" title="Locked — recipe in progress">
                <GripVertical className="w-4 h-4" />
              </div>
            )}
          </div>

          {/* Recipe info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={cn("font-semibold", isComplete ? "line-through text-muted-foreground" : "")}>
                {item.recipeName ?? `Recipe #${item.recipeId}`}
              </h3>
              {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
              {item.status === "in-progress" && <PlayCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />}
            </div>

            {/* Progress bar */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {item.batchesComplete ?? 0} / {item.batchesTarget ?? 0}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {item.tinSize && <span>{item.tinSize} tin</span>}
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
              onClick={onRemove}
              disabled={(item.batchesComplete ?? 0) === 0}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <div className="w-12 text-center">
              <span className="text-xl font-bold">{item.batchesComplete ?? 0}</span>
            </div>
            <button
              onClick={onAdd}
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

  // Undo last batch — deletes the most recent batch_completion row for this user/station
  // and decrements batches_complete atomically, keeping KPI metrics consistent.
  const handleUndo = async () => {
    if (!currentItem || (currentItem.batchesComplete ?? 0) === 0) return;
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
    ? Math.round(((currentItem.batchesComplete ?? 0) / (currentItem.batchesTarget ?? 0)) * 100)
    : 0;

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

      {/* Current recipe — full-screen focus card */}
      {currentItem ? (
        <div className="bg-card border-2 border-primary rounded-2xl p-6">
          {/* Recipe name + progress */}
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Currently Building — Line {lineNumber}
            </p>
            <div className="flex items-start gap-3">
              <h2 className="font-display text-3xl font-bold leading-tight flex-1">
                {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
              </h2>
              {currentItem.sopUrl && (
                <a
                  href={currentItem.sopUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl text-blue-700 dark:text-blue-300 text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap mt-1"
                >
                  SOP <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
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

            {/* Building-specific: fill weight, base type, base weight */}
            {(currentItem.fillWeightGrams != null || currentItem.baseType != null || currentItem.baseWeightGrams != null) && (
              <div className="flex flex-wrap gap-3 mt-3">
                {currentItem.baseType && (
                  <div className="flex flex-col items-center bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2 min-w-[90px]">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Base</span>
                    <span className="text-lg font-bold text-amber-800 dark:text-amber-300">{currentItem.baseType}</span>
                  </div>
                )}
                {currentItem.baseWeightGrams != null && (
                  <div className="flex flex-col items-center bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2 min-w-[90px]">
                    <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Base Wt</span>
                    <span className="text-lg font-bold text-amber-800 dark:text-amber-300">{currentItem.baseWeightGrams}g</span>
                  </div>
                )}
                {currentItem.fillWeightGrams != null && (
                  <div className="flex flex-col items-center bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-2 min-w-[90px]">
                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-400">Fill Wt</span>
                    <span className="text-lg font-bold text-blue-800 dark:text-blue-300">{currentItem.fillWeightGrams}g</span>
                  </div>
                )}
              </div>
            )}
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
// Shared prep quantity formatter
// ──────────────────────────────────────────────────────────────────────────────
function fmtQty(q: number, unit: string): string {
  if (unit === "g" && q >= 1000) return `${(q / 1000).toFixed(2)} kg`;
  if (unit === "ml" && q >= 1000) return `${(q / 1000).toFixed(2)} l`;
  return `${q % 1 === 0 ? q : q.toFixed(2)} ${unit}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared prep ingredient table (overview mode)
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
            return (
              <tr key={item.ingredientId} className="border-b border-border/50 last:border-0">
                <td className="py-3 px-4 font-medium">{item.ingredientName}</td>
                <td className="py-3 px-4 text-muted-foreground text-xs">{item.recipes.join(", ")}</td>
                <td className="py-3 px-4 text-right tabular-nums">
                  {fmtQty(item.totalCookedQty, item.unit)}
                </td>
                <td className={cn("py-3 px-4 text-right tabular-nums font-medium", hasProcLoss ? "text-amber-600 dark:text-amber-400" : "")}>
                  {fmtQty(item.totalRawQty, item.unit)}
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
// Next-plan lookup hook — fetches the next active plan from the server
// ──────────────────────────────────────────────────────────────────────────────
interface NextActivePlan {
  planId: number | null;
  planDate: string | null;
  planName: string | null;
  status: string | null;
}

function useNextActivePlan() {
  const [data, setData] = useState<NextActivePlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetch("/api/production-plans/next-active", { credentials: "include" })
      .then(r => r.json())
      .then((json: NextActivePlan) => { if (!cancelled) { setData(json); setIsLoading(false); } })
      .catch(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { data, isLoading };
}

// ──────────────────────────────────────────────────────────────────────────────
// Prep date banner
// ──────────────────────────────────────────────────────────────────────────────
function PrepDateBanner({ planDate, planName, isLoading }: { planDate: string | null; planName: string | null; isLoading: boolean }) {
  if (isLoading) return null;
  if (!planDate) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
        <CalendarCheck className="w-4 h-4 flex-shrink-0" />
        <span>No upcoming production plan found within 7 days.</span>
      </div>
    );
  }

  const formatted = format(parseISO(planDate), "EEEE, d MMMM yyyy");
  return (
    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <CalendarCheck className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">Prepping for</p>
        <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-tight">{formatted}</p>
        {planName && <p className="text-xs text-green-700 dark:text-green-400">{planName}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Full-screen prep item mode
// A generic full-screen card that navigates through a list of items one at a time.
// ──────────────────────────────────────────────────────────────────────────────
interface PrepFullScreenItem {
  id: string;
  name: string;
  quantity: string;
  subDetail?: string;
  badge?: { label: string; value: string | number; color: "green" | "rose" | "amber" | "blue" };
  sopUrl?: string | null;
}

function PrepFullScreenMode({
  items,
  planDate,
  planName,
  isLoadingPlan,
  stationLabel,
  stationColor,
  stationIcon: StationIcon,
  onOverviewClick,
}: {
  items: PrepFullScreenItem[];
  planDate: string | null;
  planName: string | null;
  isLoadingPlan: boolean;
  stationLabel: string;
  stationColor: string;
  stationIcon: React.ComponentType<{ className?: string }>;
  onOverviewClick: () => void;
}) {
  const [idx, setIdx] = useState(0);

  const total = items.length;
  const current = items[Math.min(idx, total - 1)];
  const isDone = idx >= total;
  const badgeColors = {
    green: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-200",
    rose: "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200",
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200",
    blue: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-200",
  };

  return (
    <div className="space-y-4">
      <PrepDateBanner planDate={planDate} planName={planName} isLoading={isLoadingPlan} />

      {/* Progress + overview toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StationIcon className={cn("w-5 h-5", stationColor)} />
          <span className="font-semibold text-sm">{stationLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && !isDone && (
            <span className="text-sm text-muted-foreground tabular-nums">{idx + 1} of {total}</span>
          )}
          <button
            onClick={onOverviewClick}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
          >
            <List className="w-4 h-4" />
            Overview
          </button>
        </div>
      </div>

      {/* Main card */}
      {total === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center text-muted-foreground">
          <p className="font-medium text-lg">Nothing to prep</p>
          <p className="text-sm mt-1">No ingredients found for this station</p>
        </div>
      ) : isDone ? (
        <div className="bg-card border-2 border-green-500 rounded-2xl p-12 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-3xl font-bold text-green-700 dark:text-green-400">All done!</h2>
          <p className="text-muted-foreground">All {total} item{total !== 1 ? "s" : ""} prepped</p>
          <button
            onClick={() => setIdx(0)}
            className="px-6 py-2 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50 transition-colors"
          >
            Start again
          </button>
        </div>
      ) : (
        <div className="bg-card border-2 border-primary rounded-2xl p-6 space-y-6">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Item {idx + 1} of {total}
              </p>
              <h2 className="font-display text-4xl font-bold leading-tight break-words">
                {current.name}
              </h2>
            </div>
            {current.sopUrl && (
              <a
                href={current.sopUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl text-blue-700 dark:text-blue-300 text-sm font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap flex-shrink-0"
              >
                SOP <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Quantity — huge */}
          <div className="text-center py-4">
            <p className="text-6xl font-bold font-display tabular-nums text-primary">
              {current.quantity}
            </p>
            {current.subDetail && (
              <p className="text-muted-foreground mt-2 text-lg">{current.subDetail}</p>
            )}
          </div>

          {/* Optional badge (tray count, tin count, etc.) */}
          {current.badge && (
            <div className={cn("border rounded-xl px-4 py-3 flex items-center justify-between", badgeColors[current.badge.color])}>
              <span className="font-medium text-sm">{current.badge.label}</span>
              <span className="text-3xl font-bold tabular-nums">{current.badge.value}</span>
            </div>
          )}

          {/* Progress bar */}
          <div className="w-full bg-secondary/30 rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all"
              style={{ width: `${((idx + 1) / total) * 100}%` }}
            />
          </div>

          {/* Done → Next button */}
          <button
            onClick={() => setIdx(i => i + 1)}
            className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-bold text-xl tracking-wide flex items-center justify-center gap-3 active:scale-[0.98] transition-transform"
          >
            {idx < total - 1 ? (
              <>Done — Next <ChevronRight className="w-6 h-6" /></>
            ) : (
              <>All Done <CheckCircle2 className="w-6 h-6" /></>
            )}
          </button>

          {/* Prev / skip navigation */}
          <div className="flex gap-3">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setIdx(i => Math.min(total, i + 1))}
              className="flex-1 py-3 rounded-xl border border-border text-sm font-medium hover:bg-secondary/50 transition-colors"
            >
              Skip →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared: fetch prep requirements for the next active plan
// ──────────────────────────────────────────────────────────────────────────────
function usePrepRequirementsForNextPlan(station: string) {
  const { data: nextPlan, isLoading: isPlanLoading } = useNextActivePlan() as { data: NextActivePlan | null; isLoading: boolean };
  const planId = nextPlan?.planId ?? 0;
  const { data: prepData, isLoading: isPrepLoading } = useGetPrepRequirements(
    planId,
    { station },
  );
  return {
    items: (planId ? (prepData?.items ?? []) : []) as PrepRequirementItem[],
    isLoading: isPlanLoading || (!!planId && isPrepLoading),
    nextPlan,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Veg Prep Station
// Full-screen or overview view of vegetable ingredients grouped by recipe
// ──────────────────────────────────────────────────────────────────────────────
function PrepVegStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { items, isLoading, nextPlan } = usePrepRequirementsForNextPlan("prep_veg");

  // Build full-screen items — grouped by recipe then ingredient
  const fullScreenItems: PrepFullScreenItem[] = items.flatMap(item => {
    const hasProcLoss = item.processingRatio != null && item.processingRatio < 1;
    return [{
      id: `${item.ingredientId}`,
      name: item.ingredientName,
      quantity: fmtQty(item.totalRawQty, item.unit),
      subDetail: item.recipes.length > 0
        ? `Used in: ${item.recipes.join(", ")}` + (hasProcLoss ? ` · Yield ratio: ${((item.processingRatio ?? 1) * 100).toFixed(0)}%` : "")
        : hasProcLoss ? `Yield ratio: ${((item.processingRatio ?? 1) * 100).toFixed(0)}%` : undefined,
    }];
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (mode === "fullscreen") {
    return (
      <PrepFullScreenMode
        items={fullScreenItems}
        planDate={nextPlan?.planDate ?? null}
        planName={nextPlan?.planName ?? null}
        isLoadingPlan={false}
        stationLabel="Veg Prep"
        stationColor="text-green-500"
        stationIcon={Salad}
        onOverviewClick={() => setMode("overview")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PrepDateBanner planDate={nextPlan?.planDate ?? null} planName={nextPlan?.planName ?? null} isLoading={false} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Salad className="w-5 h-5 text-green-500" />
          <h2 className="font-semibold">Veg Prep — Overview</h2>
        </div>
        <button
          onClick={() => setMode("fullscreen")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
        >
          <LayoutGrid className="w-4 h-4" />
          Full-screen
        </button>
      </div>

      <PrepIngredientTable items={items} />
      <BreakTracker planId={plan.id} stationType="prep_veg" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bases & Mozzarella Prep Station
// Shows sauce/base/cheese ingredients with per-recipe tin counts
// ──────────────────────────────────────────────────────────────────────────────
function PrepBasesStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { items, isLoading, nextPlan } = usePrepRequirementsForNextPlan("prep_bases");

  // Fetch plan items for the next plan to compute tin counts
  const nextPlanId = nextPlan?.planId ?? 0;
  const [planItems, setPlanItems] = useState<Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    sopUrl: string | null;
  }>>([]);

  useEffect(() => {
    if (!nextPlanId) { setPlanItems([]); return; }
    let cancelled = false;
    fetch(`/api/production-plans/${nextPlanId}`, { credentials: "include" })
      .then(r => r.json())
      .then((json: { items?: Array<{ recipeId: number; recipeName?: string; batchesTarget?: number; tinSize?: string | null; maxBatchesPerTin?: number | null; sopUrl?: string | null }> }) => {
        if (!cancelled) {
          setPlanItems((json.items ?? []).map(i => ({
            recipeId: i.recipeId,
            recipeName: i.recipeName ?? `Recipe #${i.recipeId}`,
            batchesTarget: i.batchesTarget ?? 0,
            tinSize: i.tinSize ?? null,
            maxBatchesPerTin: i.maxBatchesPerTin ?? null,
            sopUrl: i.sopUrl ?? null,
          })));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nextPlanId]);

  // Build full-screen items with tin counts per recipe
  const fullScreenItems: PrepFullScreenItem[] = items.flatMap(item => {
    const recipeEntries = planItems.filter(pi =>
      item.recipes.includes(pi.recipeName)
    );
    const result: PrepFullScreenItem[] = [];

    if (recipeEntries.length === 0) {
      result.push({
        id: `${item.ingredientId}`,
        name: item.ingredientName,
        quantity: fmtQty(item.totalCookedQty, item.unit),
        subDetail: item.recipes.length > 0 ? `Recipes: ${item.recipes.join(", ")}` : undefined,
      });
    } else {
      // One entry per recipe
      for (const pi of recipeEntries) {
        const tinCount = pi.maxBatchesPerTin ? Math.ceil(pi.batchesTarget / pi.maxBatchesPerTin) : null;
        result.push({
          id: `${item.ingredientId}-${pi.recipeId}`,
          name: `${item.ingredientName} — ${pi.recipeName}`,
          quantity: fmtQty(item.totalCookedQty / (recipeEntries.length || 1), item.unit),
          subDetail: pi.tinSize ? `${pi.tinSize} tin` : undefined,
          badge: tinCount != null ? {
            label: "Number of tins",
            value: tinCount,
            color: "green",
          } : undefined,
          sopUrl: pi.sopUrl,
        });
      }
    }
    return result;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (mode === "fullscreen") {
    return (
      <PrepFullScreenMode
        items={fullScreenItems}
        planDate={nextPlan?.planDate ?? null}
        planName={nextPlan?.planName ?? null}
        isLoadingPlan={false}
        stationLabel="Bases & Mozzarella"
        stationColor="text-yellow-500"
        stationIcon={Layers}
        onOverviewClick={() => setMode("overview")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PrepDateBanner planDate={nextPlan?.planDate ?? null} planName={nextPlan?.planName ?? null} isLoading={false} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-yellow-500" />
          <h2 className="font-semibold">Bases & Mozzarella — Overview</h2>
        </div>
        <button
          onClick={() => setMode("fullscreen")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
        >
          <LayoutGrid className="w-4 h-4" />
          Full-screen
        </button>
      </div>

      {/* Per-recipe tin breakdown */}
      {planItems.filter(pi => pi.tinSize || pi.maxBatchesPerTin).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-secondary/20 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tin Counts by Recipe</p>
          </div>
          <div className="divide-y divide-border/50">
            {planItems.map(pi => {
              if (!pi.tinSize && !pi.maxBatchesPerTin) return null;
              const tinCount = pi.maxBatchesPerTin ? Math.ceil(pi.batchesTarget / pi.maxBatchesPerTin) : null;
              return (
                <div key={pi.recipeId} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{pi.recipeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {pi.batchesTarget} batch{pi.batchesTarget !== 1 ? "es" : ""}
                      {pi.maxBatchesPerTin ? ` · ${pi.maxBatchesPerTin}/tin` : ""}
                      {pi.tinSize ? ` · ${pi.tinSize}` : ""}
                    </p>
                  </div>
                  {tinCount != null && (
                    <span className="text-3xl font-bold text-green-600 dark:text-green-400 tabular-nums">{tinCount} <span className="text-sm font-normal text-muted-foreground">tins</span></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <PrepIngredientTable items={items} />
      <BreakTracker planId={plan.id} stationType="prep_bases" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// Per-recipe tray count and per-tray breakdown
// ──────────────────────────────────────────────────────────────────────────────
function PrepMeatStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { items, isLoading, nextPlan } = usePrepRequirementsForNextPlan("prep_meat");

  const totalTrays = items.reduce((sum: number, i: PrepRequirementItem) => sum + (i.trayCount ?? 0), 0);

  // Build full-screen items — one entry per ingredient with per-tray detail
  const fullScreenItems: PrepFullScreenItem[] = items.map(item => {
    const trays = item.trayCount ?? null;
    const perTrayKg = trays && trays > 0
      ? ((item.totalRawQty / 1000) / trays).toFixed(2)
      : null;
    return {
      id: `${item.ingredientId}`,
      name: item.ingredientName,
      quantity: fmtQty(item.totalRawQty, item.unit),
      subDetail: [
        item.recipes.length > 0 ? `Recipes: ${item.recipes.join(", ")}` : null,
        perTrayKg ? `${perTrayKg} kg per tray` : null,
        item.processingRatio != null && item.processingRatio < 1
          ? `Yield: ${((item.processingRatio) * 100).toFixed(0)}%`
          : null,
      ].filter(Boolean).join(" · ") || undefined,
      badge: trays != null ? {
        label: "Trays needed",
        value: trays,
        color: "rose" as const,
      } : undefined,
    };
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  if (mode === "fullscreen") {
    return (
      <PrepFullScreenMode
        items={fullScreenItems}
        planDate={nextPlan?.planDate ?? null}
        planName={nextPlan?.planName ?? null}
        isLoadingPlan={false}
        stationLabel="Raw Meat Prep"
        stationColor="text-rose-500"
        stationIcon={Beef}
        onOverviewClick={() => setMode("overview")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PrepDateBanner planDate={nextPlan?.planDate ?? null} planName={nextPlan?.planName ?? null} isLoading={false} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Beef className="w-5 h-5 text-rose-500" />
          <h2 className="font-semibold">Raw Meat Prep — Overview</h2>
        </div>
        <div className="flex items-center gap-3">
          {totalTrays > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total Trays</p>
              <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{totalTrays}</p>
            </div>
          )}
          <button
            onClick={() => setMode("fullscreen")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            Full-screen
          </button>
        </div>
      </div>

      {/* Per-ingredient tray detail cards */}
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => {
            const trays = item.trayCount ?? null;
            const perTrayKg = trays && trays > 0
              ? ((item.totalRawQty / 1000) / trays).toFixed(2)
              : null;
            return (
              <div key={item.ingredientId} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-semibold">{item.ingredientName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.recipes.join(", ")}</p>
                    <p className="text-sm mt-2 tabular-nums">
                      Total raw: <span className="font-medium">{fmtQty(item.totalRawQty, item.unit)}</span>
                    </p>
                    {perTrayKg && (
                      <p className="text-xs text-muted-foreground">
                        {perTrayKg} kg/tray
                      </p>
                    )}
                  </div>
                  {trays != null && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Trays</p>
                      <p className="text-4xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{trays}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {items.length === 0 && (
        <PrepIngredientTable items={items} />
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

  // removeBatch: delete most recent batch_completion row + atomic decrement
  const removeBatch = async (item: ProductionPlanItem) => {
    if ((item.batchesComplete ?? 0) === 0) return;
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

  // removeBatch: delete most recent batch_completion row + atomic decrement
  const removeBatch = async (item: ProductionPlanItem) => {
    if ((item.batchesComplete ?? 0) === 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "ovens" }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo batch. Please try again.", variant: "destructive" });
    }
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

  // removeBatch: delete most recent batch_completion row + atomic decrement
  const removeBatch = async (item: ProductionPlanItem) => {
    if ((item.batchesComplete ?? 0) === 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "wrapping" }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo batch. Please try again.", variant: "destructive" });
    }
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
// Prep Hub — sub-station picker shown when "Prep" tile is selected
// ──────────────────────────────────────────────────────────────────────────────
function PrepHub({ planId }: { planId: number }) {
  const [, navigate] = useLocation();
  const { data: nextPlan, isLoading } = useNextActivePlan() as { data: NextActivePlan | null; isLoading: boolean };

  const subStations = [
    {
      key: "prep_veg",
      label: "Raw Veg",
      icon: Salad,
      color: "text-green-500",
      borderColor: "border-green-200 dark:border-green-800",
      bgColor: "bg-green-50 dark:bg-green-950/20",
      description: "Vegetable prep quantities for the next production run",
    },
    {
      key: "prep_bases",
      label: "Bases & Mozzarella",
      icon: Layers,
      color: "text-yellow-500",
      borderColor: "border-yellow-200 dark:border-yellow-800",
      bgColor: "bg-yellow-50 dark:bg-yellow-950/20",
      description: "Sauce bases, dough bases, and mozzarella portioning with tin counts",
    },
    {
      key: "prep_meat",
      label: "Raw Meat",
      icon: Beef,
      color: "text-rose-500",
      borderColor: "border-rose-200 dark:border-rose-800",
      bgColor: "bg-rose-50 dark:bg-rose-950/20",
      description: "Raw meat quantities, seasoning weights, and tray assignments",
    },
  ] as const;

  return (
    <div className="space-y-5">
      <PrepDateBanner
        planDate={nextPlan?.planDate ?? null}
        planName={nextPlan?.planName ?? null}
        isLoading={isLoading}
      />

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Select prep station
        </p>
        <div className="grid gap-4">
          {subStations.map(s => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
                className={cn(
                  "flex items-center gap-4 p-5 border-2 rounded-2xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]",
                  s.borderColor,
                  s.bgColor
                )}
              >
                <div className={cn("p-3 bg-background rounded-xl border", s.borderColor)}>
                  <Icon className={cn("w-8 h-8", s.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg">{s.label}</h3>
                  <p className="text-sm text-muted-foreground leading-snug">{s.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
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
      case "prep":
        return <PrepHub planId={planId} />;
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
