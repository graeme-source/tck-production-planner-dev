import React from "react";
import { useState, useEffect } from "react";
import { Trophy, Loader2 } from "lucide-react";
import { differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import type { ProductionPlanItem } from "@workspace/api-client-react";
import { getStationCount } from "./constants";

interface EodSummaryProps {
  planId: number;
  items: ProductionPlanItem[];
  stationType: string;
  sessionBatches: number;
  totalBreakMinutes: number;
  sessionStartedAt: Date | null;
  onClose: () => void;
}

export interface EodServerData {
  totalBatches: number;
  activeMinutes: number;
  breakMinutes: number;
  bph: number;
  minsPerBatch: number | null;
  planCompletionRate: number;
  perRecipe: Array<{ name: string; count: number; avgMins: number | null }>;
}

export function EodSummary({ planId, items, stationType, sessionBatches, totalBreakMinutes, sessionStartedAt, onClose }: EodSummaryProps) {
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

  const stationLabel = stationType === "building_1" ? "Building Table 1"
    : stationType === "building_2" ? "Building Table 2"
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
