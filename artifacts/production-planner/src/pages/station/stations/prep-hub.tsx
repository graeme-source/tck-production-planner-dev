import React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useListSubRecipes,
} from "@workspace/api-client-react";
import type { SubRecipe } from "@workspace/api-client-react";
import {
  ClipboardList, Layers, Beef, ArrowLeft, ChevronRight, FlaskConical, ExternalLink, List, CheckCircle2, LayoutGrid,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { PrepDateBanner, useNextActivePlan } from "../shared/prep-helpers";
import type { NextActivePlan } from "../shared/prep-helpers";
import { SubRecipeMakeFlow } from "./prep-bases-station";

const PREP_SUB_STATIONS = [
  { key: "main_prep",  label: "Main Prep",      short: "Main",   icon: ClipboardList, activeClass: "bg-emerald-500 dark:bg-emerald-600 text-white", inactiveClass: "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" },
  { key: "prep_bases", label: "Bases & Sauces",  short: "Bases",  icon: Layers,        activeClass: "bg-yellow-500 dark:bg-yellow-600 text-white",  inactiveClass: "text-yellow-700 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-950/40" },
  { key: "prep_meat",  label: "Raw Meat",        short: "Meat",   icon: Beef,          activeClass: "bg-rose-500 dark:bg-rose-600 text-white",      inactiveClass: "text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40" },
] as const;

export function PrepSubNav({ planId, current }: { planId: number; current: string }) {
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
              "flex flex-1 items-center justify-center gap-2 px-3 py-2 rounded-lg text-base font-medium transition-all",
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
          <span className="font-semibold text-base">{stationLabel}</span>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 && !isDone && (
            <span className="text-base text-muted-foreground tabular-nums">{idx + 1} of {total}</span>
          )}
          <button
            onClick={onOverviewClick}
            className="flex items-center gap-1.5 text-base text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
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
              <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-1">
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
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl text-blue-700 dark:text-blue-300 text-base font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors whitespace-nowrap flex-shrink-0"
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
              <span className="font-medium text-base">{current.badge.label}</span>
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
              className="flex-1 py-3 rounded-xl border border-border text-base font-medium hover:bg-secondary/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setIdx(i => Math.min(total, i + 1))}
              className="flex-1 py-3 rounded-xl border border-border text-base font-medium hover:bg-secondary/50 transition-colors"
            >
              Skip →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface PrepIngredientDetail {
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

export interface PrepMarinadeDetail {
  rawMeatIngredientId: number;
  marinadeIngredientId: number | null;
  marinadeIngredientName: string | null;
  marinadeSubRecipeId: number | null;
  marinadeSubRecipeName: string | null;
  gramsPerKg?: number;
  totalGrams: number;
}

export interface PrepRecipeDetail {
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
export function usePrepByRecipe(station: string, currentPlanId: number, afterDate?: string) {
  const { data: nextPlan, isLoading: isPlanLoading } = useNextActivePlan(afterDate) as { data: NextActivePlan | null; isLoading: boolean };
  // When the next-plan lookup has resolved but found nothing, signal "no future plan"
  // instead of falling back to the current plan (which would show today's data).
  const noFuturePlan = !isPlanLoading && nextPlan != null && nextPlan.planId == null;
  const targetPlanId = noFuturePlan ? null : (nextPlan?.planId ?? null);
  const [recipes, setRecipes] = useState<PrepRecipeDetail[]>([]);
  const [isPrepLoading, setIsPrepLoading] = useState(false);
  const initialLoadDone = useRef(false);

  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(() => {
    if (!targetPlanId) { setRecipes([]); return; }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!initialLoadDone.current) setIsPrepLoading(true);
    fetch(`/api/production-plans/${targetPlanId}/prep-requirements-by-recipe?station=${station}`, { credentials: "include", signal: ctrl.signal })
      .then(r => r.json())
      .then((json: { recipes?: PrepRecipeDetail[] }) => {
        setRecipes(json.recipes ?? []); initialLoadDone.current = true; setIsPrepLoading(false);
      })
      .catch((e) => { if (e.name !== "AbortError") { initialLoadDone.current = true; setIsPrepLoading(false); } });
  }, [targetPlanId, station]);

  useEffect(() => {
    initialLoadDone.current = false;
    doFetch();
    if (!targetPlanId) return;
    const interval = setInterval(doFetch, 5000);
    return () => { clearInterval(interval); abortRef.current?.abort(); };
  }, [doFetch, targetPlanId]);

  return {
    recipes,
    isLoading: isPlanLoading || (!!targetPlanId && isPrepLoading),
    nextPlan,
    targetPlanId,
    noFuturePlan,
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

export function PrepHub({ planId, planDate }: { planId: number; planDate?: string }) {
  const [, navigate] = useLocation();
  const { data: nextPlan, isLoading } = useNextActivePlan(planDate) as { data: NextActivePlan | null; isLoading: boolean };
  const [showReplenish, setShowReplenish] = useState(false);
  const { data: allSubRecipesData } = useListSubRecipes();
  const allSubRecipes = (allSubRecipesData ?? []) as SubRecipe[];

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

  const noFuturePlan = !isLoading && nextPlan != null && nextPlan.planId == null;

  if (noFuturePlan) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
        <h2 className="font-semibold text-lg mb-1">No future production plan</h2>
        <p className="text-muted-foreground text-sm">
          There is no upcoming active production plan to prep for.
          Create and activate a future plan to see prep requirements here.
        </p>
      </div>
    );
  }

  if (showReplenish) {
    return (
      <div className="space-y-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => setShowReplenish(false)}
              className="p-2 rounded-lg hover:bg-secondary/60 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            </button>
            <div>
              <h3 className="font-bold text-xl">Replenish Sub Recipes</h3>
              <p className="text-sm text-muted-foreground">Ad-hoc production of spice rubs, dough mixes, and other sub-recipes</p>
            </div>
          </div>
          <SubRecipeMakeFlow
            mode="standalone"
            planRequirements={[]}
            allSubRecipes={allSubRecipes}
            onClose={() => setShowReplenish(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PrepDateBanner
        currentPlanDate={planDate}
        targetPlanDate={nextPlan?.planDate ?? null}
        targetPlanName={nextPlan?.planName ?? null}
        isLoading={isLoading}
      />

      <div>
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Select prep station
        </p>
        <div className="grid gap-4">
          {subStations.map(s => {
            const Icon = s.icon;
            const prepDateLabel = isLoading
              ? "Loading…"
              : nextPlan?.planDate
                ? (() => {
                    try {
                      const d = parseISO(nextPlan.planDate);
                      return `For production on ${format(d, "EEEE d MMM")}`;
                    } catch (err) { console.warn("[PrepHub] Date parse failed:", err); return nextPlan.planDate; }
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
                  <p className="text-base text-muted-foreground leading-snug">{s.description}</p>
                  <p className={cn("text-sm font-semibold mt-1.5", nextPlan?.planDate ? s.color : "text-muted-foreground")}>
                    {prepDateLabel}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              </button>
            );
          })}

          {/* Replenish Sub Recipes tile */}
          <button
            onClick={() => setShowReplenish(true)}
            className="flex items-center gap-4 p-5 border-2 border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 rounded-2xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <div className="p-3 bg-background rounded-xl border border-violet-200 dark:border-violet-800">
              <FlaskConical className="w-8 h-8 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg">Replenish Sub Recipes</h3>
              <p className="text-base text-muted-foreground leading-snug">Ad-hoc spice rubs, dough mixes, and other prepared components — any time</p>
              <p className="text-sm font-semibold mt-1.5 text-violet-500">Pick a sub-recipe · choose batch count · follow checklist</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}