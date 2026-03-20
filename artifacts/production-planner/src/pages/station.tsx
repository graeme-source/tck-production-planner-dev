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
  Snowflake, Truck, AlertCircle, Info, Droplets,
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

function getStationCount(item: ProductionPlanItem, stationType: string): number {
  const sc = (item as any).stationCompletions;
  if (!sc || typeof sc !== "object") return 0;
  return sc[stationType] ?? 0;
}

function getPrevStationCount(item: ProductionPlanItem, stationType: string): number {
  const sc = (item as any).stationCompletions;
  if (!sc || typeof sc !== "object") return item.batchesTarget ?? 0;
  const deps: Record<string, string[]> = {
    building_1: ["mixing"],
    building_2: ["mixing"],
    ovens: ["building_1", "building_2"],
    wrapping: ["ovens"],
  };
  const prevStations = deps[stationType];
  if (!prevStations) return item.batchesTarget ?? 0;
  return prevStations.reduce((sum, s) => sum + (sc[s] ?? 0), 0);
}

function getAvailableFromPrev(item: ProductionPlanItem, stationType: string): number {
  return Math.max(0, getPrevStationCount(item, stationType) - getStationCount(item, stationType));
}

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
  const totalBatchesComplete = items.reduce((s, it) => s + getStationCount(it, stationType), 0);
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
                        {getStationCount(item, stationType)}
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

  const getTinInfo = (item: ProductionPlanItem) => {
    const bpt = item.maxBatchesPerTin ?? 1;
    const target = item.batchesTarget ?? 0;
    const mixed = getStationCount(item, "mixing");
    const tinsTarget = Math.ceil(target / bpt);
    const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
    const tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixed / batchesPerTinEven), tinsTarget) : 0;
    if (mixed >= target && target > 0) {
      return { tinsTarget, tinsComplete: tinsTarget, batchesPerTinEven, mixed, target, allDone: true };
    }
    return { tinsTarget, tinsComplete, batchesPerTinEven, mixed, target, allDone: false };
  };

  const addTin = async (item: ProductionPlanItem) => {
    const { tinsTarget, tinsComplete, batchesPerTinEven, mixed, target, allDone } = getTinInfo(item);
    if (allDone) return;
    const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
    const batchesToAdd = batchesAfterNextTin - mixed;
    if (batchesToAdd <= 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "mixing", count: batchesToAdd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Could not complete tin", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    }
  };

  const undoTin = async (item: ProductionPlanItem) => {
    const { tinsComplete, batchesPerTinEven, mixed } = getTinInfo(item);
    if (tinsComplete === 0 && mixed === 0) return;
    const prevTinThreshold = Math.max((tinsComplete - 1) * batchesPerTinEven, 0);
    const batchesToRemove = mixed - prevTinThreshold;
    if (batchesToRemove <= 0) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/bulk`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, stationType: "mixing", count: batchesToRemove }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo tin. Please try again.", variant: "destructive" });
    }
  };

  const totalTinsTarget = items.reduce((s, it) => s + getTinInfo(it).tinsTarget, 0);
  const totalTinsComplete = items.reduce((s, it) => s + getTinInfo(it).tinsComplete, 0);
  const totalBatchesDone = items.reduce((s, it) => s + getStationCount(it, "mixing"), 0);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallProgress = totalTinsTarget > 0 ? Math.round((totalTinsComplete / totalTinsTarget) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="font-semibold">Today's Production</h2>
            <p className="text-sm text-muted-foreground">
              {totalTinsComplete} of {totalTinsTarget} tins complete · {totalBatchesDone} / {totalBatchesTarget} batches
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
                onAdd={() => addTin(item)}
                onRemove={() => undoTin(item)}
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
  const mixingCount = getStationCount(item, "mixing");
  const isDraggable = isAdmin || (item.status === "pending" && mixingCount === 0);
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

  const target = item.batchesTarget ?? 0;
  const bpt = item.maxBatchesPerTin ?? 1;
  const tinsTarget = Math.ceil(target / bpt);
  const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
  let tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixingCount / batchesPerTinEven), tinsTarget) : 0;
  if (mixingCount >= target && target > 0) tinsComplete = tinsTarget;
  const allTinsDone = tinsComplete >= tinsTarget;
  const progress = tinsTarget > 0 ? Math.round((tinsComplete / tinsTarget) * 100) : 0;
  const isComplete = mixingCount >= target && target > 0;

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

            {/* Tin progress */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-primary")}
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {item.tinSize && <span>{item.tinSize}</span>}
              <span>~{batchesPerTinEven} batches/tin</span>
              <span>{mixingCount} / {target} batches total</span>
            </div>
          </div>

          {/* Tin counter — each tap = 1 full tin */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onRemove}
              disabled={tinsComplete === 0}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <div className="w-14 text-center">
              <span className="text-xl font-bold">{tinsComplete}</span>
              <span className="text-xs text-muted-foreground block leading-tight">/ {tinsTarget} tin{tinsTarget !== 1 ? "s" : ""}</span>
            </div>
            <button
              onClick={onAdd}
              disabled={allTinsDone && !isAdmin}
              className={cn(
                "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                allTinsDone
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
  const currentItem = items.find(it => {
    const sc = getStationCount(it, stationType);
    return sc < (it.batchesTarget ?? 0);
  });
  const buildingCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  const available = currentItem ? getAvailableFromPrev(currentItem, stationType) : 0;
  const remaining = currentItem ? Math.max(0, (currentItem.batchesTarget ?? 0) - buildingCount) : 0;
  const allDone = items.length > 0 && !currentItem;

  // Large "BATCH COMPLETE" tap — single write via createBatchCompletion only
  const handleBatchComplete = () => {
    if (!currentItem || pendingTap || available <= 0) return;
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
    if (!currentItem || buildingCount === 0) return;
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

          {/* Cascade availability badge */}
          {available <= 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl mb-4">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">Waiting for Mixing to complete more batches</p>
            </div>
          )}

          {/* Large batch counter */}
          <div className="flex items-center justify-center gap-8 my-6">
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Built</p>
              <p className="text-6xl font-bold font-display tabular-nums text-primary">
                {buildingCount}
              </p>
            </div>
            <div className="text-4xl font-light text-muted-foreground">/</div>
            <div className="text-center">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Target</p>
              <p className="text-6xl font-bold font-display tabular-nums">
                {currentItem.batchesTarget ?? 0}
              </p>
            </div>
            <div className="text-4xl font-light text-muted-foreground hidden sm:block">·</div>
            <div className="text-center hidden sm:block">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1">Mixed</p>
              <p className="text-4xl font-bold font-display tabular-nums text-blue-600 dark:text-blue-400">
                {getPrevStationCount(currentItem, stationType)}
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
            disabled={pendingTap || activeBreakMinutes > 0 || available <= 0}
            className={cn(
              "w-full py-6 rounded-2xl text-2xl font-bold transition-all select-none active:scale-95",
              remaining === 0
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-2 border-emerald-400 opacity-60 cursor-not-allowed"
                : available <= 0
                  ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
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
                : available <= 0
                  ? "Waiting for Mixing…"
                  : pendingTap
                    ? "Recording..."
                    : "BATCH COMPLETE ✓"}
          </button>

          {/* Undo */}
          {buildingCount > 0 && (
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
              const stCount = getStationCount(item, stationType);
              const rem = Math.max(0, (item.batchesTarget ?? 0) - stCount);
              const isCurrent = item.id === currentItem?.id;
              const isDone = stCount >= (item.batchesTarget ?? 0);
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-b border-border/50 last:border-0",
                    isCurrent ? "bg-primary/5" : ""
                  )}
                >
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", isDone ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                    {isCurrent && <span className="ml-2 text-xs text-primary font-normal">← now</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center font-medium">{stCount}</td>
                  <td className="py-2.5 px-4 text-center">
                    {item.status === "complete"
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      : <span className="font-bold text-primary">{rem}</span>
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
function PrepDateBanner({ planDate, planName, isLoading, labelPrefix = "Prep for" }: { planDate: string | null; planName: string | null; isLoading: boolean; labelPrefix?: string }) {
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
        <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">{labelPrefix}</p>
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
// Per-recipe prep data types
// ──────────────────────────────────────────────────────────────────────────────
interface PrepIngredientDetail {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  processingRatio: number | null;
  rawMeatTrayCapacityKg: number | null;
  cookedQty: number;
  rawQty: number;
  isRawMeat: boolean;
  isSeasoning: boolean;
}

interface PrepRecipeDetail {
  recipeId: number;
  recipeName: string;
  batchesTarget: number;
  sopUrl: string | null;
  tinSize: string | null;
  maxBatchesPerTin: number | null;
  tinCount: number | null;
  trayCount: number | null;
  ingredients: PrepIngredientDetail[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook: fetch per-recipe prep requirements for the next active plan
// ──────────────────────────────────────────────────────────────────────────────
function usePrepByRecipe(station: string) {
  const { data: nextPlan, isLoading: isPlanLoading } = useNextActivePlan() as { data: NextActivePlan | null; isLoading: boolean };
  const planId = nextPlan?.planId ?? 0;
  const [recipes, setRecipes] = useState<PrepRecipeDetail[]>([]);
  const [isPrepLoading, setIsPrepLoading] = useState(false);

  useEffect(() => {
    if (!planId) { setRecipes([]); return; }
    let cancelled = false;
    setIsPrepLoading(true);
    fetch(`/api/production-plans/${planId}/prep-requirements-by-recipe?station=${station}`, { credentials: "include" })
      .then(r => r.json())
      .then((json: { recipes?: PrepRecipeDetail[] }) => {
        if (!cancelled) { setRecipes(json.recipes ?? []); setIsPrepLoading(false); }
      })
      .catch(() => { if (!cancelled) setIsPrepLoading(false); });
    return () => { cancelled = true; };
  }, [planId, station]);

  return {
    recipes,
    isLoading: isPlanLoading || (!!planId && isPrepLoading),
    nextPlan,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared: mode toggle bar
// ──────────────────────────────────────────────────────────────────────────────
function PrepModeToggle({
  mode,
  onToggle,
  label,
  icon: Icon,
  iconColor,
}: {
  mode: "fullscreen" | "overview";
  onToggle: () => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className={cn("w-5 h-5", iconColor)} />
        <h2 className="font-semibold">{label} — {mode === "fullscreen" ? "Full-screen" : "Overview"}</h2>
      </div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
      >
        {mode === "fullscreen" ? (
          <><List className="w-4 h-4" />Overview</>
        ) : (
          <><LayoutGrid className="w-4 h-4" />Full-screen</>
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Veg Prep Station
// Per-recipe grouping of vegetable ingredients with prep quantities
// ──────────────────────────────────────────────────────────────────────────────
function PrepVegStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_veg");

  // Build full-screen items: recipe header → each veg ingredient for that recipe
  const fullScreenItems: PrepFullScreenItem[] = recipes.flatMap(recipe =>
    recipe.ingredients.map(ing => {
      const hasProcLoss = ing.processingRatio != null && ing.processingRatio < 1;
      return {
        id: `${recipe.recipeId}-${ing.ingredientId}`,
        name: ing.ingredientName,
        quantity: fmtQty(ing.rawQty, ing.unit),
        subDetail: [
          `Recipe: ${recipe.recipeName} (${recipe.batchesTarget} batch${recipe.batchesTarget !== 1 ? "es" : ""})`,
          hasProcLoss ? `Yield: ${((ing.processingRatio ?? 1) * 100).toFixed(0)}%` : null,
        ].filter(Boolean).join(" · ") || undefined,
        sopUrl: recipe.sopUrl,
      };
    })
  );

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
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
      <PrepModeToggle mode={mode} onToggle={() => setMode("fullscreen")} label="Veg Prep" icon={Salad} iconColor="text-green-500" />

      {recipes.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No vegetable ingredients to prep</p>
          <p className="text-sm mt-1">Make sure ingredient categories are set to "vegetable" in the ingredients library</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recipes.map(recipe => (
            <div key={recipe.recipeId} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-green-50 dark:bg-green-900/20 border-b border-border">
                <p className="font-semibold text-sm text-green-800 dark:text-green-200">{recipe.recipeName}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-700 dark:text-green-300">{recipe.batchesTarget} batch{recipe.batchesTarget !== 1 ? "es" : ""}</span>
                  {recipe.sopUrl && (
                    <a href={recipe.sopUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      SOP <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {recipe.ingredients.map(ing => {
                    const hasProcLoss = ing.processingRatio != null && ing.processingRatio < 1;
                    return (
                      <tr key={ing.ingredientId} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 px-4 font-medium">{ing.ingredientName}</td>
                        <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{fmtQty(ing.cookedQty, ing.unit)}</td>
                        <td className={cn("py-2.5 px-4 text-right tabular-nums font-semibold", hasProcLoss ? "text-amber-600 dark:text-amber-400" : "")}>
                          {fmtQty(ing.rawQty, ing.unit)}
                          {hasProcLoss && <span className="text-xs font-normal text-muted-foreground ml-1">({(((ing.processingRatio ?? 1) * 100).toFixed(0))}%)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="prep_veg" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bases & Mozzarella Prep Station
// Per-recipe base/sauce/cheese ingredients with tin split
// ──────────────────────────────────────────────────────────────────────────────
function PrepBasesStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_bases");

  // Build full-screen items — per recipe → ingredients + tin badge per recipe
  const fullScreenItems: PrepFullScreenItem[] = recipes.flatMap(recipe => {
    const items: PrepFullScreenItem[] = [];
    // Recipe header card: show tin count as first item if applicable
    if (recipe.tinCount != null) {
      items.push({
        id: `${recipe.recipeId}-tins`,
        name: `${recipe.recipeName} — Tins`,
        quantity: `${recipe.tinCount} tin${recipe.tinCount !== 1 ? "s" : ""}`,
        subDetail: [
          recipe.tinSize ? recipe.tinSize : null,
          recipe.maxBatchesPerTin ? `${recipe.maxBatchesPerTin} batches/tin` : null,
          `${recipe.batchesTarget} batches total`,
        ].filter(Boolean).join(" · ") || undefined,
        badge: { label: "Tins needed", value: recipe.tinCount, color: "green" },
        sopUrl: recipe.sopUrl,
      });
    }
    // Then each ingredient
    recipe.ingredients.forEach(ing => {
      items.push({
        id: `${recipe.recipeId}-${ing.ingredientId}`,
        name: ing.ingredientName,
        quantity: fmtQty(ing.cookedQty, ing.unit),
        subDetail: `Recipe: ${recipe.recipeName} (${recipe.batchesTarget} batch${recipe.batchesTarget !== 1 ? "es" : ""})`,
        sopUrl: recipe.sopUrl,
      });
    });
    return items;
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
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
      <PrepModeToggle mode={mode} onToggle={() => setMode("fullscreen")} label="Bases & Mozzarella" icon={Layers} iconColor="text-yellow-500" />

      {recipes.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No base/sauce/cheese ingredients to prep</p>
          <p className="text-sm mt-1">Assign ingredient categories: "base", "sauce", or "cheese"</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recipes.map(recipe => (
            <div key={recipe.recipeId} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-yellow-50 dark:bg-yellow-900/20 border-b border-border">
                <div>
                  <p className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">{recipe.recipeName}</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">
                    {recipe.batchesTarget} batch{recipe.batchesTarget !== 1 ? "es" : ""}
                    {recipe.tinSize ? ` · ${recipe.tinSize}` : ""}
                    {recipe.maxBatchesPerTin ? ` · ${recipe.maxBatchesPerTin}/tin` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {recipe.tinCount != null && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Tins</p>
                      <p className="text-3xl font-bold text-green-600 dark:text-green-400 tabular-nums">{recipe.tinCount}</p>
                    </div>
                  )}
                  {recipe.sopUrl && (
                    <a href={recipe.sopUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      SOP <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {recipe.ingredients.map(ing => (
                    <tr key={ing.ingredientId} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 px-4 font-medium">{ing.ingredientName}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold">{fmtQty(ing.cookedQty, ing.unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="prep_bases" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// Per-recipe: combined tray count (raw_meat + seasoning), per-tray breakdown
// ──────────────────────────────────────────────────────────────────────────────
function PrepMeatStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_meat");

  const totalTrays = recipes.reduce((sum, r) => sum + (r.trayCount ?? 0), 0);

  // Build full-screen items — one card per recipe showing combined tray count
  const fullScreenItems: PrepFullScreenItem[] = recipes.flatMap(recipe => {
    const rawMeat = recipe.ingredients.filter(i => i.isRawMeat);
    const seasoning = recipe.ingredients.filter(i => i.isSeasoning);
    const totalRawMeatKg = rawMeat.reduce((sum, i) => sum + i.rawQty, 0) / 1000;
    const totalSeasoningKg = seasoning.reduce((sum, i) => sum + i.rawQty, 0) / 1000;
    const trayCapacityKg = rawMeat.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;
    const trays = recipe.trayCount;
    const perTrayMeatKg = trays && trays > 0 ? (totalRawMeatKg / trays).toFixed(2) : null;
    const perTraySeasoningKg = trays && trays > 0 && totalSeasoningKg > 0 ? (totalSeasoningKg / trays).toFixed(2) : null;

    return [{
      id: `${recipe.recipeId}`,
      name: recipe.recipeName,
      quantity: trays != null ? `${trays} tray${trays !== 1 ? "s" : ""}` : `${totalRawMeatKg.toFixed(2)} kg`,
      subDetail: [
        `${totalRawMeatKg.toFixed(2)} kg raw meat`,
        totalSeasoningKg > 0 ? `${totalSeasoningKg.toFixed(2)} kg seasoning` : null,
        trayCapacityKg ? `${trayCapacityKg} kg/tray capacity` : null,
        perTrayMeatKg ? `${perTrayMeatKg} kg meat/tray` : null,
        perTraySeasoningKg ? `+ ${perTraySeasoningKg} kg seasoning/tray` : null,
      ].filter(Boolean).join(" · ") || undefined,
      badge: trays != null ? { label: "Trays needed", value: trays, color: "rose" as const } : undefined,
      sopUrl: recipe.sopUrl,
    }];
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
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

      {recipes.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No raw meat ingredients to prep</p>
          <p className="text-sm mt-1">Set ingredient category to "raw_meat" in the ingredients library</p>
        </div>
      ) : (
        <div className="space-y-4">
          {recipes.map(recipe => {
            const rawMeat = recipe.ingredients.filter(i => i.isRawMeat);
            const seasoning = recipe.ingredients.filter(i => i.isSeasoning);
            const totalRawMeatKg = rawMeat.reduce((sum, i) => sum + i.rawQty, 0) / 1000;
            const totalSeasoningKg = seasoning.reduce((sum, i) => sum + i.rawQty, 0) / 1000;
            const trays = recipe.trayCount;
            const trayCapKg = rawMeat.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;

            return (
              <div key={recipe.recipeId} className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Recipe header */}
                <div className="flex items-center justify-between px-4 py-3 bg-rose-50 dark:bg-rose-900/20 border-b border-border">
                  <div>
                    <p className="font-bold text-rose-800 dark:text-rose-200">{recipe.recipeName}</p>
                    <p className="text-xs text-rose-700 dark:text-rose-300">{recipe.batchesTarget} batch{recipe.batchesTarget !== 1 ? "es" : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {trays != null && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Trays</p>
                        <p className="text-4xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{trays}</p>
                        {trayCapKg && <p className="text-xs text-muted-foreground">{trayCapKg} kg each</p>}
                      </div>
                    )}
                    {recipe.sopUrl && (
                      <a href={recipe.sopUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        SOP <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Ingredients breakdown */}
                <div className="px-4 py-3 space-y-2">
                  {/* Raw meat */}
                  {rawMeat.map(ing => (
                    <div key={ing.ingredientId} className="flex justify-between items-center text-sm">
                      <span className="font-medium">{ing.ingredientName}</span>
                      <div className="text-right">
                        <span className="tabular-nums font-semibold">{fmtQty(ing.rawQty, ing.unit)}</span>
                        {trays && trays > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({((ing.rawQty / 1000) / trays).toFixed(2)} kg/tray)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Seasonings */}
                  {seasoning.length > 0 && (
                    <>
                      <div className="border-t border-border/50 pt-2 mt-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Seasoning</p>
                        {seasoning.map(ing => (
                          <div key={ing.ingredientId} className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">{ing.ingredientName}</span>
                            <div className="text-right">
                              <span className="tabular-nums">{fmtQty(ing.rawQty, ing.unit)}</span>
                              {trays && trays > 0 && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({((ing.rawQty / 1000) / trays).toFixed(3)} kg/tray)
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Combined totals */}
                  <div className="border-t border-border pt-2 flex justify-between text-sm font-semibold">
                    <span>Total combined</span>
                    <span className="tabular-nums">{(totalRawMeatKg + totalSeasoningKg).toFixed(2)} kg</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="prep_meat" />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Dough Prep Station
// ──────────────────────────────────────────────────────────────────────────────
interface DoughPrepData {
  totalDoughKg: number;
  mixerCapacityKg: number;
  mixCount: number;
  kgPerMix: number;
  ingredients: Array<{
    ingredientId: number | null;
    ingredientName: string;
    unit: string;
    totalQty: number;
    qtyPerMix: number;
  }>;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    ballCount: number;
    orderPosition: number;
    doughBatchesNeeded: number;
    doughKgTotal: number;
    ballWeightG: number;
    doughSubRecipeName: string;
  }>;
  nextPlan: { id: number; planDate: string; name: string } | null;
}

function useDoughPrepData(planId: number, mode?: "current") {
  const [data, setData] = useState<DoughPrepData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const url = mode
      ? `/api/production-plans/${planId}/dough-prep?mode=${mode}`
      : `/api/production-plans/${planId}/dough-prep`;
    fetch(url, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [planId, mode]);

  return { data, loading, error };
}

function DoughPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { data: doughData, loading: doughLoading } = useDoughPrepData(plan.id);
  const [activeMix, setActiveMix] = useState<number>(1);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalComplete = items.reduce((s, it) => s + getStationCount(it, "dough_prep"), 0);
  const overallPct = totalBatchesTarget > 0 ? Math.round((totalComplete / totalBatchesTarget) * 100) : 0;

  const addBatch = (item: ProductionPlanItem) => {
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "dough_prep", completedAt: new Date().toISOString() } });
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

  const mixCount = doughData?.mixCount ?? 0;

  return (
    <div className="space-y-4">
      {/* D-1 banner — show which production day this dough is for */}
      {doughData && (
        <PrepDateBanner
          planDate={doughData.nextPlan?.planDate ?? null}
          planName={doughData.nextPlan?.name ?? null}
          isLoading={doughLoading}
          labelPrefix="Dough for"
        />
      )}

      {/* Summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="font-semibold text-base">Dough Prep</h2>
              <p className="text-xs text-muted-foreground">
                {totalComplete} of {totalBatchesTarget} recipe batches mixed
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

      {/* Dough requirements */}
      {doughLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading dough data…
        </div>
      ) : doughData && doughData.totalDoughKg > 0 ? (
        <>
          {/* Totals banner */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Droplets className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2">Total Dough Required</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-xs text-amber-700 dark:text-amber-300">Total Dough</p>
                    <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{doughData.totalDoughKg.toFixed(1)} kg</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-amber-700 dark:text-amber-300">Mixer Capacity</p>
                    <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{doughData.mixerCapacityKg} kg</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-amber-700 dark:text-amber-300">No. of Mixes</p>
                    <p className="text-xl font-bold text-amber-800 dark:text-amber-200">{doughData.mixCount}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Per-recipe ball weights */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-sm">Dough Ball Weights</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 px-4 text-left font-medium">Recipe</th>
                  <th className="py-2 px-4 text-center font-medium">Batches</th>
                  <th className="py-2 px-4 text-center font-medium">Ball Weight</th>
                </tr>
              </thead>
              <tbody>
                {doughData.recipes.map(r => (
                  <tr key={r.recipeId} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 px-4 font-medium">{r.recipeName}</td>
                    <td className="py-2.5 px-4 text-center">{r.batchesTarget}</td>
                    <td className="py-2.5 px-4 text-center font-semibold text-amber-700 dark:text-amber-400">
                      {r.ballWeightG}g
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mixing schedule */}
          {mixCount > 0 && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-sm">Mixing Schedule — {doughData.kgPerMix.toFixed(1)} kg per mix</h3>
                {mixCount > 1 && (
                  <div className="flex items-center gap-1">
                    {Array.from({ length: mixCount }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveMix(i + 1)}
                        className={cn(
                          "w-7 h-7 rounded-full text-xs font-semibold transition-colors",
                          activeMix === i + 1
                            ? "bg-amber-500 text-white"
                            : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                        )}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="text-xs text-muted-foreground mb-3">
                  Mix {activeMix} of {mixCount} ({doughData.kgPerMix.toFixed(1)} kg)
                </p>
                <div className="space-y-2">
                  {doughData.ingredients.map(ing => (
                    <div key={ing.ingredientId ?? ing.ingredientName} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
                      <span className="text-sm font-medium">{ing.ingredientName}</span>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <span className="text-base font-bold tabular-nums">
                            {ing.unit === "g"
                              ? `${(ing.qtyPerMix).toFixed(0)}g`
                              : `${ing.qtyPerMix.toFixed(2)} ${ing.unit}`}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground w-20 text-right">
                          Total: {ing.unit === "g"
                            ? `${ing.totalQty.toFixed(0)}g`
                            : `${ing.totalQty.toFixed(2)} ${ing.unit}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Per-recipe batch counters */}
      <div className="space-y-2">
        {items.map(item => {
          const dpCount = getStationCount(item, "dough_prep");
          const isComplete = dpCount >= (item.batchesTarget ?? 0);
          const prog = (item.batchesTarget ?? 0) > 0
            ? Math.round((dpCount / (item.batchesTarget ?? 0)) * 100)
            : 0;
          const recipeInfo = doughData?.recipes.find(r => r.recipeId === item.recipeId);
          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                isComplete
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : dpCount > 0
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
                  {recipeInfo && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-1">
                      {recipeInfo.ballWeightG}g balls · {recipeInfo.portionsPerBatch} per batch
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", isComplete ? "bg-emerald-500" : "bg-amber-500")}
                        style={{ width: `${Math.min(prog, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {dpCount} / {item.batchesTarget ?? 0} batches
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => removeBatch(item)}
                    disabled={dpCount === 0}
                    className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <div className="w-10 text-center">
                    <span className="text-xl font-bold">{dpCount}</span>
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
  // mode="current" bypasses D-1 next-plan lookup — sheeting always uses today's plan ball weights
  const { data: doughData } = useDoughPrepData(plan.id, "current");
  const [sheetedItems, setSheetedItems] = useState<Set<number>>(new Set());

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => it.status === "in-progress") ?? items.find(it => it.status === "pending");

  const toggleSheeted = (itemId: number) => {
    setSheetedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

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
            {doughData?.recipes.find(r => r.recipeId === currentItem.recipeId)?.ballWeightG && (
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-2.5 text-center min-w-[80px]">
                <p className="text-xs text-muted-foreground">Ball Weight</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {doughData?.recipes.find(r => r.recipeId === currentItem.recipeId)?.ballWeightG}g
                </p>
              </div>
            )}
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
              <th className="py-2.5 px-4 text-center font-medium">Balls</th>
              <th className="py-2.5 px-4 text-center font-medium">Ball Weight</th>
              <th className="py-2.5 px-4 text-center font-medium">Tin</th>
              <th className="py-2.5 px-4 text-center font-medium">Tins</th>
              <th className="py-2.5 px-4 text-center font-medium">Ready</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const tins = item.maxBatchesPerTin && (item.batchesTarget ?? 0) > 0
                ? Math.ceil((item.batchesTarget ?? 0) / item.maxBatchesPerTin)
                : null;
              const isCurrent = item.id === currentItem?.id;
              const isReady = sheetedItems.has(item.id);
              const ballWeight = doughData?.recipes.find(r => r.recipeId === item.recipeId)?.ballWeightG;
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-b border-border/50 last:border-0",
                    isReady ? "bg-emerald-50/40 dark:bg-emerald-900/10" :
                    isCurrent ? "bg-amber-50/60 dark:bg-amber-900/10" : ""
                  )}
                >
                  <td className="py-2.5 px-4 text-muted-foreground">{item.orderPosition}</td>
                  <td className={cn("py-2.5 px-4 font-medium", isReady ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                    {isCurrent && !isReady && <span className="ml-2 text-xs text-amber-600 font-normal">← current</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">{item.batchesTarget ?? 0}</td>
                  <td className="py-2.5 px-4 text-center font-semibold">
                    {(item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10)}
                  </td>
                  <td className="py-2.5 px-4 text-center font-semibold text-amber-700 dark:text-amber-400">
                    {ballWeight ? `${ballWeight}g` : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center text-muted-foreground">{item.tinSize ?? "—"}</td>
                  <td className="py-2.5 px-4 text-center font-semibold">
                    {tins != null ? tins : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <button
                      onClick={() => toggleSheeted(item.id)}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center mx-auto transition-colors",
                        isReady
                          ? "bg-emerald-500 text-white"
                          : "bg-secondary border border-border text-muted-foreground hover:bg-secondary/80"
                      )}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
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
  const [wonlyLoading, setWonlyLoading] = useState<number | null>(null);

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => {
    const ovenCount = getStationCount(it, "ovens");
    return ovenCount < (it.batchesTarget ?? 0);
  });

  const addBatch = (item: ProductionPlanItem) => {
    const avail = getAvailableFromPrev(item, "ovens");
    if (avail <= 0) {
      toast({ title: "Waiting for Building", description: "Building station must complete more batches first.", variant: "destructive" });
      return;
    }
    createBatch.mutate({ id: plan.id, data: { planItemId: item.id, stationType: "ovens", completedAt: new Date().toISOString() } });
  };

  const removeBatch = async (item: ProductionPlanItem) => {
    if (getStationCount(item, "ovens") === 0) return;
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

  const addWonly = async (item: ProductionPlanItem) => {
    setWonlyLoading(item.id);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({ title: "Wonky recorded", description: `Quality reject logged for ${item.recipeName ?? "recipe"}.` });
    } catch (err) {
      toast({ title: "Wonky failed", description: err instanceof Error ? err.message : "Could not record wonky.", variant: "destructive" });
    } finally {
      setWonlyLoading(null);
    }
  };

  const undoWonly = async (item: ProductionPlanItem) => {
    if ((item.wonlyCount ?? 0) === 0) return;
    setWonlyLoading(item.id);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wonly`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Undo failed", description: err instanceof Error ? err.message : "Could not undo wonky.", variant: "destructive" });
    } finally {
      setWonlyLoading(null);
    }
  };

  const totalOvenComplete = items.reduce((s, it) => s + getStationCount(it, "ovens"), 0);
  const totalTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalOvenComplete / totalTarget) * 100) : 0;

  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const netPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - (item.wonlyCount ?? 0));
  const chillerTrays = (item: ProductionPlanItem) =>
    Math.ceil(netPacks(item) / 10);

  const sessionGrossPacks = items.reduce((s, it) => s + grossPacks(it), 0);
  const sessionWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const sessionNetPacks = items.reduce((s, it) => s + netPacks(it), 0);

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
          {getAvailableFromPrev(currentItem, "ovens") <= 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg mb-3">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">Waiting for Building to complete more batches</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="bg-secondary/50 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-xs text-muted-foreground">Oven Loads</p>
              <p className="text-3xl font-bold">{getStationCount(currentItem, "ovens")}</p>
            </div>
            <div className="bg-secondary/50 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-xs text-muted-foreground">Target</p>
              <p className="text-3xl font-bold">{currentItem.batchesTarget ?? 0}</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-xs text-blue-600 dark:text-blue-400">Built</p>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{getPrevStationCount(currentItem, "ovens")}</p>
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-xs text-muted-foreground">Net Packs</p>
              <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{netPacks(currentItem)}</p>
            </div>
            <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-lg px-4 py-2 text-center min-w-[80px]">
              <p className="text-xs text-muted-foreground">Chiller Trays</p>
              <p className="text-3xl font-bold text-cyan-600 dark:text-cyan-400">{chillerTrays(currentItem)}</p>
            </div>
            {(currentItem.wonlyCount ?? 0) > 0 && (
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg px-4 py-2 text-center min-w-[80px]">
                <p className="text-xs text-muted-foreground">Wonky</p>
                <p className="text-3xl font-bold text-red-600 dark:text-red-400">{currentItem.wonlyCount ?? 0}</p>
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-4 mb-4">
            <button
              onClick={() => removeBatch(currentItem)}
              disabled={getStationCount(currentItem, "ovens") === 0}
              className="w-12 h-12 flex items-center justify-center rounded-full border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
            >
              <Minus className="w-5 h-5" />
            </button>
            <div className="text-5xl font-bold font-display tabular-nums w-20 text-center">
              {getStationCount(currentItem, "ovens")}
            </div>
            <button
              onClick={() => addBatch(currentItem)}
              disabled={(getStationCount(currentItem, "ovens") >= (currentItem.batchesTarget ?? 0) && !isAdmin) || getAvailableFromPrev(currentItem, "ovens") <= 0}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          {/* Wonly section */}
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">QUALITY REJECTS (Wonky)</p>
                <p className="text-xs text-muted-foreground">Substandard packs not counted in output</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => undoWonly(currentItem)}
                  disabled={(currentItem.wonlyCount ?? 0) === 0 || wonlyLoading === currentItem.id}
                  className="w-8 h-8 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-xl font-bold tabular-nums w-8 text-center text-red-600 dark:text-red-400">
                  {wonlyLoading === currentItem.id ? "…" : (currentItem.wonlyCount ?? 0)}
                </span>
                <button
                  onClick={() => addWonly(currentItem)}
                  disabled={wonlyLoading === currentItem.id}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">All ovens done!</h2>
          <p className="text-muted-foreground text-sm">All recipes through the ovens for today.</p>
        </div>
      )}

      {/* Session totals */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Gross Packs</p>
          <p className="text-2xl font-bold tabular-nums">{sessionGrossPacks}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
          <p className="text-xs text-red-700 dark:text-red-300 mb-1">Total Wonky</p>
          <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{sessionWonly}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-1">Net Packs</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sessionNetPacks}</p>
        </div>
      </div>

      {/* Overall progress + breaks */}
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

      {/* Per-recipe summary table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Oven Queue</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
              <th className="py-2 px-3 text-left font-medium">Recipe</th>
              <th className="py-2 px-3 text-center font-medium">Done</th>
              <th className="py-2 px-3 text-center font-medium">Packs</th>
              <th className="py-2 px-3 text-center font-medium">Wonky</th>
              <th className="py-2 px-3 text-center font-medium">Net</th>
              <th className="py-2 px-3 text-center font-medium">
                <Snowflake className="w-3.5 h-3.5 inline text-cyan-500" />
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const isCurrentRow = item.id === currentItem?.id;
              const gPacks = grossPacks(item);
              const nPacks = netPacks(item);
              const trays = chillerTrays(item);
              const wonlys = item.wonlyCount ?? 0;
              return (
                <tr key={item.id} className={cn(
                  "border-b border-border/50 last:border-0",
                  isCurrentRow ? "bg-red-50/40 dark:bg-red-900/10" :
                  item.status === "complete" ? "bg-emerald-50/30 dark:bg-emerald-900/10" : ""
                )}>
                  <td className={cn("py-2 px-3 font-medium text-xs", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    {item.recipeName ?? `Recipe #${item.recipeId}`}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs">{getStationCount(item, "ovens")}</td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs">{gPacks}</td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs">
                    <div className="flex items-center justify-center gap-1">
                      <span className={cn(wonlys > 0 ? "text-red-600 dark:text-red-400 font-semibold" : "text-muted-foreground")}>
                        {wonlys}
                      </span>
                      {isCurrentRow && (
                        <button
                          onClick={() => addWonly(item)}
                          disabled={wonlyLoading === item.id}
                          className="w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center ml-0.5"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs font-semibold text-indigo-600 dark:text-indigo-400">{nPacks}</td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs font-semibold text-cyan-600 dark:text-cyan-400">{trays > 0 ? trays : "—"}</td>
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
// Per-recipe pack count display (read from oven completions) + wrapping-complete toggle
// ──────────────────────────────────────────────────────────────────────────────
function WrappingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const [wrappingLoading, setWrappingLoading] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState<number | null>(null);
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [activeStorage, setActiveStorage] = useState<string>("fridge");

  const STACK_SIZE = 24;

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const netPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - (item.wonlyCount ?? 0));

  const totalGross = items.reduce((s, it) => s + grossPacks(it), 0);
  const totalWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const totalNet = items.reduce((s, it) => s + netPacks(it), 0);
  const totalFridge = items.reduce((s, it) => s + ((it as any).fridgeQty ?? 0), 0);
  const wrappedCount = items.filter(it => it.wrappingComplete).length;
  const allWrapped = items.length > 0 && items.every(it => it.wrappingComplete);

  const toggleWrapping = async (item: ProductionPlanItem) => {
    const newValue = !item.wrappingComplete;
    setWrappingLoading(item.id);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/wrapping-complete`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete: newValue }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not update wrapping status.", variant: "destructive" });
    } finally {
      setWrappingLoading(null);
    }
  };

  const STORAGE_LOCATIONS = [
    { key: "fridge", label: "Production Fridge", endpoint: "fridge", color: "blue" },
    { key: "freezer", label: "Product Freezer", endpoint: "freezer", color: "cyan" },
  ] as const;

  const getStorageQty = (item: ProductionPlanItem, key: string): number => {
    if (key === "fridge") return (item as any).fridgeQty ?? 0;
    if (key === "freezer") return (item as any).freezerQty ?? 0;
    return 0;
  };

  const addToStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      setCustomAmounts(prev => ({ ...prev, [item.id]: "" }));
      setShowCustom(prev => ({ ...prev, [item.id]: false }));
      toast({ title: `+${qty} packs → ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : `Could not add to ${loc.label}.`, variant: "destructive" });
    } finally {
      setStorageLoading(null);
    }
  };

  const undoStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (qty < 1) return;
    const loc = STORAGE_LOCATIONS.find(l => l.key === storageKey);
    if (!loc) return;
    setStorageLoading(item.id);
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/items/${item.id}/${loc.endpoint}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      toast({ title: `−${qty} packs from ${loc.label}`, description: `${item.recipeName ?? "Recipe"}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : `Could not undo from ${loc.label}.`, variant: "destructive" });
    } finally {
      setStorageLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Session summary */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <Gift className="w-6 h-6 text-purple-500" />
          <div>
            <h2 className="font-semibold text-base">Wrapping Station</h2>
            <p className="text-xs text-muted-foreground">
              {wrappedCount} of {items.length} recipes wrapped · {totalNet} net packs
            </p>
          </div>
          {allWrapped && (
            <div className="ml-auto flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">All wrapped!</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="text-center bg-secondary/30 rounded-lg py-2">
            <p className="text-xs text-muted-foreground">Gross Packs</p>
            <p className="text-lg font-bold tabular-nums">{totalGross}</p>
          </div>
          <div className="text-center bg-red-50 dark:bg-red-950/20 rounded-lg py-2">
            <p className="text-xs text-red-600 dark:text-red-400">Wonky</p>
            <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">{totalWonly}</p>
          </div>
          <div className="text-center bg-purple-50 dark:bg-purple-950/20 rounded-lg py-2">
            <p className="text-xs text-purple-700 dark:text-purple-300">Net Packs</p>
            <p className="text-lg font-bold tabular-nums text-purple-700 dark:text-purple-300">{totalNet}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center bg-blue-50 dark:bg-blue-950/20 rounded-lg py-2">
            <p className="text-xs text-blue-700 dark:text-blue-300">Prod Fridge</p>
            <p className="text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">{totalFridge}</p>
          </div>
          <div className="text-center bg-cyan-50 dark:bg-cyan-950/20 rounded-lg py-2">
            <p className="text-xs text-cyan-700 dark:text-cyan-300">Freezer</p>
            <p className="text-lg font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{items.reduce((s, it) => s + ((it as any).freezerQty ?? 0), 0)}</p>
          </div>
        </div>
        <div className="pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="wrapping" />
        </div>
      </div>

      {/* Per-recipe wrapping cards */}
      <div className="space-y-2">
        {items.map(item => {
          const gross = grossPacks(item);
          const wonlys = item.wonlyCount ?? 0;
          const net = netPacks(item);
          const fridge = (item as any).fridgeQty ?? 0;
          const freezer = (item as any).freezerQty ?? 0;
          const totalStored = fridge + freezer;
          const remaining = net - totalStored;
          const isWrapped = item.wrappingComplete;
          const isLoading = wrappingLoading === item.id;
          const isStorageLoading = storageLoading === item.id;
          const isCustomOpen = showCustom[item.id] ?? false;
          const customVal = customAmounts[item.id] ?? "";
          const customNum = parseInt(customVal, 10);
          return (
            <div
              key={item.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                isWrapped
                  ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-900/10"
                  : gross > 0
                    ? "border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-900/10"
                    : "border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <h3 className={cn("font-semibold", isWrapped ? "line-through text-muted-foreground" : "")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </h3>
                    {isWrapped && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="text-center">
                      <span className="text-xs text-muted-foreground block">Gross</span>
                      <span className="font-semibold tabular-nums">{gross}</span>
                    </div>
                    {wonlys > 0 && (
                      <div className="text-center">
                        <span className="text-xs text-red-500 block">Wonky</span>
                        <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">−{wonlys}</span>
                      </div>
                    )}
                    <div className="text-center">
                      <span className="text-xs text-purple-600 dark:text-purple-400 block">Net</span>
                      <span className="text-xl font-bold tabular-nums text-purple-700 dark:text-purple-300">{net}</span>
                    </div>
                    <div className="text-center border-l border-border/50 pl-3">
                      <span className="text-xs text-blue-600 dark:text-blue-400 block">Stored</span>
                      <span className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{totalStored}</span>
                    </div>
                    {remaining > 0 && (
                      <div className="text-center">
                        <span className="text-xs text-amber-600 dark:text-amber-400 block">Left</span>
                        <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{remaining}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getStationCount(item, "ovens")} / {item.batchesTarget ?? 0} oven loads
                    {totalStored > 0 && ` · ${fridge} fridge · ${freezer} freezer`}
                  </p>
                </div>
                <button
                  onClick={() => toggleWrapping(item)}
                  disabled={isLoading}
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
                    isWrapped
                      ? "bg-emerald-500 text-white shadow-md"
                      : "bg-secondary border-2 border-purple-300 dark:border-purple-700 text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20"
                  )}
                  title={isWrapped ? "Mark as not wrapped" : "Mark wrapping complete"}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                </button>
              </div>

              {/* Storage controls — tabbed for Production Fridge / Product Freezer */}
              <div className="mt-3 pt-3 border-t border-border/40">
                <div className="flex gap-1 mb-2">
                  {STORAGE_LOCATIONS.map(loc => {
                    const qty = getStorageQty(item, loc.key);
                    const colorMap: Record<string, string> = {
                      blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700",
                      cyan: "bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-700",
                      teal: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700",
                    };
                    const inactiveColor = "bg-secondary/30 text-muted-foreground border-border";
                    const isActive = activeStorage === loc.key;
                    return (
                      <button
                        key={loc.key}
                        onClick={() => setActiveStorage(loc.key)}
                        className={cn(
                          "flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                          isActive ? colorMap[loc.color] : inactiveColor
                        )}
                      >
                        {loc.label} {qty > 0 && <span className="font-bold ml-0.5">({qty})</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => addToStorage(item, STACK_SIZE, activeStorage)}
                    disabled={isStorageLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add {STACK_SIZE}
                  </button>

                  {!isCustomOpen ? (
                    <button
                      onClick={() => setShowCustom(prev => ({ ...prev, [item.id]: true }))}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary/50 transition-colors"
                    >
                      Custom
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={customVal}
                        onChange={e => setCustomAmounts(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === "Enter" && customNum > 0) addToStorage(item, customNum, activeStorage); }}
                        className="w-20 h-9 rounded-lg border border-border bg-background px-2 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                      <button
                        onClick={() => { if (customNum > 0) addToStorage(item, customNum, activeStorage); }}
                        disabled={isStorageLoading || !(customNum > 0)}
                        className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => { setShowCustom(prev => ({ ...prev, [item.id]: false })); setCustomAmounts(prev => ({ ...prev, [item.id]: "" })); }}
                        className="px-2 py-2 rounded-lg text-muted-foreground hover:bg-secondary/50 text-sm transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {getStorageQty(item, activeStorage) > 0 && (
                    <button
                      onClick={() => undoStorage(item, STACK_SIZE, activeStorage)}
                      disabled={isStorageLoading}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      Undo {STACK_SIZE}
                    </button>
                  )}
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
interface PackingData {
  items: Array<{
    id: number;
    recipeId: number | null;
    recipeName: string;
    batchesTarget: number;
    batchesComplete: number;
    wonlyCount: number;
    grossPacks: number;
    netPacks: number;
    wrappingComplete: boolean;
    status: string;
    orderPosition: number;
    dispatches: Array<{ id: number; quantity: number; customer: string | null; status: string | null; notes: string | null }>;
    totalDispatch: number;
  }>;
  totalNetPacks: number;
  totalGrossPacks: number;
  totalWonly: number;
}

function usePackingData(planId: number, planStatus: string) {
  const [data, setData] = useState<PackingData | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    fetch(`/api/production-plans/${planId}/packing`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [planId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, refetch };
}

function PackingStation({ plan }: { plan: ProductionPlanDetail }) {
  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const { data: packData, loading: packLoading } = usePackingData(plan.id, plan.status);
  // Track packed state at DISPATCH level (dispatch id → boolean) and recipe level (item id → boolean)
  const [packedItems, setPackedItems] = useState<Set<number>>(new Set());
  const [packedDispatches, setPackedDispatches] = useState<Set<number>>(new Set());

  const totalCompleteItems = items.filter(it => it.status === "complete").length;
  const allDone = items.length > 0 && items.every(it => it.status === "complete");

  const togglePacked = (itemId: number) => {
    setPackedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleDispatchPacked = (dispatchId: number) => {
    setPackedDispatches(prev => {
      const next = new Set(prev);
      if (next.has(dispatchId)) next.delete(dispatchId);
      else next.add(dispatchId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Box className="w-6 h-6 text-indigo-500" />
            <div>
              <h2 className="font-semibold text-base">Packing Station</h2>
              <p className="text-xs text-muted-foreground">
                Final pack counts for {format(parseISO(plan.planDate), "EEEE d MMMM")}
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
        {/* Session totals — only wrapping-complete items */}
        {packData && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">Wrapped &amp; ready to pack</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Gross Packs</p>
                <p className="text-lg font-bold tabular-nums">{packData.totalGrossPacks}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-red-600 dark:text-red-400">Wonky</p>
                <p className="text-lg font-bold tabular-nums text-red-600 dark:text-red-400">{packData.totalWonly}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">Net Packs</p>
                <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{packData.totalNetPacks}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Per-recipe pack cards with dispatch cross-reference */}
      {packLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading pack data…
        </div>
      ) : packData ? (
        <div className="space-y-3">
          {packData.items.map(packItem => {
            const isPacked = packedItems.has(packItem.id);
            const isWrapped = packItem.wrappingComplete;
            const gap = packItem.netPacks - packItem.totalDispatch;
            const hasDispatches = packItem.dispatches.length > 0;
            return (
              <div
                key={packItem.id}
                className={cn(
                  "bg-card border rounded-xl overflow-hidden transition-all",
                  isPacked
                    ? "border-emerald-300 dark:border-emerald-700"
                    : isWrapped
                      ? "border-indigo-300 dark:border-indigo-700"
                      : "border-border/60 opacity-70"
                )}
              >
                {/* Recipe header */}
                <div className={cn(
                  "flex items-center justify-between px-4 py-3",
                  isPacked ? "bg-emerald-50/50 dark:bg-emerald-900/10" : isWrapped ? "bg-indigo-50/30 dark:bg-indigo-900/10" : ""
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={cn("font-semibold", isPacked ? "line-through text-muted-foreground" : "")}>
                        {packItem.recipeName}
                      </h3>
                      {isPacked && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                      {isWrapped && !isPacked && (
                        <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 rounded px-1.5 py-0.5">
                          Wrapped ✓
                        </span>
                      )}
                      {!isWrapped && (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded px-1.5 py-0.5">
                          Awaiting wrap
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{packItem.batchesComplete} batches</span>
                      {packItem.wonlyCount > 0 && (
                        <span className="text-red-600 dark:text-red-400">−{packItem.wonlyCount} wonky</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Net Packs</p>
                      <p className={cn(
                        "text-2xl font-bold tabular-nums",
                        isWrapped ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground"
                      )}>
                        {packItem.netPacks}
                      </p>
                    </div>
                    {isWrapped && (
                      <button
                        onClick={() => togglePacked(packItem.id)}
                        className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0",
                          isPacked
                            ? "bg-emerald-500 text-white"
                            : "bg-secondary border border-border text-muted-foreground hover:bg-secondary/80"
                        )}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Dispatch cross-reference with per-dispatch packed checkboxes */}
                {hasDispatches && (
                  <div className="border-t border-border/50 px-4 py-2 bg-secondary/10">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dispatch Orders</span>
                    </div>
                    <div className="space-y-1">
                      {packItem.dispatches.map(d => {
                        const isDispatchPacked = packedDispatches.has(d.id);
                        return (
                          <div
                            key={d.id}
                            className={cn(
                              "flex items-center justify-between text-xs rounded px-2 py-1.5 transition-colors",
                              isDispatchPacked
                                ? "bg-emerald-50 dark:bg-emerald-900/20"
                                : "hover:bg-secondary/50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => isWrapped && toggleDispatchPacked(d.id)}
                                disabled={!isWrapped}
                                aria-label={isDispatchPacked ? "Mark dispatch unpacked" : "Mark dispatch packed"}
                                className={cn(
                                  "w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                                  isWrapped
                                    ? isDispatchPacked
                                      ? "bg-emerald-500 border-emerald-500 text-white"
                                      : "border-border bg-background hover:border-emerald-400"
                                    : "border-border/40 bg-background opacity-40 cursor-not-allowed"
                                )}
                              >
                                {isDispatchPacked && <CheckCircle2 className="w-3 h-3" />}
                              </button>
                              <span className={cn(
                                "text-muted-foreground",
                                isDispatchPacked && "line-through opacity-60"
                              )}>
                                {d.customer ?? "Unknown customer"}
                              </span>
                            </div>
                            <span className={cn(
                              "font-semibold tabular-nums",
                              isDispatchPacked && "text-muted-foreground line-through opacity-60"
                            )}>
                              {d.quantity} packs
                            </span>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between text-xs font-semibold pt-1 border-t border-border/40 mt-1">
                        <span>Total Dispatching</span>
                        <span>{packItem.totalDispatch} packs</span>
                      </div>
                      {gap !== 0 && (
                        <div className={cn(
                          "flex items-center gap-1.5 text-xs mt-0.5",
                          gap > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                        )}>
                          {gap > 0
                            ? <><Info className="w-3 h-3" /> {gap} surplus packs</>
                            : <><AlertCircle className="w-3 h-3" /> {Math.abs(gap)} packs short of dispatch</>
                          }
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

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
            // Compute the prep date label for this tile
            const prepDateLabel = isLoading
              ? "Loading…"
              : nextPlan?.planDate
                ? (() => {
                    try {
                      const d = parseISO(nextPlan.planDate);
                      return `Prep for ${format(d, "EEEE, d MMM")}`;
                    } catch { return nextPlan.planDate; }
                  })()
                : "No active plan this week";
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
                  <p className={cn("text-xs font-semibold mt-1.5", nextPlan?.planDate ? s.color : "text-muted-foreground")}>
                    {prepDateLabel}
                  </p>
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
