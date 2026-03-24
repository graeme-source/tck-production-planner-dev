import React from "react";
import { createPortal } from "react-dom";
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
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronUp, ChevronDown, Plus, Minus,
  Coffee, Utensils, Clock, CheckCircle2,
  PlayCircle, BarChart2, Loader2,
  Construction, Waves, Flame, Gift, Box, Salad, Layers,
  Beef, TrendingUp, Trophy, ExternalLink, ChevronRight,
  List, LayoutGrid, CalendarCheck,
  Snowflake, Truck, AlertCircle, Info, Droplets, Timer,
  ClipboardList, Check, Package, RotateCcw, RefreshCw, Scan,
} from "lucide-react";
import { format, parseISO, differenceInMinutes, differenceInSeconds, addDays } from "date-fns";
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
import { GripVertical, Lock } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Station metadata
// ──────────────────────────────────────────────────────────────────────────────
const STATIONS = [
  { key: "dough_prep", label: "Dough Prep", short: "Dough Prep", icon: Layers, color: "text-amber-600" },
  { key: "dough_sheeting", label: "Dough Sheeting", short: "Sheeting", icon: Layers, color: "text-amber-500" },
  { key: "prep", label: "Prep", short: "Prep", icon: Salad, color: "text-green-500" },
  { key: "mixing", label: "Mixing & Cooking", short: "Mixing", icon: Waves, color: "text-blue-500" },
  { key: "building_1", label: "Building Line 1", short: "Build 1", icon: Construction, color: "text-orange-500" },
  { key: "building_2", label: "Building Line 2", short: "Build 2", icon: Construction, color: "text-orange-400" },
  { key: "ovens", label: "Ovens", short: "Ovens", icon: Flame, color: "text-red-500" },
  { key: "wrapping", label: "Wrapping", short: "Wrapping", icon: Gift, color: "text-purple-500" },
  { key: "packing", label: "Packing", short: "Packing", icon: Box, color: "text-indigo-500" },
] as const;

type StationType = typeof STATIONS[number]["key"] | "main_prep" | "prep_veg" | "prep_bases" | "prep_meat";

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
    if (key === "main_prep") return { label: "Main Prep", icon: ClipboardList, color: "text-emerald-600" };
    if (key === "prep_veg") return { label: "Veg Prep", icon: Salad, color: "text-green-500" };
    if (key === "prep_bases") return { label: "Bases & Sauces", icon: Layers, color: "text-yellow-500" };
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
                  const prepSubStations = ["main_prep", "prep_veg", "prep_bases", "prep_meat"] as const;
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

              {(() => {
                const prepSubKeys = ["main_prep", "prep_veg", "prep_bases", "prep_meat"] as const;
                const isInPrepSub = (prepSubKeys as readonly string[]).includes(stationType);
                return (
                  <button
                    onClick={() => navigate(isInPrepSub ? `/plans/${planId}/station/prep` : `/plans`)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg px-3 py-1.5"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {isInPrepSub ? "Prep Sections" : "Exit Station"}
                  </button>
                );
              })()}
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
  onBreakActiveChange?: (active: boolean) => void;
}

interface ActiveBreak {
  id: number;
  type: "morning" | "lunch";
  startedAt: string;
}

function BreakTracker({ planId, stationType, onBreakChange, onBreakActiveChange }: BreakTrackerProps) {
  const [activeBreak, setActiveBreak] = useState<ActiveBreak | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [defaults, setDefaults] = useState<{ breakMins: number; lunchMins: number }>({ breakMins: 15, lunchMins: 45 });
  const createBreak = useCreateStationBreak();
  const endBreak = useEndStationBreak();
  // Ref used by the polling effect so it always sees the latest activeBreak without re-creating the interval
  const activeBreakRef = useRef<ActiveBreak | null>(null);
  activeBreakRef.current = activeBreak;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // No stationType filter — breaks are synced globally across all stations
      fetch(`/api/production-plans/${planId}/station-breaks/active`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null),
      fetch("/api/app-settings", { credentials: "include" })
        .then(r => r.ok ? r.json() : {})
        .catch(() => ({})),
    ]).then(([breakData, settings]: [{ id: number; breakType: string; startedAt: string } | null, Record<string, string>]) => {
      if (cancelled) return;
      if (settings.default_break_minutes) setDefaults(d => ({ ...d, breakMins: Number(settings.default_break_minutes) }));
      if (settings.default_lunch_minutes) setDefaults(d => ({ ...d, lunchMins: Number(settings.default_lunch_minutes) }));
      if (breakData && breakData.id) {
        setActiveBreak({ id: breakData.id, type: (breakData.breakType as "morning" | "lunch") ?? "morning", startedAt: breakData.startedAt });
        onBreakActiveChange?.(true);
      } else {
        onBreakActiveChange?.(false);
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [planId, stationType]);

  // Poll every 10 s so breaks started on other stations/devices appear automatically
  useEffect(() => {
    if (!hydrated) return;
    const poll = () => {
      fetch(`/api/production-plans/${planId}/station-breaks/active`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then((breakData: { id: number; breakType: string; startedAt: string } | null) => {
          const curr = activeBreakRef.current;
          if (breakData?.id) {
            if (!curr || curr.id !== breakData.id) {
              setActiveBreak({ id: breakData.id, type: (breakData.breakType as "morning" | "lunch") ?? "morning", startedAt: breakData.startedAt });
              onBreakActiveChange?.(true);
            }
          } else if (curr) {
            setActiveBreak(null);
            onBreakChange?.(null);
            onBreakActiveChange?.(false);
          }
        })
        .catch(() => {});
    };
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [planId, hydrated]);

  useEffect(() => {
    if (!activeBreak) {
      onBreakChange?.(null);
      setElapsedSecs(0);
      return;
    }
    const update = () => {
      const secs = differenceInSeconds(new Date(), parseISO(activeBreak.startedAt));
      setElapsedSecs(secs);
      const mins = Math.floor(secs / 60);
      onBreakChange?.(mins);
    };
    update();
    const interval = setInterval(update, 1000);
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
          onBreakActiveChange?.(true);
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
        onSuccess: () => { setActiveBreak(null); onBreakChange?.(null); onBreakActiveChange?.(false); },
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

  const breakOverlay = activeBreak ? (() => {
    const allowedSecs = (activeBreak.type === "lunch" ? defaults.lunchMins : defaults.breakMins) * 60;
    const remainingSecs = allowedSecs - elapsedSecs;
    const overrun = elapsedSecs > allowedSecs;
    const approaching = !overrun && remainingSecs <= 120;

    const elapsedMins = Math.floor(elapsedSecs / 60);
    const elapsedSecsRem = elapsedSecs % 60;
    const elapsedLabel = `${String(elapsedMins).padStart(2, "0")}:${String(elapsedSecsRem).padStart(2, "0")}`;

    const overrunSecs = Math.max(0, elapsedSecs - allowedSecs);
    const overrunMins = Math.floor(overrunSecs / 60);
    const overrunSecsRem = overrunSecs % 60;
    const overrunLabel = `${String(overrunMins).padStart(2, "0")}:${String(overrunSecsRem).padStart(2, "0")}`;

    const remSecs = Math.max(0, remainingSecs);
    const remMins = Math.floor(remSecs / 60);
    const remSecsRem = remSecs % 60;
    const remainingLabel = `${String(remMins).padStart(2, "0")}:${String(remSecsRem).padStart(2, "0")}`;

    const timerColor = overrun
      ? "text-red-400"
      : approaching
        ? "text-amber-400"
        : "text-emerald-400";

    const ringBg = overrun
      ? "border-red-500/40"
      : approaching
        ? "border-amber-500/40"
        : "border-emerald-500/40";

    const badgeBg = overrun
      ? "bg-red-500/20 text-red-300 border border-red-500/30"
      : approaching
        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
        : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";

    const btnClass = overrun
      ? "bg-red-500 hover:bg-red-400 text-white"
      : "bg-white/10 hover:bg-white/20 text-white border border-white/20";

    const BreakIcon = activeBreak.type === "lunch" ? Utensils : Coffee;
    const breakLabel = activeBreak.type === "lunch" ? "Lunch Break" : "Snack Break";
    const allowedMins = activeBreak.type === "lunch" ? defaults.lunchMins : defaults.breakMins;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.75)" }}
      >
        <div className={cn(
          "relative flex flex-col items-center gap-6 rounded-3xl border-2 p-10 shadow-2xl w-full max-w-sm mx-4",
          "bg-gray-900/95",
          ringBg
        )}>
          {/* Icon + label */}
          <div className="flex flex-col items-center gap-3">
            <div className={cn("flex items-center justify-center w-16 h-16 rounded-2xl", badgeBg)}>
              <BreakIcon className="w-8 h-8" />
            </div>
            <p className="text-white text-xl font-bold tracking-tight">{breakLabel}</p>
            <p className="text-gray-400 text-sm">
              Started {format(parseISO(activeBreak.startedAt), "HH:mm")} · {allowedMins} min allowed
            </p>
          </div>

          {/* Live timer */}
          <div className="flex flex-col items-center gap-1">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest">Elapsed</p>
            <p className={cn("text-7xl font-bold font-mono tabular-nums tracking-tight", timerColor)}>
              {elapsedLabel}
            </p>
            {overrun ? (
              <p className="text-red-400 text-sm font-semibold mt-1">
                {overrunLabel} over time
              </p>
            ) : (
              <p className={cn("text-sm font-medium mt-1", approaching ? "text-amber-400" : "text-gray-400")}>
                {remainingLabel} remaining
              </p>
            )}
          </div>

          {/* End break button */}
          <button
            onClick={stopBreak}
            disabled={endBreak.isPending}
            className={cn(
              "w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-95",
              btnClass,
              endBreak.isPending && "opacity-60 cursor-not-allowed"
            )}
          >
            {endBreak.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Ending…
              </span>
            ) : (
              `End ${activeBreak.type === "lunch" ? "Lunch" : "Snack"} Break`
            )}
          </button>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <>
      {breakOverlay}
      {!activeBreak && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Breaks:</span>
          <button
            onClick={() => startBreak("morning")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary/60 transition-colors"
          >
            <Coffee className="w-3.5 h-3.5" />
            Snack ({defaults.breakMins}m)
          </button>
          <button
            onClick={() => startBreak("lunch")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-lg hover:bg-secondary/60 transition-colors"
          >
            <Utensils className="w-3.5 h-3.5" />
            Lunch ({defaults.lunchMins}m)
          </button>
        </div>
      )}
    </>
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
  const isBuildingStation = stationType === "building_1" || stationType === "building_2";
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalBatchesComplete = items.reduce((s, it) => s + (
    isBuildingStation
      ? getStationCount(it, "building_1") + getStationCount(it, "building_2")
      : getStationCount(it, stationType)
  ), 0);
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

function formatMixQty(qty: number, unit: string | null) {
  if (qty >= 1000 && (unit === "g" || unit === "ml")) {
    return `${(qty / 1000).toFixed(2)} ${unit === "g" ? "kg" : "L"}`;
  }
  return `${qty % 1 === 0 ? qty : qty.toFixed(1)} ${unit ?? ""}`;
}

interface FillingMixItem {
  itemId: number;
  recipeId: number;
  recipeName: string | null;
  tinSize: string | null;
  tinsTarget: number;
  batchesPerTin: number;
  servingsPerTin: number;
  fillingIngredients: Array<{ ingredientId: number; name: string | null; unit: string | null; qtyPerBatch: number; qtyPerTin: number }>;
  fillingSubRecipes: Array<{ subRecipeId: number; name: string | null; unit: string | null; qtyPerBatch: number; qtyPerTin: number }>;
}

interface MixingStationProps {
  plan: ProductionPlanDetail;
}

function MixingStation({ plan }: MixingStationProps) {
  const { state } = useAuth();
  const isAdmin = state.status === "authenticated" && state.user.role === "admin";
  const queryClient = useQueryClient();
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [checkedIngredients, setCheckedIngredients] = useState<Record<string, boolean>>({});
  const [completing, setCompleting] = useState(false);
  const [completeFailed, setCompleteFailed] = useState(false);

  const authUser = state.status === "authenticated" ? state.user : null;

  const [mixingTab, setMixingTab] = useState<"tins" | "cooking">("cooking");
  // key = `${recipeId}-${ingredientId}`, value = map of trayIdx → 0 (empty), 1 (in oven), 2 (done)
  const [trayStates, setTrayStates] = useState<Record<string, Record<number, 0 | 1 | 2>>>({});
  interface OvenEventRow {
    id: number; planId: number; recipeId: number | null; recipeName: string | null;
    ingredientId: number | null; ingredientName: string | null; trayIndex: number;
    ovenInAt: string; ovenOutAt: string | null; userId: number | null; userName: string | null;
  }
  const [ovenEvents, setOvenEvents] = useState<OvenEventRow[]>([]);
  // Pending temperature entry: which tray just moved to "done" and needs a temp recorded
  const [tempPrompt, setTempPrompt] = useState<{
    recipeId: number; recipeName: string;
    ingredientId: number; ingredientName: string;
    trayIdx: number; planId: number; planName: string;
  } | null>(null);
  const [tempValue, setTempValue] = useState("");
  const [tempSaving, setTempSaving] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/oven-events?planId=${plan.id}`, { credentials: "include" })
      .then(r => r.json())
      .then((rows: OvenEventRow[]) => {
        setOvenEvents(rows);
        const restored: Record<string, Record<number, 0 | 1 | 2>> = {};
        for (const ev of rows) {
          const key = `${ev.recipeId}-${ev.ingredientId}`;
          if (!restored[key]) restored[key] = {};
          restored[key][ev.trayIndex] = ev.ovenOutAt ? 2 : 1;
        }
        setTrayStates(prev => {
          const merged = { ...prev };
          for (const [k, v] of Object.entries(restored)) {
            merged[k] = { ...(merged[k] ?? {}), ...v };
          }
          return merged;
        });
      })
      .catch(() => {});
  }, [plan.id]);

  const advanceTray = async (
    recipeId: number, recipeName: string,
    ingredientId: number, ingredientName: string,
    trayIdx: number, planId: number, planName: string,
  ) => {
    const key = `${recipeId}-${ingredientId}`;
    const cur = (trayStates[key]?.[trayIdx] ?? 0) as 0 | 1 | 2;
    let next: 0 | 1 | 2;
    if (cur === 0) next = 1;
    else if (cur === 1) next = 2;
    else next = 0;

    setTrayStates(prev => ({ ...prev, [key]: { ...prev[key], [trayIdx]: next } }));

    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    try {
      if (next === 1) {
        const res = await fetch(`${base}/api/oven-events/oven-in`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, recipeId, recipeName, ingredientId, ingredientName, trayIndex: trayIdx }),
        });
        if (res.ok) {
          const ev: OvenEventRow = await res.json();
          setOvenEvents(prev => [ev, ...prev]);
        }
      } else if (next === 2) {
        const res = await fetch(`${base}/api/oven-events/oven-out`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, recipeId, ingredientId, trayIndex: trayIdx }),
        });
        if (res.ok) {
          const ev: OvenEventRow = await res.json();
          setOvenEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
        }
        setTimeout(() => setTempPrompt({ recipeId, recipeName, ingredientId, ingredientName, trayIdx, planId, planName }), 0);
      } else {
        await fetch(`${base}/api/oven-events?planId=${planId}&recipeId=${recipeId}&ingredientId=${ingredientId}&trayIndex=${trayIdx}`, {
          method: "DELETE", credentials: "include",
        });
        setOvenEvents(prev => prev.filter(e => !(e.recipeId === recipeId && e.ingredientId === ingredientId && e.trayIndex === trayIdx)));
      }
    } catch {
      // Revert on error
      setTrayStates(prev => ({ ...prev, [key]: { ...prev[key], [trayIdx]: cur } }));
    }
  };

  const submitTemp = async () => {
    if (!tempPrompt) return;
    const c = parseFloat(tempValue);
    if (isNaN(c)) return;
    setTempSaving(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      await fetch(`${base}/api/temperature-records`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: tempPrompt.planId,
          planName: tempPrompt.planName,
          recipeId: tempPrompt.recipeId,
          recipeName: tempPrompt.recipeName,
          ingredientId: tempPrompt.ingredientId,
          ingredientName: tempPrompt.ingredientName,
          trayIndex: tempPrompt.trayIdx,
          temperatureC: c,
          recordType: "cooked_core",
        }),
      });
      toast({ title: "Temperature recorded", description: `${c}°C saved for tray ${tempPrompt.trayIdx + 1}` });
    } catch {
      toast({ title: "Failed to save temperature", variant: "destructive" });
    } finally {
      setTempSaving(false);
      setTempPrompt(null);
      setTempValue("");
    }
  };
  const [cookingRecipes, setCookingRecipes] = useState<PrepRecipeDetail[]>([]);
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/prep-requirements-by-recipe?station=prep_meat`, { credentials: "include" })
      .then(r => r.json())
      .then((d: { recipes?: PrepRecipeDetail[] }) => setCookingRecipes(d.recipes ?? []))
      .catch(() => {});
    const interval = setInterval(() => {
      fetch(`/api/production-plans/${plan.id}/prep-requirements-by-recipe?station=prep_meat`, { credentials: "include" })
        .then(r => r.json())
        .then((d: { recipes?: PrepRecipeDetail[] }) => setCookingRecipes(d.recipes ?? []))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [plan.id]);

  const [fillingData, setFillingData] = useState<FillingMixItem[]>([]);
  useEffect(() => {
    fetch(`/api/production-plans/${plan.id}/filling-mix`, { credentials: "include" })
      .then(r => r.json())
      .then(d => setFillingData(d.items ?? []))
      .catch(() => {});
  }, [plan.id]);

  const updateOrder = useUpdateProductionPlanOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
      },
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // A recipe is locked in place once the building station has started it
  // (first batch completed by builders). Locked recipes always stay at the top.
  const isBuildingStarted = (it: ProductionPlanItem) => getStationCount(it, "building") > 0;
  const isOrderLocked = (it: ProductionPlanItem) => isBuildingStarted(it) || it.status === "complete";

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex(it => it.id === active.id);
    const newIndex = items.findIndex(it => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const movingItem = items[oldIndex];

    if (!isAdmin) {
      // Never move a locked recipe
      if (isOrderLocked(movingItem)) return;
      // Never drop into the locked zone (above locked recipes)
      const lockedCount = items.filter(isOrderLocked).length;
      if (newIndex < lockedCount) {
        toast({ title: "Can't reorder", description: "Recipes already in production are fixed at the top.", variant: "destructive" });
        return;
      }
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

  const addTin = async (item: ProductionPlanItem): Promise<boolean> => {
    if (isOnBreak) return false;
    const { tinsComplete, batchesPerTinEven, mixed, target, allDone } = getTinInfo(item);
    if (allDone) return false;
    const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
    const batchesToAdd = batchesAfterNextTin - mixed;
    if (batchesToAdd <= 0) return false;
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
      return true;
    } catch (err) {
      toast({ title: "Could not complete tin", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      return false;
    }
  };

  const undoTin = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
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

  const getFillingForItem = (itemId: number) => fillingData.find(f => f.itemId === itemId);

  const toggleIngredient = (itemId: number, key: string) => {
    setCheckedIngredients(prev => ({ ...prev, [`${itemId}-${key}`]: !prev[`${itemId}-${key}`] }));
  };

  const allCheckedForItem = (item: ProductionPlanItem) => {
    const filling = getFillingForItem(item.id);
    if (!filling) return false;
    const total = filling.fillingIngredients.length + filling.fillingSubRecipes.length;
    if (total === 0) return false;
    for (let i = 0; i < filling.fillingIngredients.length; i++) {
      if (!checkedIngredients[`${item.id}-ing-${i}`]) return false;
    }
    for (let i = 0; i < filling.fillingSubRecipes.length; i++) {
      if (!checkedIngredients[`${item.id}-sub-${i}`]) return false;
    }
    return true;
  };

  const clearChecksForItem = (itemId: number) => {
    setCheckedIngredients(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${itemId}-`)) delete next[key];
      }
      return next;
    });
  };

  const handleAutoComplete = useCallback(async (item: ProductionPlanItem) => {
    if (completing || isOnBreak) return;
    setCompleting(true);
    setCompleteFailed(false);
    const success = await addTin(item);
    if (success) {
      clearChecksForItem(item.id);
      const info = getTinInfo(item);
      const newTinsComplete = info.tinsComplete + 1;
      if (newTinsComplete >= info.tinsTarget) {
        const currentIdx = items.findIndex(it => it.id === item.id);
        const nextItem = items.slice(currentIdx + 1).find(it => {
          const f = getFillingForItem(it.id);
          const mc = getStationCount(it, "mixing");
          const tgt = it.batchesTarget ?? 0;
          return f && (f.fillingIngredients.length > 0 || f.fillingSubRecipes.length > 0) && mc < tgt;
        });
        setActiveItemId(nextItem ? nextItem.id : null);
      }
    } else {
      setCompleteFailed(true);
    }
    setCompleting(false);
  }, [completing, isOnBreak, items, fillingData]);

  useEffect(() => {
    if (activeItemId === null) return;
    const item = items.find(it => it.id === activeItemId);
    if (!item) return;
    if (allCheckedForItem(item) && !completing && !isOnBreak) {
      handleAutoComplete(item);
    }
  }, [checkedIngredients, activeItemId]);

  const activateItem = (itemId: number) => {
    setActiveItemId(prev => (prev === itemId ? null : itemId));
  };

  const activeItem = activeItemId ? items.find(it => it.id === activeItemId) : null;
  const activeFilling = activeItemId ? getFillingForItem(activeItemId) : null;
  const activeHasFilling = activeFilling && (activeFilling.fillingIngredients.length > 0 || activeFilling.fillingSubRecipes.length > 0);

  const totalTinsTarget = items.reduce((s, it) => s + getTinInfo(it).tinsTarget, 0);
  const totalTinsComplete = items.reduce((s, it) => s + getTinInfo(it).tinsComplete, 0);
  const totalBatchesDone = items.reduce((s, it) => s + getStationCount(it, "mixing"), 0);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const overallProgress = totalTinsTarget > 0 ? Math.round((totalTinsComplete / totalTinsTarget) * 100) : 0;


  const getActiveTinInfo = () => {
    if (!activeItem) return { tinsTarget: 0, tinsComplete: 0, batchesPerTinEven: 0, currentTinBatches: 0, isComplete: false };
    const target = activeItem.batchesTarget ?? 0;
    const bpt = activeItem.maxBatchesPerTin ?? 1;
    const mixingCount = getStationCount(activeItem, "mixing");
    const tinsTarget = Math.ceil(target / bpt);
    const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
    let tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixingCount / batchesPerTinEven), tinsTarget) : 0;
    if (mixingCount >= target && target > 0) tinsComplete = tinsTarget;
    const allDone = tinsComplete >= tinsTarget;
    const isComplete = mixingCount >= target && target > 0;
    const currentTinBatches = (() => {
      if (allDone || tinsTarget === 0) return batchesPerTinEven;
      const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
      return batchesAfterNextTin - mixingCount;
    })();
    return { tinsTarget, tinsComplete, batchesPerTinEven, currentTinBatches, isComplete };
  };

  const activeTinInfo = getActiveTinInfo();

  return (
    <>
    {/* Temperature entry dialog */}
    {tempPrompt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
          <div>
            <h3 className="font-bold text-lg">Record Core Temperature</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tempPrompt.recipeName} — {tempPrompt.ingredientName}, Tray {tempPrompt.trayIdx + 1}
            </p>
            {authUser && <p className="text-xs text-muted-foreground">Recorded by: {authUser.name}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Core Temperature (°C)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="0"
                max="200"
                placeholder="e.g. 75.5"
                value={tempValue}
                onChange={e => setTempValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submitTemp(); }}
                autoFocus
                className="flex-1 border border-border rounded-lg px-3 py-2.5 text-lg font-semibold tabular-nums bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-xl font-bold text-muted-foreground">°C</span>
            </div>
            {tempValue && !isNaN(parseFloat(tempValue)) && (
              <p className={cn("text-sm font-semibold", parseFloat(tempValue) >= 75 ? "text-green-600" : "text-red-600")}>
                {parseFloat(tempValue) >= 75 ? "✓ Above 75°C — safe" : "⚠️ Below 75°C minimum — check again"}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { setTempPrompt(null); setTempValue(""); }}
              className="flex-1 py-2.5 rounded-xl border border-border font-medium text-sm hover:bg-secondary"
            >
              Skip
            </button>
            <button
              onClick={submitTemp}
              disabled={!tempValue || isNaN(parseFloat(tempValue)) || tempSaving}
              className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {tempSaving ? "Saving…" : "Save Temperature"}
            </button>
          </div>
        </div>
      </div>
    )}
    <div className="space-y-4">
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

        <div className="mt-3 pt-3 border-t border-border/50">
          <BreakTracker planId={plan.id} stationType="mixing" onBreakActiveChange={setIsOnBreak} />
        </div>
      </div>

      {/* ── Big tab switcher ── */}
      <div className="flex gap-2">
        <button
          onClick={() => setMixingTab("cooking")}
          className={cn(
            "flex-1 py-4 rounded-xl font-bold text-xl transition-all border-2 bg-card",
            mixingTab === "cooking"
              ? "border-rose-500 text-rose-600 dark:text-rose-400"
              : "border-border text-muted-foreground hover:border-rose-400/60 hover:text-foreground"
          )}
        >
          Meat Cooking
        </button>
        <button
          onClick={() => setMixingTab("tins")}
          className={cn(
            "flex-1 py-4 rounded-xl font-bold text-xl transition-all border-2 bg-card",
            mixingTab === "tins"
              ? "border-primary text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
          )}
        >
          Mixing Tins
        </button>
      </div>

      {/* ── Cooking tab ── */}
      {mixingTab === "cooking" && (
        <div className="space-y-4">
          {cookingRecipes.filter(r => r.trayCount != null && r.trayCount > 0).length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
              No raw meat trays for this plan — cooking settings not yet configured on ingredients.
            </div>
          ) : (
            cookingRecipes
              .filter(r => r.trayCount != null && r.trayCount > 0)
              .map(recipe => {
                const rawMeatIngs = recipe.ingredients.filter(i => i.isRawMeat && i.trayCount != null && i.trayCount > 0);
                const marinades = recipe.marinades ?? [];
                const totalDoneForRecipe = rawMeatIngs.reduce((s, ing) => {
                  const key = `${recipe.recipeId}-${ing.ingredientId}`;
                  return s + Object.values(trayStates[key] ?? {}).filter(st => st === 2).length;
                }, 0);
                const totalTraysForRecipe = rawMeatIngs.reduce((s, ing) => s + (ing.trayCount ?? 0), 0);
                const recipeAllDone = totalTraysForRecipe > 0 && totalDoneForRecipe >= totalTraysForRecipe;
                return (
                  <div key={recipe.recipeId} className={cn("bg-card border-2 rounded-xl overflow-hidden transition-all", recipeAllDone ? "border-green-400 dark:border-green-600" : "border-border")}>
                    {/* Recipe header */}
                    <div className={cn("flex items-center justify-between px-4 py-3 border-b border-border", recipeAllDone ? "bg-green-50 dark:bg-green-900/20" : "bg-secondary/30")}>
                      <div>
                        <p className="font-semibold">{recipe.recipeName}</p>
                        <p className="text-xs text-muted-foreground">{recipe.batchesTarget} batches · {totalTraysForRecipe} tray{totalTraysForRecipe !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="text-right">
                        {recipeAllDone ? (
                          <span className="text-green-600 dark:text-green-400 font-bold text-sm">✓ All done</span>
                        ) : (
                          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{totalDoneForRecipe}/{totalTraysForRecipe} done</span>
                        )}
                      </div>
                    </div>

                    {/* Per-meat-ingredient sections */}
                    <div className="divide-y divide-border/50">
                      {rawMeatIngs.map(ing => {
                        const ingTrays = ing.trayCount ?? 0;
                        const key = `${recipe.recipeId}-${ing.ingredientId}`;
                        const ingTrayMap = trayStates[key] ?? {};
                        const doneCount = Object.values(ingTrayMap).filter(s => s === 2).length;
                        const inOvenCount = Object.values(ingTrayMap).filter(s => s === 1).length;
                        const allIngDone = doneCount >= ingTrays;
                        const perTrayKg = ingTrays > 0 ? toKg(ing.rawQty, ing.unit) / ingTrays : null;
                        const hasSettings = ing.minCookingTempC || ing.ovenTempC || ing.estimatedCookTimeMin || ing.steamPct != null;

                        return (
                          <div key={ing.ingredientId} className="px-4 py-4 space-y-3">
                            {/* Ingredient name + progress */}
                            <div className="flex items-center justify-between">
                              <div>
                                <p className={cn("font-semibold", allIngDone && "line-through text-muted-foreground")}>{ing.ingredientName}</p>
                                {perTrayKg && (
                                  <p className="text-xs text-muted-foreground tabular-nums">
                                    {perTrayKg.toFixed(2)} kg / tray · {toKg(ing.rawQty, ing.unit).toFixed(2)} kg total
                                  </p>
                                )}
                              </div>
                              <div className="text-right space-y-0.5">
                                {inOvenCount > 0 && (
                                  <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">{inOvenCount} in oven</p>
                                )}
                                <span className={cn("text-sm font-bold tabular-nums", allIngDone ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
                                  {doneCount}/{ingTrays} done
                                </span>
                              </div>
                            </div>

                            {/* Cooking settings tiles */}
                            {hasSettings && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {ing.minCookingTempC && (
                                  <div className="bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 text-center">
                                    <p className="text-xs text-muted-foreground mb-0.5">Core Temp</p>
                                    <p className="font-bold text-sm tabular-nums text-red-600 dark:text-red-400">{ing.minCookingTempC}°C</p>
                                  </div>
                                )}
                                {ing.ovenTempC && (
                                  <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg px-3 py-2 text-center">
                                    <p className="text-xs text-muted-foreground mb-0.5">Oven Temp</p>
                                    <p className="font-bold text-sm tabular-nums text-orange-600 dark:text-orange-400">{ing.ovenTempC}°C</p>
                                  </div>
                                )}
                                {ing.estimatedCookTimeMin && (
                                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 text-center">
                                    <p className="text-xs text-muted-foreground mb-0.5">Cook Time</p>
                                    <p className="font-bold text-sm tabular-nums text-blue-600 dark:text-blue-400">{ing.estimatedCookTimeMin} min</p>
                                  </div>
                                )}
                                {ing.steamPct != null && (
                                  <div className="bg-cyan-50 dark:bg-cyan-900/20 rounded-lg px-3 py-2 text-center">
                                    <p className="text-xs text-muted-foreground mb-0.5">Steam</p>
                                    <p className="font-bold text-sm tabular-nums text-cyan-600 dark:text-cyan-400">{ing.steamPct}%</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Tray completion buttons — tap to cycle: empty → in oven → done */}
                            <div className="grid grid-cols-4 gap-2">
                              {Array.from({ length: ingTrays }, (_, idx) => {
                                const st = ingTrayMap[idx] ?? 0;
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => advanceTray(recipe.recipeId, recipe.recipeName, ing.ingredientId, ing.ingredientName, idx, plan.id, plan.name ?? "")}
                                    className={cn(
                                      "flex flex-col items-center justify-center py-3 rounded-xl border-2 font-semibold text-sm transition-all active:scale-95",
                                      st === 2 ? "bg-green-500 border-green-500 text-white"
                                      : st === 1 ? "bg-orange-500 border-orange-500 text-white"
                                      : "bg-card border-border text-muted-foreground hover:border-rose-400 hover:text-foreground"
                                    )}
                                  >
                                    <span className="text-base">{st === 2 ? "✓" : st === 1 ? "🔥" : idx + 1}</span>
                                    <span className="text-xs opacity-80">{st === 2 ? "done" : st === 1 ? "in oven" : "tray"}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
          )}

          {(() => {
            const completed = ovenEvents.filter(e => e.ovenOutAt);
            if (completed.length === 0) return null;
            return (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/30">
                  <p className="font-semibold">Cooking Times</p>
                  <p className="text-xs text-muted-foreground">Actual oven times recorded today</p>
                </div>
                <div className="divide-y divide-border/50">
                  {completed.map(ev => {
                    const inTime = new Date(ev.ovenInAt);
                    const outTime = new Date(ev.ovenOutAt!);
                    const durationMin = Math.round((outTime.getTime() - inTime.getTime()) / 60000);
                    const hours = Math.floor(durationMin / 60);
                    const mins = durationMin % 60;
                    const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    const formatTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={ev.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{ev.recipeName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {ev.ingredientName} — Tray {ev.trayIndex + 1}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-sm tabular-nums">{durationStr}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatTime(inTime)} → {formatTime(outTime)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {mixingTab === "tins" && (
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
          {activeItemId ? "All Recipes" : "Click a recipe to start mixing"}
        </h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map(item => {
                const mixingCount = getStationCount(item, "mixing");
                const target = item.batchesTarget ?? 0;
                const bpt = item.maxBatchesPerTin ?? 1;
                const tinsTarget = Math.ceil(target / bpt);
                const batchesPerTinEven = tinsTarget > 0 ? Math.ceil(target / tinsTarget) : target;
                let tinsComplete = tinsTarget > 0 ? Math.min(Math.floor(mixingCount / batchesPerTinEven), tinsTarget) : 0;
                if (mixingCount >= target && target > 0) tinsComplete = tinsTarget;
                const allTinsDone = tinsComplete >= tinsTarget;
                const progress = tinsTarget > 0 ? Math.round((tinsComplete / tinsTarget) * 100) : 0;
                const isComplete = mixingCount >= target && target > 0;
                const filling = getFillingForItem(item.id);
                const hasFillingItems = filling && (filling.fillingIngredients.length > 0 || filling.fillingSubRecipes.length > 0);
                const isActive = activeItemId === item.id;
                const isDraggable = isAdmin || (!isOrderLocked(item) && item.status === "pending");

                return (
                  <MixingOverviewRow
                    key={item.id}
                    item={item}
                    isActive={isActive}
                    isComplete={isComplete}
                    isDraggable={isDraggable}
                    hasFillingItems={!!hasFillingItems}
                    tinsComplete={tinsComplete}
                    tinsTarget={tinsTarget}
                    allTinsDone={allTinsDone}
                    progress={progress}
                    mixingCount={mixingCount}
                    target={target}
                    batchesPerTinEven={batchesPerTinEven}
                    isOnBreak={isOnBreak}
                    isAdmin={isAdmin}
                    onActivate={() => activateItem(item.id)}
                    onAdd={() => addTin(item)}
                    onRemove={() => undoTin(item)}
                    filling={filling ?? null}
                    checkedIngredients={checkedIngredients}
                    onToggleIngredient={(key) => toggleIngredient(item.id, key)}
                    completing={isActive && completing}
                    completeFailed={isActive && completeFailed}
                    onAutoComplete={() => handleAutoComplete(item)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
      )}
    </div>
    </>
  );
}

interface MixingOverviewRowProps {
  item: ProductionPlanItem;
  isActive: boolean;
  isComplete: boolean;
  isDraggable: boolean;
  hasFillingItems: boolean;
  tinsComplete: number;
  tinsTarget: number;
  allTinsDone: boolean;
  progress: number;
  mixingCount: number;
  target: number;
  batchesPerTinEven: number;
  isOnBreak: boolean;
  isAdmin: boolean;
  onActivate: () => void;
  onAdd: () => void;
  onRemove: () => void;
  filling: FillingMixItem | null;
  checkedIngredients: Record<string, boolean>;
  onToggleIngredient: (key: string) => void;
  completing: boolean;
  completeFailed: boolean;
  onAutoComplete: () => void;
}

function MixingOverviewRow({ item, isActive, isComplete, isDraggable, hasFillingItems, tinsComplete, tinsTarget, allTinsDone, progress, mixingCount, target, batchesPerTinEven, isOnBreak, isAdmin, onActivate, onAdd, onRemove, filling, checkedIngredients, onToggleIngredient, completing, completeFailed, onAutoComplete }: MixingOverviewRowProps) {
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

  const currentTinBatches = (() => {
    const allDone = tinsComplete >= tinsTarget;
    if (allDone || tinsTarget === 0) return batchesPerTinEven;
    const batchesAfterNextTin = Math.min((tinsComplete + 1) * batchesPerTinEven, target);
    return batchesAfterNextTin - mixingCount;
  })();

  const batchesPerTinEqual = tinsTarget > 0 ? target / tinsTarget : currentTinBatches;

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
        isActive ? "border-primary ring-1 ring-primary/30" : statusColors[item.status as keyof typeof statusColors] ?? "border-border",
        isDragging && "shadow-xl"
      )}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
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
              <div
                className="p-1 text-amber-500 dark:text-amber-400"
                title="Locked — building has started, position is fixed"
              >
                <Lock className="w-3.5 h-3.5" />
              </div>
            )}
          </div>

          <div
            className={cn("flex-1 min-w-0", hasFillingItems && !isComplete ? "cursor-pointer" : "")}
            onClick={hasFillingItems && !isComplete ? onActivate : undefined}
          >
            <div className="flex items-center gap-2 mb-1">
              <h3 className={cn("font-semibold", isComplete ? "line-through text-muted-foreground" : "")}>
                {item.recipeName ?? `Recipe #${item.recipeId}`}
              </h3>
              {isComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
              {item.status === "in-progress" && !isComplete && <PlayCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />}
              {isActive && <ChevronUp className="w-4 h-4 text-primary flex-shrink-0" />}
            </div>

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

              <span>{mixingCount} / {target} batches total</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onRemove}
              disabled={tinsComplete === 0 || isOnBreak}
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
              disabled={(allTinsDone && !isAdmin) || isOnBreak}
              className={cn(
                "w-9 h-9 flex items-center justify-center rounded-full transition-colors",
                isOnBreak
                  ? "border border-amber-300 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 opacity-60"
                  : allTinsDone
                    ? "border border-emerald-300 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 opacity-60"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {isActive && hasFillingItems && !isComplete && filling && (
        <div className="border-t border-primary/20 bg-primary/5">
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-xs font-medium text-primary">
              Filling Mix — Tin {tinsComplete + 1} of {tinsTarget}
            </p>
          </div>
          <div className="px-4 pb-3 space-y-0.5">
            {filling.fillingIngredients.map((fi, idx) => (
              <div key={`ing-${idx}`} className="flex items-center gap-3 py-2 px-3 rounded-lg">
                <span className="flex-1 text-base">
                  {fi.name ?? `Ingredient #${fi.ingredientId}`}
                </span>
                <div className="flex flex-col items-end">
                  <span className="text-base font-mono tabular-nums font-medium text-foreground">
                    {formatMixQty(fi.qtyPerBatch * batchesPerTinEqual, fi.unit)}
                  </span>
                  <span className="text-xs text-muted-foreground leading-none mt-0.5">per tin</span>
                </div>
              </div>
            ))}
            {filling.fillingSubRecipes.map((fs, idx) => (
              <div key={`sub-${idx}`} className="flex items-center gap-3 py-2 px-3 rounded-lg">
                <span className="flex-1 text-base">
                  {fs.name ?? `Sub-recipe #${fs.subRecipeId}`}
                </span>
                <div className="flex flex-col items-end">
                  <span className="text-base font-mono tabular-nums font-medium text-foreground">
                    {formatMixQty(fs.qtyPerBatch * batchesPerTinEqual, fs.unit)}
                  </span>
                  <span className="text-xs text-muted-foreground leading-none mt-0.5">per tin</span>
                </div>
              </div>
            ))}
          </div>

          {!completing && !completeFailed && (
            <div className="px-4 pb-3">
              <button
                onClick={onAutoComplete}
                className="w-full py-2.5 rounded-lg bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                Complete Tin {tinsComplete + 1}
              </button>
            </div>
          )}

          {completing && (
            <div className="px-4 pb-3">
              <div className="w-full py-2.5 rounded-lg bg-emerald-600/80 text-white font-semibold text-sm flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Completing tin...
              </div>
            </div>
          )}

          {completeFailed && !completing && (
            <div className="px-4 pb-3">
              <button
                onClick={onAutoComplete}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Retry — Complete Tin {tinsComplete + 1}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Extra Pack Control — secondary control on Building station
// ──────────────────────────────────────────────────────────────────────────────
function ExtraPackControl({ planId, item, isOnBreak }: { planId: number; item: ProductionPlanItem; isOnBreak: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const extraPacks = item.extraPacksBuilt ?? 0;
  const portionsPerBatch = item.portionsPerBatch ?? 0;

  const adjustExtraPacks = async (delta: 1 | -1) => {
    if (pending || isOnBreak) return;
    if (delta === -1 && extraPacks <= 0) return;
    setPending(true);
    try {
      const res = await fetch(`/api/production-plans/${planId}/items/${item.id}/extra-packs-built`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Could not update extra packs.", variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  const totalBatchEquiv = portionsPerBatch > 0
    ? ((item.batchesTarget ?? 0) + extraPacks / portionsPerBatch).toFixed(1)
    : null;

  return (
    <div className="mt-3 border border-dashed border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" />
          <span>Extra Single Packs</span>
          {extraPacks > 0 && (
            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-xs font-semibold px-2 py-0.5 rounded-full">
              +{extraPacks} pack{extraPacks !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <ChevronRight className={cn("w-4 h-4 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-dashed border-border bg-secondary/10">
          <p className="text-xs text-muted-foreground mb-3">
            Record individual packs built from extra sheeted balls — filling that doesn't make a full batch.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjustExtraPacks(-1)}
              disabled={pending || isOnBreak || extraPacks <= 0}
              className="w-10 h-10 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
            >
              <Minus className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <p className="text-2xl font-bold tabular-nums">{extraPacks}</p>
              <p className="text-xs text-muted-foreground">extra packs</p>
              {totalBatchEquiv && extraPacks > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mt-0.5">≈ {totalBatchEquiv} batches total</p>
              )}
            </div>
            <button
              onClick={() => adjustExtraPacks(1)}
              disabled={pending || isOnBreak}
              className={cn(
                "h-10 px-4 rounded-xl text-sm font-bold transition-all",
                isOnBreak
                  ? "bg-secondary text-muted-foreground"
                  : "bg-amber-500 text-white hover:bg-amber-600 active:scale-95"
              )}
            >
              + 1 Pack
            </button>
          </div>
        </div>
      )}
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

  function getCombinedBuildCount(it: ProductionPlanItem) {
    return getStationCount(it, "building_1") + getStationCount(it, "building_2");
  }

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const currentItem = items.find(it => getCombinedBuildCount(it) < (it.batchesTarget ?? 0));

  // Combined count from both lines — used for display and progress
  const buildingCount = currentItem ? getCombinedBuildCount(currentItem) : 0;
  // This builder's own contribution — used for undo guard and KPI
  const myCount = currentItem ? getStationCount(currentItem, stationType) : 0;
  // Available = how many more batches can be built before outpacing mixing
  const mixingCount = currentItem ? getStationCount(currentItem, "mixing") : 0;
  const available = currentItem ? Math.max(0, mixingCount - buildingCount) : 0;
  const remaining = currentItem ? Math.max(0, (currentItem.batchesTarget ?? 0) - buildingCount) : 0;
  const allDone = items.length > 0 && !currentItem;

  // Large "BATCH COMPLETE" tap — single write via createBatchCompletion only
  const handleBatchComplete = () => {
    if (!currentItem || pendingTap || available <= 0 || isOnBreak) return;
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

              {currentItem.notes && (
                <span className="italic text-xs">{currentItem.notes}</span>
              )}
            </div>

            {/* Current pace for this recipe */}
            {paceData[currentItem.id] != null && (
              <div className="mt-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 text-sm font-medium text-violet-700 dark:text-violet-300">
                  <Timer className="w-3.5 h-3.5" />
                  {paceData[currentItem.id]} mins/batch
                </span>
              </div>
            )}

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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Both Lines</p>
              <p className="text-6xl font-bold font-display tabular-nums text-primary">
                {buildingCount}
              </p>
              {myCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">My batches: {myCount}</p>
              )}
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
            disabled={pendingTap || isOnBreak || available <= 0}
            className={cn(
              "w-full py-6 rounded-2xl text-2xl font-bold transition-all select-none active:scale-95",
              remaining === 0
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 border-2 border-emerald-400 opacity-60 cursor-not-allowed"
                : isOnBreak
                  ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                  : available <= 0
                    ? "bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-2 border-amber-300 cursor-not-allowed opacity-70"
                    : pendingTap
                      ? "bg-primary/60 text-primary-foreground cursor-wait"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl"
            )}
          >
            {isOnBreak
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
          {buildingCount > 0 && !isOnBreak && (
            <button
              onClick={handleUndo}
              className="mt-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl transition-colors"
            >
              Undo last batch
            </button>
          )}

          {/* Extra Pack secondary control */}
          {currentItem && (
            <ExtraPackControl
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
      <BreakTracker planId={plan.id} stationType={stationType} onBreakChange={handleBreakChange} onBreakActiveChange={setIsOnBreak} />

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

/** Convert any weight quantity to kg for arithmetic (g → ÷1000, everything else treated as kg) */
const toKg = (qty: number, unit: string): number =>
  unit === "g" ? qty / 1000 : unit === "mg" ? qty / 1_000_000 : qty;

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

function useNextActivePlan(afterDate?: string) {
  const [data, setData] = useState<NextActivePlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsLoading(true);
    const qs = afterDate ? `?afterDate=${afterDate}` : "";
    fetch(`/api/production-plans/next-active${qs}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: NextActivePlan) => { setData(json); initialLoadDone.current = true; setIsLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsLoading(false); } });
  }, [afterDate]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  return { data, isLoading };
}

// ──────────────────────────────────────────────────────────────────────────────
// Prep date banner
// ──────────────────────────────────────────────────────────────────────────────
function PrepDateBanner({
  currentPlanDate,
  targetPlanDate,
  targetPlanName,
  isLoading,
  activityLabel = "Prep",
}: {
  currentPlanDate?: string | null;
  targetPlanDate: string | null;
  targetPlanName: string | null;
  isLoading: boolean;
  activityLabel?: string;
}) {
  if (isLoading) return null;
  if (!targetPlanDate) return null;

  const targetFormatted = format(parseISO(targetPlanDate), "EEEE d MMMM");
  const currentFormatted = currentPlanDate
    ? format(parseISO(currentPlanDate), "EEEE d MMMM")
    : null;

  return (
    <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <CalendarCheck className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
      <div className="min-w-0">
        {currentFormatted ? (
          <>
            <p className="font-bold text-green-900 dark:text-green-100 text-base leading-snug">
              {activityLabel} on {currentFormatted}
            </p>
            <p className="text-sm text-green-700 dark:text-green-300 leading-snug">
              for production on <span className="font-semibold">{targetFormatted}</span>
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">{activityLabel} for</p>
            <p className="font-bold text-green-900 dark:text-green-100 text-lg leading-tight">{targetFormatted}</p>
          </>
        )}
        {targetPlanName && <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">{targetPlanName}</p>}
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
  currentPlanDate,
  targetPlanDate,
  targetPlanName,
  isLoadingPlan,
  stationLabel,
  stationColor,
  stationIcon: StationIcon,
  onOverviewClick,
}: {
  items: PrepFullScreenItem[];
  currentPlanDate?: string | null;
  targetPlanDate: string | null;
  targetPlanName: string | null;
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
      <PrepDateBanner currentPlanDate={currentPlanDate} targetPlanDate={targetPlanDate} targetPlanName={targetPlanName} isLoading={isLoadingPlan} />

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
  minCookingTempC: number | null;
  estimatedCookTimeMin: number | null;
  ovenTempC: number | null;
  steamPct: number | null;
  cookedQty: number;
  rawQty: number;
  isRawMeat: boolean;
  isSeasoning: boolean;
  trayCount: number | null;
}

interface PrepMarinadeDetail {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeIngredientName: string | null;
  marinadeSubRecipeId: number | null;
  marinadeSubRecipeName: string | null;
  gramsPerKg?: number;
  totalGrams: number;
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
  marinades?: PrepMarinadeDetail[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook: fetch per-recipe prep requirements for the next active plan
// ──────────────────────────────────────────────────────────────────────────────
function usePrepByRecipe(station: string, currentPlanId: number, afterDate?: string) {
  const { data: nextPlan, isLoading: isPlanLoading } = useNextActivePlan(afterDate) as { data: NextActivePlan | null; isLoading: boolean };
  const [recipes, setRecipes] = useState<PrepRecipeDetail[]>([]);
  const [isPrepLoading, setIsPrepLoading] = useState(false);
  const initialLoadDone = useRef(false);

  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    if (!currentPlanId) { setRecipes([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsPrepLoading(true);
    fetch(`/api/production-plans/${currentPlanId}/prep-requirements-by-recipe?station=${station}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: { recipes?: PrepRecipeDetail[] }) => {
        setRecipes(json.recipes ?? []); initialLoadDone.current = true; setIsPrepLoading(false);
      })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsPrepLoading(false); } });
  }, [currentPlanId, station]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    if (!currentPlanId) return;
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch, currentPlanId]);

  return {
    recipes,
    isLoading: isPlanLoading || (!!currentPlanId && isPrepLoading),
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
// Main Prep Station — all ingredients with per-recipe tin breakdowns + stock checks
// ──────────────────────────────────────────────────────────────────────────────
interface MainPrepIngredient {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  category: string | null;
  stockCheckEnabled: boolean;
  stockCheckFrequency: string;
  stockCheckDay: string | null;
  totalQty: number;
  totalTinCount: number;
  recipes: Array<{
    recipeId: number;
    recipeName: string;
    batchesTarget: number;
    qtyForRecipe: number;
    tinSize: string | null;
    maxBatchesPerTin: number | null;
    tinCount: number;
    qtyPerTin: number;
  }>;
}

interface PrepTinCompletion {
  id: number;
  ingredientId: number;
  recipeId: number | null;
  tinNumber: number;
  userId: number | null;
  userName: string | null;
  completedAt: string;
}

type PrepPresenceData = Record<number, { userId: number; userName: string }[]>;

interface StockCheckEntry {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  quantity: string | null;
  checkedAt: string;
  userId: number | null;
}

function useMainPrepData(planId: number) {
  const [data, setData] = useState<{ ingredients: MainPrepIngredient[]; completions: PrepTinCompletion[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setLoading(true);
    fetch(`/api/production-plans/${planId}/main-prep`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setData(d); initialLoadDone.current = true; setLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setLoading(false); } });
  }, [planId]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch]);

  const refetch = useCallback(() => doFetch(), [doFetch]);
  return { data, loading, refetch };
}

function MainPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const { data: nextPlanData, isLoading: isNextPlanLoading } = useNextActivePlan(plan.planDate);
  const nextPlan = nextPlanData as NextActivePlan | null;
  const targetPlanId = nextPlan?.planId ?? plan.id;
  const { data, loading, refetch } = useMainPrepData(targetPlanId);
  const [stockValues, setStockValues] = useState<Record<number, string>>({});
  const [savingStock, setSavingStock] = useState<Record<number, boolean>>({});
  const dirtyStockIds = useRef<Set<number>>(new Set());
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [presenceData, setPresenceData] = useState<PrepPresenceData>({});
  const activeIngIdRef = useRef<number | null>(null);

  const checkDate = nextPlan?.planDate ?? plan.planDate;

  useEffect(() => {
    setSelectedRecipeId(null);
    setStockValues({});
    dirtyStockIds.current.clear();
  }, [targetPlanId]);

  const fetchStockChecks = useCallback(() => {
    if (!checkDate) return;
    fetch(`/api/production-plans/stock-checks?date=${checkDate}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d?.checks) {
          const serverVals: Record<number, string> = {};
          for (const c of d.checks) {
            if (c.quantity) serverVals[c.ingredientId] = String(parseFloat(c.quantity));
          }
          setStockValues(prev => {
            const merged = { ...serverVals };
            for (const id of dirtyStockIds.current) {
              if (id in prev) merged[id] = prev[id];
            }
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [checkDate]);

  useEffect(() => {
    if (!checkDate) return;
    fetchStockChecks();
    const interval = setInterval(fetchStockChecks, 5000);
    return () => clearInterval(interval);
  }, [fetchStockChecks]);

  const postPresence = useCallback((ingredientId: number | null) => {
    fetch(`/api/production-plans/${targetPlanId}/prep-presence`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredientId }),
    }).catch(() => {});
  }, [targetPlanId]);

  // Poll presence every 10s
  useEffect(() => {
    const poll = () => {
      fetch(`/api/production-plans/${targetPlanId}/prep-presence`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) setPresenceData(d); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 10_000);
    return () => clearInterval(interval);
  }, [targetPlanId]);

  // Heartbeat presence every 15s
  useEffect(() => {
    const hb = setInterval(() => postPresence(activeIngIdRef.current), 15_000);
    return () => { clearInterval(hb); postPresence(null); };
  }, [postPresence]);

  const ingredients = data?.ingredients ?? [];
  const completions = data?.completions ?? [];

  // Shared completion: match by ingredientId + tinNumber only (no recipeId)
  const isCompleted = (ingredientId: number, tinNumber: number) =>
    completions.some(c => c.ingredientId === ingredientId && c.tinNumber === tinNumber);

  const getCompletion = (ingredientId: number, tinNumber: number) =>
    completions.find(c => c.ingredientId === ingredientId && c.tinNumber === tinNumber);

  const todayDayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date().getDay()];

  const stockCheckActiveToday = (ing: MainPrepIngredient): boolean => {
    if (!ing.stockCheckEnabled) return false;
    if (ing.stockCheckFrequency === "weekly") return ing.stockCheckDay === todayDayName;
    return true;
  };

  const ingredientDoneStatus = (ing: MainPrepIngredient) => {
    const totalTinCount = ing.totalTinCount;
    const completedTinCount = Array.from({ length: totalTinCount }, (_, i) => i + 1)
      .filter(tn => isCompleted(ing.ingredientId, tn)).length;
    const allTinsDone = totalTinCount > 0 && completedTinCount >= totalTinCount;
    const stockSaved = stockValues[ing.ingredientId] !== undefined && stockValues[ing.ingredientId] !== "";
    const activeStockCheck = stockCheckActiveToday(ing);
    const needsStockCheck = activeStockCheck && allTinsDone;
    const isFullyDone = allTinsDone && (!activeStockCheck || stockSaved);
    return { allTinsDone, needsStockCheck, stockSaved, isFullyDone, totalTinCount, completedTinCount };
  };

  // Build recipe groups from ingredient data
  const recipeGroups = useMemo(() => {
    const map = new Map<number, { recipeId: number; recipeName: string; ingredients: MainPrepIngredient[] }>();
    for (const ing of ingredients) {
      for (const r of ing.recipes) {
        if (!map.has(r.recipeId)) map.set(r.recipeId, { recipeId: r.recipeId, recipeName: r.recipeName, ingredients: [] });
        map.get(r.recipeId)!.ingredients.push(ing);
      }
    }
    return [...map.values()];
  }, [ingredients]);

  // Auto-select first recipe with incomplete ingredients
  useEffect(() => {
    if (recipeGroups.length === 0) return;
    if (selectedRecipeId && recipeGroups.find(r => r.recipeId === selectedRecipeId)) return;
    const firstIncomplete = recipeGroups.find(rg => rg.ingredients.some(ing => !ingredientDoneStatus(ing).isFullyDone));
    setSelectedRecipeId((firstIncomplete ?? recipeGroups[0]).recipeId);
  }, [recipeGroups]);

  const selectedRecipe = recipeGroups.find(r => r.recipeId === selectedRecipeId) ?? null;

  const toggleTin = async (ingredientId: number, tinNumber: number) => {
    if (isOnBreak) return;
    activeIngIdRef.current = ingredientId;
    postPresence(ingredientId);
    const existing = getCompletion(ingredientId, tinNumber);
    if (existing) {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions/by-tin`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, tinNumber }),
      });
    } else {
      await fetch(`/api/production-plans/${targetPlanId}/prep-completions`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, tinNumber }),
      });
    }
    refetch();
  };

  const saveStockCheck = async (ingredientId: number) => {
    const val = stockValues[ingredientId];
    if (val === undefined || val === "") return;
    setSavingStock(s => ({ ...s, [ingredientId]: true }));
    const cd = nextPlan?.planDate ?? plan.planDate;
    try {
      const resp = await fetch("/api/production-plans/stock-checks", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId, checkDate: cd, quantity: Number(val) }),
      });
      if (!resp.ok) throw new Error("Save failed");
      dirtyStockIds.current.delete(ingredientId);
      toast({ title: "Stock check saved" });
      refetch();
    } catch {
      toast({ title: "Failed to save stock check", variant: "destructive" });
    } finally {
      setSavingStock(s => ({ ...s, [ingredientId]: false }));
    }
  };

  const totalTins = ingredients.reduce((s, ing) => s + ing.totalTinCount, 0);
  const completedTins = completions.length;
  const overallPct = totalTins > 0 ? Math.round((completedTins / totalTins) * 100) : 0;

  if (loading || isNextPlanLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <PrepDateBanner
        currentPlanDate={plan.planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
        isLoading={false}
      />

      <PrepSubNav planId={plan.id} current="main_prep" />

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-6 h-6 text-emerald-600" />
            <div>
              <h2 className="font-semibold text-base">Main Prep</h2>
              <p className="text-xs text-muted-foreground">{completedTins} of {totalTins} tins completed</p>
            </div>
          </div>
          <span className="text-2xl font-bold font-display">{overallPct}%</span>
        </div>
        <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", overallPct >= 100 ? "bg-emerald-500" : "bg-emerald-400")}
            style={{ width: `${Math.min(overallPct, 100)}%` }}
          />
        </div>
      </div>

      {ingredients.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No ingredients to prep</p>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          {/* LEFT — Recipe list */}
          <div className="lg:w-72 xl:w-80 flex-shrink-0">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
              </div>
              <div className="divide-y divide-border/50 max-h-[calc(100vh-280px)] overflow-y-auto">
                {recipeGroups.map(rg => {
                  const rgTotalTins = rg.ingredients.reduce((s, ing) => s + ing.totalTinCount, 0);
                  const rgDoneTins = rg.ingredients.reduce((s, ing) =>
                    s + Array.from({ length: ing.totalTinCount }, (_, i) => i + 1).filter(tn => isCompleted(ing.ingredientId, tn)).length, 0);
                  const rgPct = rgTotalTins > 0 ? Math.round((rgDoneTins / rgTotalTins) * 100) : 0;
                  const allDone = rgTotalTins > 0 && rgDoneTins >= rgTotalTins;
                  const isSelected = rg.recipeId === selectedRecipeId;
                  const hasPresence = rg.ingredients.some(ing => (presenceData[ing.ingredientId] ?? []).length > 0);
                  return (
                    <button
                      key={rg.recipeId}
                      onClick={() => setSelectedRecipeId(rg.recipeId)}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                        isSelected
                          ? "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                          : "hover:bg-secondary/40 border-l-4 border-l-transparent",
                        allDone && !isSelected && "opacity-60"
                      )}
                    >
                      {allDone ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <div className="relative w-5 h-5 flex-shrink-0">
                          <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
                            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" className="text-border" />
                            {rgTotalTins > 0 && (
                              <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
                                className="text-emerald-500"
                                strokeDasharray={`${(rgDoneTins / rgTotalTins) * 50.26} 50.26`}
                              />
                            )}
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          "text-sm font-medium truncate",
                          isSelected && "font-semibold",
                          allDone && "line-through text-muted-foreground"
                        )}>
                          {rg.recipeName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {rg.ingredients.length} ingredient{rg.ingredients.length !== 1 ? "s" : ""} · {rgDoneTins}/{rgTotalTins} tins
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {hasPresence && (
                          <span className="text-xs text-blue-500">👁</span>
                        )}
                        <span className={cn(
                          "text-xs font-semibold tabular-nums",
                          allDone ? "text-emerald-600" : isSelected ? "text-emerald-700" : "text-muted-foreground"
                        )}>
                          {rgPct}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT — Ingredients for selected recipe */}
          <div className="flex-1 min-w-0">
            {selectedRecipe ? (
              <div className="space-y-3">
                {selectedRecipe.ingredients.map(ing => {
                  const status = ingredientDoneStatus(ing);
                  const presence = presenceData[ing.ingredientId] ?? [];
                  const isShared = ing.recipes.length > 1;
                  const otherRecipes = ing.recipes.filter(r => r.recipeId !== selectedRecipeId);
                  const tins = Array.from({ length: ing.totalTinCount }, (_, i) => i + 1);
                  const qtyPerTin = ing.totalTinCount > 0 ? ing.totalQty / ing.totalTinCount : ing.totalQty;
                  return (
                    <div
                      key={ing.ingredientId}
                      className={cn(
                        "bg-card border-2 rounded-2xl p-5 transition-colors",
                        status.isFullyDone
                          ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/20 dark:bg-emerald-950/10"
                          : status.needsStockCheck
                            ? "border-blue-300 dark:border-blue-700"
                            : "border-border"
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {status.isFullyDone ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            ) : status.needsStockCheck ? (
                              <Package className="w-5 h-5 text-blue-500 flex-shrink-0 animate-pulse" />
                            ) : null}
                            <h3 className={cn(
                              "font-bold text-lg leading-tight",
                              status.isFullyDone && "line-through text-muted-foreground"
                            )}>
                              {ing.ingredientName}
                            </h3>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            <span className="font-semibold text-foreground">{fmtQty(ing.totalQty, ing.unit)}</span>
                            {" total · "}{status.completedTinCount}/{status.totalTinCount} tins done
                          </p>
                          {isShared && otherRecipes.length > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                              <span className="font-medium">Shared —</span>
                              {" also in: "}{otherRecipes.map(r => r.recipeName).join(", ")}
                            </p>
                          )}
                          {presence.length > 0 && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                              👁 <span className="font-medium">{presence.map(p => p.userName).join(", ")}</span> also viewing this
                            </p>
                          )}
                        </div>
                        {status.totalTinCount > 0 && (
                          <div className="ml-4 flex-shrink-0 text-right">
                            <p className={cn(
                              "text-3xl font-bold font-display tabular-nums",
                              status.isFullyDone ? "text-emerald-600" : "text-foreground"
                            )}>
                              {status.completedTinCount}
                              <span className="text-base text-muted-foreground font-normal">/{status.totalTinCount}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">tins</p>
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      {status.totalTinCount > 1 && (
                        <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-3">
                          <div
                            className={cn("h-full rounded-full transition-all", status.allTinsDone ? "bg-emerald-500" : "bg-emerald-400")}
                            style={{ width: `${status.totalTinCount > 0 ? Math.min((status.completedTinCount / status.totalTinCount) * 100, 100) : 0}%` }}
                          />
                        </div>
                      )}

                      {/* Tin buttons */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                        {tins.map(tn => {
                          const done = isCompleted(ing.ingredientId, tn);
                          const completion = getCompletion(ing.ingredientId, tn);
                          return (
                            <button
                              key={tn}
                              onClick={() => toggleTin(ing.ingredientId, tn)}
                              disabled={isOnBreak}
                              className={cn(
                                "relative flex flex-col items-center border-2 rounded-2xl px-3 py-3.5 transition-all active:scale-95",
                                isOnBreak ? "opacity-50 cursor-not-allowed" : "",
                                done
                                  ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600 shadow-sm"
                                  : "bg-background border-border hover:border-emerald-400 hover:shadow-md"
                              )}
                            >
                              <div className="flex items-center gap-1.5 mb-1.5">
                                {done ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40" />
                                )}
                                <span className="text-sm font-bold">Tin {tn}</span>
                              </div>
                              <span className={cn("text-lg font-bold tabular-nums", done ? "text-emerald-700 dark:text-emerald-300" : "text-foreground")}>
                                {fmtQty(qtyPerTin, ing.unit)}
                              </span>
                              {done && completion && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 leading-tight text-center">
                                  {completion.userName ?? "User"} · {format(new Date(completion.completedAt), "HH:mm")}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Stock check */}
                      {status.needsStockCheck && (
                        <div className="mt-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <Package className="w-4 h-4 text-blue-600 animate-pulse" />
                            <p className="text-sm font-bold text-blue-800 dark:text-blue-200">Stock Check</p>
                            <p className="text-xs text-blue-600 dark:text-blue-400">— how much {ing.ingredientName.toLowerCase()} remains?</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number" step="0.01"
                              placeholder={`Remaining ${ing.unit}`}
                              className="flex-1 max-w-[160px] text-base border-2 border-blue-300 dark:border-blue-600 rounded-lg px-3 py-2 text-right bg-background focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                              value={stockValues[ing.ingredientId] ?? ""}
                              onChange={e => { dirtyStockIds.current.add(ing.ingredientId); setStockValues(v => ({ ...v, [ing.ingredientId]: e.target.value })); }}
                              onKeyDown={e => { if (e.key === "Enter") saveStockCheck(ing.ingredientId); }}
                            />
                            <span className="text-sm text-muted-foreground">{ing.unit}</span>
                            <button
                              onClick={() => saveStockCheck(ing.ingredientId)}
                              disabled={!stockValues[ing.ingredientId] || savingStock[ing.ingredientId]}
                              className={cn(
                                "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                                stockValues[ing.ingredientId]
                                  ? "bg-blue-600 text-white hover:bg-blue-700 shadow active:scale-95"
                                  : "bg-blue-200 text-blue-400 cursor-not-allowed"
                              )}
                            >
                              {savingStock[ing.ingredientId] ? <Loader2 className="w-4 h-4 animate-spin" /> : status.stockSaved ? <Check className="w-4 h-4" /> : "Save"}
                            </button>
                          </div>
                          {status.stockSaved && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {stockValues[ing.ingredientId]} {ing.unit} recorded
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-card border-2 border-dashed border-border rounded-2xl p-12 flex flex-col items-center justify-center text-muted-foreground">
                <ClipboardList className="w-12 h-12 mb-3 opacity-40" />
                <p className="font-medium">Select a recipe to view its ingredients</p>
              </div>
            )}
          </div>
        </div>
      )}

      <BreakTracker planId={targetPlanId} stationType="main_prep" onBreakActiveChange={setIsOnBreak} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
function PrepVegStation({ plan }: { plan: ProductionPlanDetail }) {
  const [mode, setMode] = useState<"fullscreen" | "overview">("fullscreen");
  const [isOnBreak, setIsOnBreak] = useState(false);
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_veg", plan.id, plan.planDate);

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
        currentPlanDate={plan.planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
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
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />
      <PrepSubNav planId={plan.id} current="prep_veg" />
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

      <BreakTracker planId={plan.id} stationType="prep_veg" onBreakActiveChange={setIsOnBreak} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Bases & Sauces Prep Station
// Left: recipe list overview. Right: focused ingredient detail for selected recipe.
// ──────────────────────────────────────────────────────────────────────────────
function PrepBasesStation({ plan }: { plan: ProductionPlanDetail }) {
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_bases", plan.id, plan.planDate);

  // Auto-select first recipe
  useEffect(() => {
    if (recipes.length > 0 && (selectedRecipeId === null || !recipes.some(r => r.recipeId === selectedRecipeId))) {
      setSelectedRecipeId(recipes[0].recipeId);
    }
  }, [recipes, selectedRecipeId]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (recipes.length === 0) {
    return (
      <div className="space-y-4">
        <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />
        <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
          <p className="font-medium">No base/sauce/cheese ingredients to prep</p>
          <p className="text-sm mt-1">Assign ingredient categories: "base", "sauce", or "cheese"</p>
        </div>
      </div>
    );
  }

  const selected = recipes.find(r => r.recipeId === selectedRecipeId) ?? recipes[0];
  const totalIngCount = recipes.reduce((s, r) => s + r.ingredients.length, 0);

  return (
    <div className="space-y-4">
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />

      <PrepSubNav planId={plan.id} current="prep_bases" />

      {/* Summary bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-yellow-500" />
            <div>
              <h2 className="font-semibold text-base">Bases & Sauces</h2>
              <p className="text-xs text-muted-foreground">
                {recipes.length} recipe{recipes.length !== 1 ? "s" : ""} · {totalIngCount} ingredient{totalIngCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Left: recipe list */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
            </div>
            <div className="divide-y divide-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              {recipes.map(recipe => {
                const isSelected = recipe.recipeId === selected.recipeId;
                return (
                  <button
                    key={recipe.recipeId}
                    onClick={() => setSelectedRecipeId(recipe.recipeId)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      isSelected
                        ? "bg-yellow-50/80 dark:bg-yellow-900/20 border-l-4 border-l-yellow-500"
                        : "hover:bg-secondary/40 border-l-4 border-l-transparent"
                    )}
                  >
                    <Layers className={cn("w-5 h-5 flex-shrink-0", isSelected ? "text-yellow-500" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium truncate", isSelected && "font-semibold")}>{recipe.recipeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
                        {recipe.tinCount != null && ` · ${recipe.tinCount} tin${recipe.tinCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{recipe.batchesTarget}×</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: selected recipe detail */}
        <div className="flex-1 min-w-0">
          <div className="bg-card border-2 border-yellow-400 dark:border-yellow-600 rounded-2xl p-6">

            {/* Header */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Currently Prepping</p>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-3xl font-bold leading-tight">{selected.recipeName}</h2>
                {selected.sopUrl && (
                  <a href={selected.sopUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 mt-1">
                    SOP <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <p className="text-sm text-muted-foreground">{selected.batchesTarget} batch{selected.batchesTarget !== 1 ? "es" : ""}</p>
                {selected.tinCount != null && (
                  <span className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-full px-3 py-0.5 text-sm font-semibold">
                    {selected.tinCount} tin{selected.tinCount !== 1 ? "s" : ""}
                  </span>
                )}
                {selected.tinSize && (
                  <span className="text-sm text-muted-foreground">{selected.tinSize}</span>
                )}
                {selected.maxBatchesPerTin && (
                  <span className="text-sm text-muted-foreground">{selected.maxBatchesPerTin} batches/tin</span>
                )}
              </div>
            </div>

            {/* Ingredient rows */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Ingredients</p>
              <div className="space-y-2">
                {selected.ingredients.map((ing, idx) => (
                  <div
                    key={ing.ingredientId}
                    className={cn(
                      "flex items-center justify-between px-5 py-4 rounded-xl border",
                      idx === 0
                        ? "border-yellow-300 dark:border-yellow-700 bg-yellow-50/50 dark:bg-yellow-900/10"
                        : "border-border bg-background"
                    )}
                  >
                    <p className="font-medium text-base">{ing.ingredientName}</p>
                    <p className="text-2xl font-bold tabular-nums text-yellow-700 dark:text-yellow-300">
                      {fmtQty(ing.cookedQty, ing.unit)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Navigate to next recipe */}
            {recipes.length > 1 && (() => {
              const currentIdx = recipes.findIndex(r => r.recipeId === selected.recipeId);
              const nextRecipe = recipes[(currentIdx + 1) % recipes.length];
              return (
                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setSelectedRecipeId(nextRecipe.recipeId)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/20 font-medium text-sm transition-colors"
                  >
                    Next: {nextRecipe.recipeName} →
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <BreakTracker planId={plan.id} stationType="prep_bases" onBreakActiveChange={setIsOnBreak} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Meat Prep Station
// Left: recipe list. Right: selected recipe detail with ingredient breakdown.
// ──────────────────────────────────────────────────────────────────────────────
function PrepMeatStation({ plan }: { plan: ProductionPlanDetail }) {
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<number | null>(null);
  const { recipes, isLoading, nextPlan } = usePrepByRecipe("prep_meat", plan.id, plan.planDate);

  const totalTrays = recipes.reduce((sum, r) => sum + (r.trayCount ?? 0), 0);

  // Auto-select first recipe
  useEffect(() => {
    if (recipes.length > 0 && (selectedRecipeId === null || !recipes.some(r => r.recipeId === selectedRecipeId))) {
      setSelectedRecipeId(recipes[0].recipeId);
    }
  }, [recipes, selectedRecipeId]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading…</div>;
  }

  if (recipes.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">
        <p className="font-medium">No raw meat ingredients to prep</p>
        <p className="text-sm mt-1">Set ingredient category to "raw_meat" in the ingredients library</p>
      </div>
    );
  }

  const selected = recipes.find(r => r.recipeId === selectedRecipeId) ?? recipes[0];
  const selRawMeat = selected.ingredients.filter(i => i.isRawMeat);
  const selMarinades = selected.marinades ?? [];
  const selTotalRawKg = selRawMeat.reduce((sum, i) => sum + toKg(i.rawQty, i.unit), 0);
  const selTotalMarinadeG = selMarinades.reduce((sum, m) => sum + m.totalGrams, 0);
  const selTrays = selected.trayCount;
  const selTrayCapKg = selRawMeat.find(i => i.rawMeatTrayCapacityKg)?.rawMeatTrayCapacityKg ?? null;

  return (
    <div className="space-y-4">
      <PrepDateBanner currentPlanDate={plan.planDate} targetPlanDate={nextPlan?.planDate ?? null} targetPlanName={nextPlan?.planName ?? null} isLoading={false} />

      <PrepSubNav planId={plan.id} current="prep_meat" />

      {/* Summary bar */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Beef className="w-6 h-6 text-rose-500" />
          <div>
            <h2 className="font-semibold text-base">Raw Meat Prep</h2>
            <p className="text-xs text-muted-foreground">{recipes.length} recipe{recipes.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        {totalTrays > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total Trays</p>
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{totalTrays}</p>
          </div>
        )}
      </div>

      {/* Split panel */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Left: recipe list */}
        <div className="lg:w-72 xl:w-80 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipes</p>
            </div>
            <div className="divide-y divide-border/50 max-h-[calc(100vh-320px)] overflow-y-auto">
              {recipes.map(recipe => {
                const rRawMeat = recipe.ingredients.filter(i => i.isRawMeat);
                const rTotalKg = rRawMeat.reduce((s, i) => s + toKg(i.rawQty, i.unit), 0);
                const isSelected = recipe.recipeId === selected.recipeId;
                return (
                  <button
                    key={recipe.recipeId}
                    onClick={() => setSelectedRecipeId(recipe.recipeId)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      isSelected
                        ? "bg-rose-50/80 dark:bg-rose-900/20 border-l-4 border-l-rose-500"
                        : "hover:bg-secondary/40 border-l-4 border-l-transparent"
                    )}
                  >
                    <Beef className={cn("w-5 h-5 flex-shrink-0", isSelected ? "text-rose-500" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm font-medium truncate", isSelected && "font-semibold")}>{recipe.recipeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {rTotalKg.toFixed(2)} kg
                        {recipe.trayCount != null && ` · ${recipe.trayCount} tray${recipe.trayCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground flex-shrink-0">{recipe.batchesTarget}×</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: selected recipe detail */}
        <div className="flex-1 min-w-0">
          <div className="bg-card border-2 border-rose-400 dark:border-rose-600 rounded-2xl p-6">

            {/* Header */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Currently Prepping</p>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-3xl font-bold leading-tight">{selected.recipeName}</h2>
                {selected.sopUrl && (
                  <a href={selected.sopUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 mt-1">
                    SOP <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{selected.batchesTarget} batch{selected.batchesTarget !== 1 ? "es" : ""}</p>
            </div>

            {/* Summary bar — total trays across all meats */}
            {selTrays != null && selTrays > 0 && (
              <div className="flex items-center gap-4 bg-rose-50 dark:bg-rose-900/20 rounded-xl px-5 py-3 mb-5">
                <div className="text-center min-w-[56px]">
                  <p className="text-4xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400 leading-none">{selTrays}</p>
                  <p className="text-xs font-medium text-rose-700 dark:text-rose-300 mt-0.5">total tray{selTrays !== 1 ? "s" : ""}</p>
                </div>
                <div className="h-8 w-px bg-rose-200 dark:bg-rose-700" />
                <div>
                  <p className="text-sm font-semibold tabular-nums">{selTotalRawKg.toFixed(2)} kg raw meat</p>
                  {selTotalMarinadeG > 0 && (
                    <p className="text-xs text-muted-foreground">+ {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(2)} kg` : `${selTotalMarinadeG}g`} marinade</p>
                  )}
                  {selRawMeat.length > 1 && <p className="text-xs text-rose-600 dark:text-rose-400 font-medium mt-0.5">across {selRawMeat.length} meat types — see breakdown below</p>}
                </div>
              </div>
            )}

            {/* No tray capacity warning */}
            {(selTrays == null || selTrays === 0) && (
              <div className="mb-5 space-y-3">
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Raw Meat</p>
                    <p className="text-5xl font-bold font-display tabular-nums text-rose-600 dark:text-rose-400">
                      {selTotalRawKg.toFixed(2)}
                      <span className="text-2xl font-normal ml-1 text-muted-foreground">kg</span>
                    </p>
                  </div>
                  {selTotalMarinadeG > 0 && (
                    <div className="text-center">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Marinade</p>
                      <p className="text-3xl font-bold font-display tabular-nums text-orange-500">
                        {selTotalMarinadeG >= 1000 ? `${(selTotalMarinadeG / 1000).toFixed(2)}` : selTotalMarinadeG}
                        <span className="text-xl font-normal ml-1 text-muted-foreground">{selTotalMarinadeG >= 1000 ? "kg" : "g"}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
                  <span className="mt-0.5">⚠️</span>
                  <span>Tray count not set — add a <strong>Tray Capacity (kg)</strong> to this recipe's raw meat ingredients in the Ingredients Library to see per-tray breakdown.</span>
                </div>
              </div>
            )}

            {/* Per-ingredient tray cards */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {selTrays != null && selTrays > 0 ? "Per Meat — Tray Breakdown" : "Ingredients"}
              </p>
              {selRawMeat.map(ing => {
                const meatMarinades = selMarinades.filter(m => m.rawMeatIngredientId === ing.ingredientId);
                const ingKgTotal = toKg(ing.rawQty, ing.unit);
                const ingTrays = ing.trayCount;
                const perTrayKg = ingTrays && ingTrays > 0 ? ingKgTotal / ingTrays : null;
                const ingMarinadeG = meatMarinades.reduce((s, m) => s + m.totalGrams, 0);
                return (
                  <div key={ing.ingredientId} className="rounded-xl border-2 border-rose-200 dark:border-rose-800 overflow-hidden">
                    {/* Meat header with its own tray count */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-rose-50 dark:bg-rose-900/20">
                      {ingTrays != null && ingTrays > 0 ? (
                        <>
                          <div className="text-center bg-rose-600 text-white rounded-lg px-3 py-1.5 min-w-[52px]">
                            <p className="text-2xl font-bold font-display tabular-nums leading-none">{ingTrays}</p>
                            <p className="text-xs opacity-80">tray{ingTrays !== 1 ? "s" : ""}</p>
                          </div>
                          <div className="flex-1">
                            <p className="font-semibold">{ing.ingredientName}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {ingKgTotal.toFixed(2)} kg total
                              {ing.rawMeatTrayCapacityKg && ` · ${ing.rawMeatTrayCapacityKg} kg cap`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300 leading-none">{perTrayKg!.toFixed(2)} kg</p>
                            <p className="text-xs text-muted-foreground mt-0.5">per tray</p>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-between">
                          <p className="font-semibold">{ing.ingredientName}</p>
                          <p className="tabular-nums font-bold text-base text-rose-600 dark:text-rose-400">{ingKgTotal.toFixed(2)} kg</p>
                        </div>
                      )}
                    </div>
                    {/* Marinade sub-rows */}
                    {meatMarinades.map((m, mi) => {
                      const name = m.marinadeIngredientName ?? m.marinadeSubRecipeName ?? "Unknown";
                      const perTrayG = ingTrays && ingTrays > 0 ? Math.round(m.totalGrams / ingTrays) : null;
                      return (
                        <div key={mi} className="flex items-center justify-between px-4 py-2 border-t border-rose-100 dark:border-rose-900/40 text-sm text-muted-foreground bg-white dark:bg-background/50">
                          <span className="flex items-center gap-2">
                            <span className="text-rose-400">↳</span>
                            <span>{name}</span>
                          </span>
                          <div className="text-right">
                            {perTrayG != null ? (
                              <>
                                <span className="tabular-nums font-semibold text-foreground">{perTrayG}g / tray</span>
                                <p className="text-xs text-muted-foreground">{m.totalGrams}g total</p>
                              </>
                            ) : (
                              <span className="tabular-nums font-medium text-foreground">{m.totalGrams}g</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <BreakTracker planId={plan.id} stationType="prep_meat" onBreakActiveChange={setIsOnBreak} />
    </div>
  );
}

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
  extraBalls?: {
    extraPack: { count: number; weightG: number };
    snack: { count: number; weightG: number };
    totalKg: number;
  };
}

function useDoughPrepData(planId: number, mode?: "current") {
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

function DoughPrepStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const { data: doughData, loading: doughLoading } = useDoughPrepData(plan.id);
  const [activeMix, setActiveMix] = useState<number>(1);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [activeView, setActiveView] = useState<DoughView>("mixing");
  const [checkedIngredients, setCheckedIngredients] = useState<Record<number, Set<string>>>({});
  const [completedMixes, setCompletedMixes] = useState<Set<number>>(new Set());

  const createBatch = useCreateBatchCompletion({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) }),
    },
  });

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);
  const totalBatchesTarget = items.reduce((s, it) => s + (it.batchesTarget ?? 0), 0);
  const totalComplete = items.reduce((s, it) => s + getStationCount(it, "dough_prep"), 0);
  const overallPct = totalBatchesTarget > 0 ? Math.round((totalComplete / totalBatchesTarget) * 100) : 0;
  const mixCount = doughData?.mixCount ?? 0;

  const hasServerProgress = totalComplete > 0;
  const hasAnyMixDone = completedMixes.size > 0 || hasServerProgress;
  const BALLS_PER_TRAY = 4;

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

  const totalBallsNeeded = totalBatchesTarget;
  const ballCount = totalComplete;
  const allBallingDone = ballCount >= totalBallsNeeded;
  const totalTraysNeeded = totalBallsNeeded / BALLS_PER_TRAY;
  const traysDone = ballCount / BALLS_PER_TRAY;

  const addBalls = (count: number) => {
    if (isOnBreak || !doughData) return;
    let toAdd = count;
    for (const recipe of doughData.recipes) {
      if (toAdd <= 0) break;
      const item = items.find(it => it.recipeId === recipe.recipeId);
      if (!item) continue;
      const done = getStationCount(item, "dough_prep");
      const needed = recipe.ballCount - done;
      if (needed <= 0) continue;
      const adding = Math.min(toAdd, needed);
      for (let i = 0; i < adding; i++) {
        addBatch(item);
      }
      toAdd -= adding;
    }
  };

  const undoBall = () => {
    if (isOnBreak || ballCount <= 0) return;
    const lastItemWithCount = [...items].reverse().find(it => getStationCount(it, "dough_prep") > 0);
    if (lastItemWithCount) {
      removeBatch(lastItemWithCount);
    }
  };

  const removeBalls = (count: number) => {
    if (isOnBreak || ballCount <= 0) return;
    let toRemove = Math.min(count, ballCount);
    for (const item of [...items].reverse()) {
      if (toRemove <= 0) break;
      const done = getStationCount(item, "dough_prep");
      if (done <= 0) continue;
      const removing = Math.min(toRemove, done);
      for (let i = 0; i < removing; i++) {
        removeBatch(item);
      }
      toRemove -= removing;
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

      <div className="flex items-center gap-2 justify-end">
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

      <BreakTracker planId={plan.id} stationType="dough_prep" onBreakActiveChange={setIsOnBreak} />

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
          totalBatchesTarget={totalBatchesTarget}
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

          <button
            onClick={() => hasAnyMixDone ? setActiveView("balling") : toast({ title: "Complete a mix first", description: "Balling starts after the first mix is done." })}
            disabled={!hasAnyMixDone}
            className={cn(
              "w-full border-2 rounded-2xl p-4 transition-all text-left",
              !hasAnyMixDone
                ? "border-border/50 bg-secondary/20 opacity-50"
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
                <button
                  onClick={(e) => { e.stopPropagation(); undoBall(); }}
                  disabled={ballCount === 0 || isOnBreak}
                  className="h-10 w-10 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); addBalls(1); }}
                  disabled={isOnBreak}
                  className={cn(
                    "h-10 px-5 rounded-xl text-sm font-bold transition-all",
                    isOnBreak
                      ? "bg-secondary text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                  )}
                >
                  + 1 Ball
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeBalls(BALLS_PER_TRAY); }}
                  disabled={ballCount < BALLS_PER_TRAY || isOnBreak}
                  className="h-10 px-4 rounded-xl text-sm font-bold transition-all border border-border bg-background hover:bg-secondary/60 disabled:opacity-30"
                >
                  − 1 Tray
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); addBalls(4); }}
                  disabled={isOnBreak}
                  className={cn(
                    "h-10 px-5 rounded-xl text-sm font-bold transition-all",
                    isOnBreak
                      ? "bg-secondary text-muted-foreground"
                      : "bg-primary/90 text-primary-foreground hover:bg-primary/80 active:scale-95"
                  )}
                >
                  + 1 Tray
                </button>
              </div>
            )}
          </button>
        </>
      ) : (
        <>
          <DoughBallingView
            planId={plan.id}
            doughData={doughData}
            ballCount={ballCount}
            totalBallsNeeded={totalBallsNeeded}
            allBallingDone={allBallingDone}
            addBalls={addBalls}
            undoBall={undoBall}
            removeBalls={removeBalls}
            getBallAllocation={getBallAllocation}
            isOnBreak={isOnBreak}
            traysDone={traysDone}
            totalTraysNeeded={totalTraysNeeded}
            ballsPerTray={BALLS_PER_TRAY}
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
    return `${qty.toFixed(2)} kg`;
  }
  if (unit === "g") {
    return isYeast ? `${qty.toFixed(1)}g` : `${Math.round(qty)}g`;
  }
  return `${qty.toFixed(2)} ${unit}`;
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
                  "w-10 h-10 rounded-full text-sm font-bold transition-all",
                  activeMix === n
                    ? done
                      ? "bg-emerald-500 text-white ring-2 ring-emerald-300"
                      : "bg-primary text-primary-foreground ring-2 ring-primary/30"
                    : done
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                )}
              >
                {done ? <Check className="w-4 h-4 mx-auto" /> : n}
              </button>
            );
          })}
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {completedMixes.size} of {mixCount} mixes done
          </p>
          <p className="text-xs text-muted-foreground">
            {(doughData.flourPerMix ?? 0).toFixed(1)} kg flour → ~{(doughData.doughPerMix ?? 0).toFixed(1)} kg dough
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
            <h2 className="font-display text-xl font-bold">Mix {activeMix}</h2>
            <p className="text-sm text-muted-foreground">
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
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all border-2",
                  isChecked
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-border bg-background"
                )}>
                  {isChecked && <Check className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "font-semibold text-base",
                    isChecked && "line-through text-muted-foreground"
                  )}>
                    {ing.ingredientName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ing.pctOfDough > 0 ? `${ing.pctOfDough}%` : "<0.1%"} of dough
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={cn(
                    "text-xl font-bold tabular-nums",
                    isChecked ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
                  )}>
                    {fmtDoughQty(ing.qtyPerMix, ing.unit, ing.ingredientName)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Day total: {fmtDoughQty(ing.totalQty, ing.unit, ing.ingredientName)}
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
  planId, doughData, ballCount, totalBallsNeeded, allBallingDone,
  addBalls, undoBall, removeBalls, getBallAllocation, isOnBreak,
  traysDone, totalTraysNeeded, ballsPerTray,
}: {
  planId: number;
  doughData: DoughPrepData;
  ballCount: number;
  totalBallsNeeded: number;
  allBallingDone: boolean;
  addBalls: (n: number) => void;
  undoBall: () => void;
  removeBalls: (n: number) => void;
  getBallAllocation: () => Array<{ recipeId: number; recipeName: string; ballCount: number; ballWeightG: number; portionsPerBatch: number; ballsDone: number }>;
  isOnBreak: boolean;
  traysDone: number;
  totalTraysNeeded: number;
  ballsPerTray: number;
}) {
  // Extra ball tick state — stored in app_settings as JSON
  const settingsKey = `extra_balls_balled_${planId}`;
  const [extraTicks, setExtraTicks] = useState<Record<string, boolean>>({});
  const [ticksLoaded, setTicksLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/app-settings/${settingsKey}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.value) {
          try { setExtraTicks(JSON.parse(d.value)); } catch { /* ignore */ }
        }
        setTicksLoaded(true);
      })
      .catch(() => setTicksLoaded(true));
  }, [settingsKey]);

  const saveTicks = (updated: Record<string, boolean>) => {
    fetch(`/api/app-settings/${settingsKey}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(updated) }),
    }).catch(() => {});
  };

  const toggleTick = (key: string) => {
    const updated = { ...extraTicks, [key]: !extraTicks[key] };
    setExtraTicks(updated);
    saveTicks(updated);
  };

  const extraBalls = doughData.extraBalls;
  const extraItems: Array<{ key: string; label: string; weightG: number }> = [];
  if (extraBalls) {
    for (let i = 0; i < extraBalls.extraPack.count; i++) {
      extraItems.push({ key: `extraPack_${i}`, label: `Extra Pack Ball ${extraBalls.extraPack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.extraPack.weightG });
    }
    for (let i = 0; i < extraBalls.snack.count; i++) {
      extraItems.push({ key: `snack_${i}`, label: `Snack Ball ${extraBalls.snack.count > 1 ? i + 1 : ""}`.trim(), weightG: extraBalls.snack.weightG });
    }
  }
  const allExtraTicked = extraItems.length > 0 && extraItems.every(e => extraTicks[e.key]);

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
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Balls</p>
            <p className={cn(
              "font-display text-5xl font-bold tabular-nums",
              allBallingDone ? "text-emerald-600" : "text-foreground"
            )}>
              {ballCount}
            </p>
            <p className="text-sm text-muted-foreground">of {totalBallsNeeded}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Trays</p>
            <p className={cn(
              "font-display text-5xl font-bold tabular-nums",
              allBallingDone ? "text-emerald-600" : "text-foreground"
            )}>
              {fmtTrays(traysDone)}
            </p>
            <p className="text-sm text-muted-foreground">of {fmtTrays(totalTraysNeeded)}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Each ball = {doughData.recipes[0]?.ballWeightG ?? 0}g · {ballsPerTray} balls per tray
        </p>

        <div className="w-full h-3 bg-secondary rounded-full overflow-hidden mb-6">
          <div
            className={cn("h-full rounded-full transition-all", allBallingDone ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${Math.min(ballPct, 100)}%` }}
          />
        </div>

        {!allBallingDone ? (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={undoBall}
              disabled={ballCount === 0 || isOnBreak}
              className="w-14 h-14 flex items-center justify-center rounded-2xl border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-all"
            >
              <Minus className="w-6 h-6" />
            </button>
            <button
              onClick={() => addBalls(1)}
              disabled={isOnBreak}
              className={cn(
                "h-16 px-8 rounded-2xl text-lg font-bold transition-all shadow-lg",
                isOnBreak
                  ? "bg-secondary text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20 active:scale-95"
              )}
            >
              + 1 Ball
            </button>
            <button
              onClick={() => removeBalls(ballsPerTray)}
              disabled={ballCount < ballsPerTray || isOnBreak}
              className="h-16 px-6 rounded-2xl text-lg font-bold transition-all border-2 border-border bg-background hover:bg-secondary/60 disabled:opacity-30"
            >
              − 1 Tray
            </button>
            <button
              onClick={() => addBalls(4)}
              disabled={isOnBreak}
              className={cn(
                "h-16 px-8 rounded-2xl text-lg font-bold transition-all shadow-lg",
                isOnBreak
                  ? "bg-secondary text-muted-foreground"
                  : "bg-primary/90 text-primary-foreground hover:bg-primary/80 shadow-primary/20 active:scale-95"
              )}
            >
              + 1 Tray
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
            <span className="text-lg font-semibold">All balls complete!</span>
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
                  <span className={cn("font-semibold text-sm", done && "text-muted-foreground line-through")}>
                    {r.recipeName}
                  </span>
                  {done && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                </div>
                <div className="text-right">
                  <span className="text-sm tabular-nums">
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
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{r.ballWeightG}g per ball</span>
                <span className="font-medium text-primary">
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
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">Daily Extras</span>
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
                "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
                extraTicks[item.key]
                  ? "bg-emerald-500 border-emerald-500"
                  : "border-border bg-background"
              )}>
                {extraTicks[item.key] && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={cn("text-sm font-medium flex-1", extraTicks[item.key] && "line-through text-muted-foreground")}>
                {item.label}
              </span>
              <span className="text-xs text-muted-foreground">{item.weightG}g</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DoughOverview({
  doughData, items, completedMixes, mixCount,
  ballCount, totalBallsNeeded, overallPct, totalComplete, totalBatchesTarget,
}: {
  doughData: DoughPrepData;
  items: ProductionPlanItem[];
  completedMixes: Set<number>;
  mixCount: number;
  ballCount: number;
  totalBallsNeeded: number;
  overallPct: number;
  totalComplete: number;
  totalBatchesTarget: number;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-amber-600" />
            <div>
              <h2 className="font-semibold text-base">Day Overview</h2>
              <p className="text-xs text-muted-foreground">
                {totalComplete} of {totalBatchesTarget} recipe batches
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
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Mixes</p>
          <p className="text-2xl font-bold tabular-nums">{completedMixes.size} / {mixCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Balls</p>
          <p className="text-2xl font-bold tabular-nums">{ballCount} / {totalBallsNeeded}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Trays</p>
          <p className="text-2xl font-bold tabular-nums">
            {(ballCount / 4).toFixed(ballCount % 4 === 0 ? 0 : 1)} / {(totalBallsNeeded / 4).toFixed(totalBallsNeeded % 4 === 0 ? 0 : 1)}
          </p>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-2 text-sm">Dough Requirements</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300">Total Dough</p>
            <p className="text-lg font-bold text-amber-800 dark:text-amber-200">{doughData.totalDoughKg.toFixed(1)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300">Total Flour</p>
            <p className="text-lg font-bold text-amber-800 dark:text-amber-200">{(doughData.totalFlourKg ?? 0).toFixed(1)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300">Flour/Mix</p>
            <p className="text-lg font-bold text-amber-800 dark:text-amber-200">{(doughData.flourPerMix ?? 0).toFixed(1)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300">Mixes</p>
            <p className="text-lg font-bold text-amber-800 dark:text-amber-200">{doughData.mixCount}</p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Recipe Breakdown</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
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
          <h3 className="font-semibold text-sm">Dough Recipe (per mix)</h3>
        </div>
        <div className="divide-y divide-border/40">
          {doughData.ingredients.map(ing => (
            <div key={ing.ingredientId ?? ing.ingredientName} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium">{ing.ingredientName}</span>
              <div className="flex items-center gap-4 text-right">
                <span className="text-sm font-bold tabular-nums">
                  {ing.unit === "g" ? `${ing.qtyPerMix.toFixed(0)}g` : `${ing.qtyPerMix.toFixed(2)} ${ing.unit}`}
                </span>
                <span className="text-xs text-muted-foreground w-20 text-right">
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

// ──────────────────────────────────────────────────────────────────────────────
// Dough Sheeting Station
// ──────────────────────────────────────────────────────────────────────────────
function DoughSheetingStation({ plan }: { plan: ProductionPlanDetail }) {
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
          try { setExtraSheetTicks(JSON.parse(d.value)); } catch { /* ignore */ }
        }
        setExtraSheetLoaded(true);
      })
      .catch(() => setExtraSheetLoaded(true));
  }, [extraSheetKey]);

  const saveSheetTicks = (updated: Record<string, boolean>) => {
    fetch(`/api/app-settings/${extraSheetKey}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(updated) }),
    }).catch(() => {});
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

  const undoLast = async () => {
    if (isOnBreak) return;
    const lastItemWithCount = [...items].reverse().find(it => getStationCount(it, "dough_sheeting") > 0);
    if (!lastItemWithCount) return;
    try {
      const res = await fetch(`/api/production-plans/${plan.id}/batch-completions/last`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: lastItemWithCount.id, stationType: "dough_sheeting" }),
      });
      if (!res.ok) throw new Error("Failed to undo");
      queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) });
    } catch {
      toast({ title: "Undo failed", variant: "destructive" });
    }
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
        <div className="bg-card border-2 border-emerald-400 dark:border-emerald-600 rounded-xl p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h2 className="font-semibold text-lg mb-1">All sheeting complete!</h2>
          <p className="text-muted-foreground text-sm">{totalSheeted} batches sheeted and passed to builders.</p>
        </div>
      ) : (
        <div className="bg-card border-2 border-amber-400 dark:border-amber-600 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-0.5">
                Now Sheeting
              </p>
              <h2 className="font-display text-xl font-bold">
                {nextItem?.recipeName ?? "—"}
              </h2>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold font-display tabular-nums">{totalSheeted} <span className="text-lg text-muted-foreground font-normal">/ {totalTarget}</span></p>
              <p className="text-xs text-muted-foreground">batches sheeted</p>
            </div>
          </div>

          <div className="w-full bg-secondary rounded-full h-3 mb-4">
            <div
              className="bg-amber-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>

          {nextBallWeight && (
            <p className="text-sm text-muted-foreground mb-3">
              Ball weight: <span className="font-semibold text-amber-600 dark:text-amber-400">{nextBallWeight}g</span>
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={undoLast}
              disabled={isOnBreak || totalSheeted === 0}
              className="flex items-center gap-1.5 px-4 py-3 text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus className="w-4 h-4" />
              Undo
            </button>
            <button
              onClick={sheetNext}
              disabled={isOnBreak || !nextItem}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 text-base rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-5 h-5" />
              Sheet Batch
            </button>
          </div>
        </div>
      )}

      <BreakTracker planId={plan.id} stationType="dough_sheeting" onBreakActiveChange={setIsOnBreak} />

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
              <span className="text-sm font-medium text-muted-foreground">Sheet Daily Extras</span>
              {(someExtrasSheeted || allExtrasSheeted) && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  {extraSheetItems.filter(e => extraSheetTicks[e.key]).length}/{extraSheetItems.length}
                </span>
              )}
              {allExtrasSheeted && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            </div>
            <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", showExtraSection && "rotate-90")} />
          </button>
          {showExtraSection && (
            <div className="px-4 pb-4 space-y-2 border-t border-border/50">
              <p className="text-xs text-muted-foreground pt-3">Tick each extra ball as it's sheeted and passed to building.</p>
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
                  <span className={cn("text-sm font-medium flex-1", extraSheetTicks[item.key] && "line-through text-muted-foreground")}>
                    {item.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.weightG}g</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Recipe Breakdown</h3>
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
                    <span className={cn("text-sm font-medium truncate", isDone && "text-muted-foreground line-through")}>
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                    {ballWeight && (
                      <span className="text-xs text-muted-foreground">{ballWeight}g</span>
                    )}
                    <span className={cn("text-sm font-bold tabular-nums", isDone ? "text-emerald-600 dark:text-emerald-400" : "")}>
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
const RECIPE_RACK_COLOURS = [
  '#7a8a48', '#d4883a', '#4a7fa8', '#8a4fa8', '#b04a4a',
  '#3a9470', '#c4b030', '#a07040', '#4a5ea8', '#a84a7a',
  '#2e8f8f', '#7a944a', '#6a6aa8', '#a86a3a', '#3a7a60',
];

interface ChillerRackItem {
  recipeId: number;
  recipeName: string;
  trayCount: number;
  colour: string;
}

function ChillerRackVisual({ rackItems }: { rackItems: ChillerRackItem[] }) {
  const TRAYS_PER_RACK = 28;

  const allTrays: Array<{ colour: string; recipeName: string }> = [];
  for (const r of rackItems) {
    for (let i = 0; i < r.trayCount; i++) {
      allTrays.push({ colour: r.colour, recipeName: r.recipeName });
    }
  }

  if (allTrays.length === 0) return null;

  const racks: Array<typeof allTrays> = [];
  for (let i = 0; i < allTrays.length; i += TRAYS_PER_RACK) {
    racks.push(allTrays.slice(i, i + TRAYS_PER_RACK));
  }

  const totalTrays = allTrays.length;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      {/* Header + legend */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <h3 className="font-semibold text-sm">Chiller Rack</h3>
            <p className="text-xs text-muted-foreground">
              {totalTrays} tray{totalTrays !== 1 ? "s" : ""} · {racks.length} rack{racks.length !== 1 ? "s" : ""} · never mixed
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
              <span className="text-xs text-muted-foreground">
                {r.recipeName.length > 18 ? r.recipeName.slice(0, 18) + "…" : r.recipeName}
                <span className="font-semibold text-foreground ml-1">×{r.trayCount}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Racks — scrollable row */}
      <div className="flex gap-6 overflow-x-auto pb-1">
        {racks.map((rackTrays, rackIdx) => {
          // 28-slot array: slot 0 = tray position 1 (bottom of rack)
          const slots: Array<{ colour: string; recipeName: string } | null> = Array(TRAYS_PER_RACK).fill(null).map((_, i) =>
            i < rackTrays.length ? rackTrays[i] : null
          );

          return (
            <div key={rackIdx} className="flex-shrink-0">
              {racks.length > 1 && (
                <p className="text-xs text-center text-muted-foreground mb-2 font-medium">
                  Rack {rackIdx + 1}
                </p>
              )}
              <div className="flex items-stretch gap-2">
                {/* Left slot numbers */}
                <div className="flex flex-col-reverse justify-between py-[6px]" style={{ height: 28 * 15 + 27 * 2 + 12 }}>
                  <span className="text-[9px] text-muted-foreground leading-none">1</span>
                  <span className="text-[9px] text-muted-foreground leading-none">28</span>
                </div>

                {/* Rack body */}
                <div
                  className="relative border-[3px] border-border rounded-md bg-secondary/10 px-1.5 py-[6px]"
                  style={{ minWidth: 140 }}
                >
                  {/* Rack rails — decorative vertical lines */}
                  <div className="absolute inset-y-2 left-[7px] w-[2px] bg-border/40 rounded-full pointer-events-none" />
                  <div className="absolute inset-y-2 right-[7px] w-[2px] bg-border/40 rounded-full pointer-events-none" />

                  {/* Trays — rendered bottom-to-top via flex-col-reverse */}
                  <div className="flex flex-col-reverse gap-[2px] relative z-10">
                    {slots.map((slot, i) =>
                      slot ? (
                        <div
                          key={i}
                          className="h-[15px] rounded-[2px] flex items-center px-1.5 overflow-hidden shadow-sm"
                          style={{ backgroundColor: slot.colour }}
                          title={`${slot.recipeName} — tray ${i + 1}`}
                        >
                          <span
                            className="text-white text-[8px] font-semibold leading-none truncate"
                            style={{ textShadow: "0 0 4px rgba(0,0,0,0.7)" }}
                          >
                            {slot.recipeName}
                          </span>
                        </div>
                      ) : (
                        <div
                          key={i}
                          className="h-[15px] rounded-[2px] border border-dashed border-border/30"
                        />
                      )
                    )}
                  </div>
                </div>

                {/* Right: milestone slot numbers */}
                <div className="flex flex-col-reverse gap-[2px] py-[6px]">
                  {Array.from({ length: TRAYS_PER_RACK }).map((_, i) => (
                    [0, 6, 13, 20, 27].includes(i) ? (
                      <div key={i} className="h-[15px] flex items-center">
                        <span className="text-[9px] text-muted-foreground/70 leading-none">{i + 1}</span>
                      </div>
                    ) : (
                      <div key={i} className="h-[15px]" />
                    )
                  ))}
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
// Ovens Station
// ──────────────────────────────────────────────────────────────────────────────
function OvensStation({ plan }: { plan: ProductionPlanDetail }) {
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

  const removeBatch = async (item: ProductionPlanItem) => {
    if (isOnBreak || getStationCount(item, "ovens") === 0) return;
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
      colour: RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length],
    }))
    .filter(r => r.trayCount > 0);

  return (
    <div className="space-y-4">
      {/* Current recipe — batches as focus */}
      {currentItem ? (
        <div className="bg-card border-2 border-red-400 dark:border-red-600 rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">
                In Ovens Now
              </p>
              <h2 className="font-display text-2xl font-bold leading-tight">
                {currentItem.recipeName ?? `Recipe #${currentItem.recipeId}`}
              </h2>
            </div>
            {/* Built from building station — context only */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-1.5 text-center flex-shrink-0">
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Built</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                {getPrevStationCount(currentItem, "ovens")}
              </p>
            </div>
          </div>

          {getAvailableFromPrev(currentItem, "ovens") <= 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg mb-3">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-300">Waiting for Building to complete more batches</p>
            </div>
          )}

          {/* Primary: batch counter */}
          <div className="flex items-center justify-center gap-6 my-5">
            <button
              onClick={() => removeBatch(currentItem)}
              disabled={getStationCount(currentItem, "ovens") === 0 || isOnBreak}
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
              <p className="text-sm text-muted-foreground mt-1.5 font-medium">batches</p>
            </div>
            <button
              onClick={() => addBatch(currentItem)}
              disabled={
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
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Net Packs</p>
              <p className="text-2xl font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {netPacks(currentItem)}
              </p>
            </div>
            <div className="w-px h-8 bg-border/60" />
            <div className="text-center">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Chiller Trays</p>
              <p className="text-2xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                {chillerTrays(currentItem)}
              </p>
            </div>
            {(currentItem.wonlyCount ?? 0) > 0 && (
              <>
                <div className="w-px h-8 bg-border/60" />
                <div className="text-center">
                  <p className="text-xs text-muted-foreground font-medium mb-0.5">Wonky</p>
                  <p className="text-2xl font-bold tabular-nums text-red-500">{currentItem.wonlyCount}</p>
                </div>
              </>
            )}
          </div>

          {/* Wonky quality rejects */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Quality Rejects (Wonky)</p>
              <p className="text-xs text-muted-foreground">Not counted in output</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => undoWonly(currentItem)}
                disabled={(currentItem.wonlyCount ?? 0) === 0 || wonlyLoading === currentItem.id || isOnBreak}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-border bg-background hover:bg-secondary/60 disabled:opacity-30 transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-xl font-bold tabular-nums w-8 text-center text-red-600 dark:text-red-400">
                {wonlyLoading === currentItem.id ? "…" : (currentItem.wonlyCount ?? 0)}
              </span>
              <button
                onClick={() => addWonly(currentItem)}
                disabled={wonlyLoading === currentItem.id || isOnBreak}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
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
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-card border border-border rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Gross Packs</p>
          <p className="text-xl font-bold tabular-nums">{sessionGrossPacks}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-center">
          <p className="text-xs text-red-700 dark:text-red-300 mb-1">Wonky</p>
          <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{sessionWonly}</p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-center">
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-1">Net Packs</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sessionNetPacks}</p>
          {sessionExtraPacks > 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">+{sessionExtraPacks} extra</p>
          )}
        </div>
        <div className="bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800 rounded-xl p-3 text-center">
          <p className="text-xs text-cyan-700 dark:text-cyan-300 mb-1">Trays</p>
          <p className="text-xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">{sessionTotalTrays}</p>
        </div>
      </div>

      {/* Overall progress + breaks */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Daily Progress — {totalOvenComplete} / {totalTarget} batches</p>
          <span className="text-lg font-bold">{overallPct}%</span>
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

      {/* Chiller Rack Visual */}
      <ChillerRackVisual rackItems={rackItems} />

      {/* Per-recipe summary table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Oven Queue</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/20 border-b border-border text-xs text-muted-foreground">
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
              const recipeColour = RECIPE_RACK_COLOURS[idx % RECIPE_RACK_COLOURS.length];
              return (
                <tr key={item.id} className={cn(
                  "border-b border-border/50 last:border-0",
                  isCurrentRow ? "bg-red-50/40 dark:bg-red-900/10" :
                  item.status === "complete" ? "bg-emerald-50/30 dark:bg-emerald-900/10" : ""
                )}>
                  <td className={cn("py-2 px-3 font-medium text-xs", item.status === "complete" ? "line-through text-muted-foreground" : "")}>
                    <div className="flex items-center gap-1.5">
                      {trays > 0 && (
                        <div className="w-2.5 h-2.5 rounded-[2px] flex-shrink-0" style={{ backgroundColor: recipeColour }} />
                      )}
                      {item.recipeName ?? `Recipe #${item.recipeId}`}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs font-medium">
                    {getStationCount(item, "ovens")}/{item.batchesTarget ?? 0}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs">{gPacks > 0 ? gPacks : "—"}</td>
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
                  <td className="py-2 px-3 text-center tabular-nums text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    {nPacks > 0 ? nPacks : "—"}
                    {(item.extraPacksBuilt ?? 0) > 0 && (
                      <span className="ml-1 text-amber-500" title={`Includes ${item.extraPacksBuilt} extra`}>●</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center tabular-nums text-xs font-semibold text-cyan-600 dark:text-cyan-400">
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
// Wrapping Station
// Per-recipe pack count display (read from oven completions) + wrapping-complete toggle
// ──────────────────────────────────────────────────────────────────────────────
function WrappingStation({ plan }: { plan: ProductionPlanDetail }) {
  const queryClient = useQueryClient();
  const [wrappingLoading, setWrappingLoading] = useState<number | null>(null);
  const [storageLoading, setStorageLoading] = useState<number | null>(null);
  const [isOnBreak, setIsOnBreak] = useState(false);
  const [customAmounts, setCustomAmounts] = useState<Record<number, string>>({});
  const [showCustom, setShowCustom] = useState<Record<number, boolean>>({});
  const [activeStorage, setActiveStorage] = useState<string>("fridge");

  const STACK_SIZE = 24;

  const items = [...(plan.items ?? [])].sort((a, b) => a.orderPosition - b.orderPosition);

  const grossPacks = (item: ProductionPlanItem) =>
    Math.floor((getStationCount(item, "ovens") * (item.portionsPerBatch ?? 10)) / 2);
  const netPacks = (item: ProductionPlanItem) =>
    Math.max(0, grossPacks(item) - (item.wonlyCount ?? 0)) + (item.extraPacksBuilt ?? 0);

  const totalGross = items.reduce((s, it) => s + grossPacks(it), 0);
  const totalWonly = items.reduce((s, it) => s + (it.wonlyCount ?? 0), 0);
  const totalNet = items.reduce((s, it) => s + netPacks(it), 0);
  const totalExtraPacks = items.reduce((s, it) => s + (it.extraPacksBuilt ?? 0), 0);
  const totalFridge = items.reduce((s, it) => s + ((it as any).fridgeQty ?? 0), 0);
  const wrappedCount = items.filter(it => it.wrappingComplete).length;
  const allWrapped = items.length > 0 && items.every(it => it.wrappingComplete);

  const toggleWrapping = async (item: ProductionPlanItem) => {
    if (isOnBreak) return;
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

  const markWrappingComplete = async (itemId: number, complete: boolean) => {
    try {
      await fetch(`/api/production-plans/${plan.id}/items/${itemId}/wrapping-complete`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complete }),
      });
    } catch {}
  };

  const addToStorage = async (item: ProductionPlanItem, qty: number, storageKey: string) => {
    if (isOnBreak || qty < 1) return;
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
      const net = netPacks(item);
      const currentStored = STORAGE_LOCATIONS.reduce((s, l) => s + getStorageQty(item, l.key), 0);
      const newRemaining = net - currentStored - qty;
      if (newRemaining <= 0 && !item.wrappingComplete) {
        await markWrappingComplete(item.id, true);
      }
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
            {totalExtraPacks > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">+{totalExtraPacks} extra</p>
            )}
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
          <BreakTracker planId={plan.id} stationType="wrapping" onBreakActiveChange={setIsOnBreak} />
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
                  disabled={isLoading || isOnBreak}
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
                  {remaining > 0 && (
                  <button
                    onClick={() => addToStorage(item, Math.min(STACK_SIZE, remaining), activeStorage)}
                    disabled={isStorageLoading || isOnBreak}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {isStorageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {remaining < STACK_SIZE ? `Add ${remaining} remaining` : `Add ${STACK_SIZE}`}
                  </button>
                  )}

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
                        disabled={isStorageLoading || !(customNum > 0) || isOnBreak}
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

                  {getStorageQty(item, activeStorage) > 0 && (() => {
                    const storageQty = getStorageQty(item, activeStorage);
                    const undoAmt = Math.min(STACK_SIZE, storageQty);
                    return (
                    <button
                      onClick={() => undoStorage(item, undoAmt, activeStorage)}
                      disabled={isStorageLoading}
                      className="ml-auto inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      Undo {undoAmt}
                    </button>
                    );
                  })()}
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

interface DispatchProgress {
  tag: string;
  totalOrders: number;
  totalFulfilled: number;
  categories: {
    smallBox: { total: number; fulfilled: number };
    largeBox: { total: number; fulfilled: number };
    wholesale: { total: number; fulfilled: number };
    other: { total: number; fulfilled: number };
  };
}

interface DessertItem {
  title: string;
  quantity: number;
  orderCount: number;
}

interface DessertsReport {
  tag: string;
  products: DessertItem[];
  totalQuantity: number;
  dessertProductCount: number;
}

interface PackingShortfallItem {
  recipeId: number | null;
  recipeName: string;
  fridgeQty: number;
  plannedPacks: number;
  totalDispatch: number;
  shortfall: number;
  level: "yellow" | "red";
}

function PackingStation({ plan }: { plan: ProductionPlanDetail }) {
  const [, navigate] = useLocation();

  // Dates: production happens today (plan.planDate); orders are tagged with delivery date (tomorrow)
  const packingDate = parseISO(plan.planDate);
  const packingLabel = format(packingDate, "EEEE d MMM");
  const deliveryDate = addDays(packingDate, 1);
  const deliveryLabel = format(deliveryDate, "EEEE d MMM");
  const dispatchTag = format(deliveryDate, "yyyy-MM-dd"); // Shopify order tag = delivery date

  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [desserts, setDesserts] = useState<DessertsReport | null>(null);
  const [packingItems, setPackingItems] = useState<Array<{
    recipeId: number | null;
    recipeName: string;
    batchesTarget: number;
    portionsPerBatch: number;
    fridgeQty: number;
    totalDispatch: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [progressRes, dessertsRes, packingRes] = await Promise.all([
        fetch(`${BASE}/api/fulfilment/dispatch-progress?tag=${dispatchTag}`, { credentials: "include" }),
        fetch(`${BASE}/api/fulfilment/desserts-report?tag=${dispatchTag}`, { credentials: "include" }),
        fetch(`${BASE}/api/production-plans/${plan.id}/packing`, { credentials: "include" }),
      ]);
      if (!progressRes.ok && !dessertsRes.ok) {
        setError("Failed to load dispatch data");
        return;
      }
      if (progressRes.ok) setProgress(await progressRes.json());
      else setError("Failed to load dispatch progress");
      if (dessertsRes.ok) setDesserts(await dessertsRes.json());
      if (packingRes.ok) {
        const data = await packingRes.json();
        setPackingItems(data.items ?? []);
      }
      if (progressRes.ok && dessertsRes.ok) setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch data");
    } finally {
      setLoading(false);
    }
  }, [dispatchTag, plan.id, BASE]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Stock shortfall analysis: compare live fridge stock against today's dispatch quantities.
  // Yellow = need today's production to fulfil; Red = can't fulfil even after production.
  const shortfalls: PackingShortfallItem[] = packingItems
    .filter(item => item.totalDispatch > 0)
    .flatMap(item => {
      const fridgeQty = item.fridgeQty ?? 0;
      const plannedPacks = Math.floor((item.batchesTarget ?? 0) * (item.portionsPerBatch ?? 10) / 2);
      const totalDispatch = item.totalDispatch ?? 0;
      if (fridgeQty >= totalDispatch) return [];
      const shortfall = totalDispatch - (fridgeQty + plannedPacks);
      const level: "yellow" | "red" = shortfall > 0 ? "red" : "yellow";
      return [{
        recipeId: item.recipeId,
        recipeName: item.recipeName,
        fridgeQty,
        plannedPacks,
        totalDispatch,
        shortfall,
        level,
      }];
    });

  const redShortfalls = shortfalls.filter(s => s.level === "red");
  const yellowShortfalls = shortfalls.filter(s => s.level === "yellow");

  const cats = progress?.categories;

  function CatCard({ label, cat, color }: { label: string; cat: { total: number; fulfilled: number }; color: string }) {
    if (cat.total === 0) return null;
    const remaining = cat.total - cat.fulfilled;
    const pct = Math.round((cat.fulfilled / cat.total) * 100);
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">{label}</span>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", remaining === 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300")}>
            {remaining === 0 ? "Done" : `${remaining} left`}
          </span>
        </div>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="text-2xl font-bold tabular-nums">{cat.fulfilled}</span>
          <span className="text-muted-foreground text-sm">/ {cat.total}</span>
          <span className="text-xs text-muted-foreground ml-auto">{pct}%</span>
        </div>
        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — single source of date truth */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box className="w-6 h-6 text-indigo-500" />
            <div>
              <h2 className="font-semibold text-base">Packing on {packingLabel}</h2>
              <p className="text-xs text-muted-foreground">
                Dispatch {packingLabel}
                <span className="mx-1.5 text-border">·</span>
                <Truck className="w-3 h-3 inline mb-0.5 mr-0.5 text-muted-foreground/70" />
                For delivery {deliveryLabel}
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && !progress && (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading dispatch data…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Stock shortfall check — red first, then yellow */}
      {redShortfalls.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Hard Shortfall — not enough even after production</p>
          </div>
          <div className="divide-y divide-red-200 dark:divide-red-800">
            {redShortfalls.map(s => (
              <div key={s.recipeId ?? s.recipeName} className="px-4 py-3">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">{s.recipeName}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-red-700 dark:text-red-300">
                  <span>{s.fridgeQty} in fridge</span>
                  <span>dispatching {s.totalDispatch}</span>
                  <span>making {s.plannedPacks} today</span>
                  <span className="font-bold">{s.shortfall} pack{s.shortfall !== 1 ? "s" : ""} short</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {yellowShortfalls.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-300 dark:border-amber-700">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Stock Warning — ok after today's production completes</p>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-800">
            {yellowShortfalls.map(s => (
              <div key={s.recipeId ?? s.recipeName} className="px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">{s.recipeName}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                  <span>{s.fridgeQty} in fridge</span>
                  <span>dispatching {s.totalDispatch}</span>
                  <span>making {s.plannedPacks} today</span>
                  <span className="font-medium">{Math.abs(s.shortfall)} surplus after production</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress && (
        <>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-sm">Overall Progress</span>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-primary tabular-nums">{progress.totalFulfilled}/{progress.totalOrders}</span>
                {progress.totalOrders - progress.totalFulfilled > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                    {progress.totalOrders - progress.totalFulfilled} remaining
                  </span>
                ) : progress.totalOrders > 0 ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">
                    All dispatched!
                  </span>
                ) : null}
              </div>
            </div>
            {progress.totalOrders > 0 && (
              <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.round((progress.totalFulfilled / progress.totalOrders) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {cats && (
            <div className="grid grid-cols-2 gap-3">
              <CatCard label="Small Box" cat={cats.smallBox} color="bg-blue-500" />
              <CatCard label="Large Box" cat={cats.largeBox} color="bg-indigo-500" />
              <CatCard label="Wholesale" cat={cats.wholesale} color="bg-amber-500" />
              {cats.other.total > 0 && <CatCard label="Other" cat={cats.other} color="bg-gray-500" />}
            </div>
          )}
        </>
      )}

      {desserts && desserts.products.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 bg-pink-50/50 dark:bg-pink-900/10">
            <div className="flex items-center gap-2">
              <span className="text-lg">🍰</span>
              <h3 className="font-semibold text-sm">Desserts Report</h3>
              <span className="text-xs text-muted-foreground ml-auto">{desserts.totalQuantity} units total</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {desserts.products.map(p => (
              <div key={p.title} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm">{p.title}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{p.orderCount} orders</span>
                  <span className="font-bold tabular-nums text-sm bg-pink-100 dark:bg-pink-900/30 px-2.5 py-0.5 rounded-lg text-pink-800 dark:text-pink-200">{p.quantity}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress && progress.totalOrders - progress.totalFulfilled > 0 && (
        <button
          onClick={() => navigate(`/fulfilment?tag=${dispatchTag}`)}
          className="w-full py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base flex items-center justify-center gap-3 hover:opacity-90 transition-opacity active:scale-[0.98]"
        >
          <Scan className="w-5 h-5" />
          Pack &amp; Dispatch Orders
          <span className="text-sm font-normal opacity-80">
            ({progress.totalOrders - progress.totalFulfilled} remaining)
          </span>
        </button>
      )}

      <BreakTracker planId={plan.id} stationType="packing" onBreakActiveChange={() => {}} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Prep Sub-Station Tab Bar
// ──────────────────────────────────────────────────────────────────────────────
const PREP_SUB_STATIONS = [
  { key: "main_prep",  label: "Main Prep",      short: "Main",   icon: ClipboardList, activeClass: "bg-emerald-500 dark:bg-emerald-600 text-white", inactiveClass: "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" },
  { key: "prep_veg",   label: "Veg Prep",        short: "Veg",    icon: Salad,         activeClass: "bg-green-500 dark:bg-green-600 text-white",    inactiveClass: "text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40" },
  { key: "prep_bases", label: "Bases & Sauces",  short: "Bases",  icon: Layers,        activeClass: "bg-yellow-500 dark:bg-yellow-600 text-white",  inactiveClass: "text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/40" },
  { key: "prep_meat",  label: "Raw Meat",        short: "Meat",   icon: Beef,          activeClass: "bg-rose-500 dark:bg-rose-600 text-white",      inactiveClass: "text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40" },
] as const;

function PrepSubNav({ planId, current }: { planId: number; current: string }) {
  const [, navigate] = useLocation();
  return (
    <div className="flex items-center gap-1 bg-card border border-border rounded-xl p-1.5">
      {PREP_SUB_STATIONS.map(s => {
        const Icon = s.icon;
        const isActive = s.key === current;
        return (
          <button
            key={s.key}
            onClick={() => navigate(`/plans/${planId}/station/${s.key}`)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
              isActive ? s.activeClass : s.inactiveClass
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="hidden lg:inline truncate">{s.label}</span>
            <span className="hidden sm:inline lg:hidden truncate">{s.short}</span>
          </button>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Prep Hub — sub-station picker shown when "Prep" tile is selected
// ──────────────────────────────────────────────────────────────────────────────
function PrepHub({ planId, planDate }: { planId: number; planDate?: string }) {
  const [, navigate] = useLocation();
  const { data: nextPlan, isLoading } = useNextActivePlan(planDate) as { data: NextActivePlan | null; isLoading: boolean };

  const subStations = [
    {
      key: "main_prep",
      label: "Main Prep",
      icon: ClipboardList,
      color: "text-emerald-600",
      borderColor: "border-emerald-200 dark:border-emerald-800",
      bgColor: "bg-emerald-50 dark:bg-emerald-950/20",
      description: "All ingredients grouped by recipe with per-tin checkboxes and stock checks",
    },
    {
      key: "prep_bases",
      label: "Bases & Sauces",
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
        currentPlanDate={planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
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
                      return `For production on ${format(d, "EEEE d MMM")}`;
                    } catch { return nextPlan.planDate; }
                  })()
                : "No upcoming production plan";
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
        return <PrepHub planId={planId} planDate={plan.planDate} />;
      case "main_prep":
        return <MainPrepStation plan={plan} />;
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
