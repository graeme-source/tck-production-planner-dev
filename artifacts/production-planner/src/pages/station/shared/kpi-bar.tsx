import React from "react";
import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { differenceInMinutes } from "date-fns";
import { cn } from "@/lib/utils";
import type { StationKpi } from "@workspace/api-client-react";

interface KpiBarProps {
  sessionBatches: number;
  sessionStartedAt: Date | null;
  activeBreakMinutes: number;
  totalBreakMinutes: number;
  targetBph: number | null;
  minBph: number | null;
  serverKpi?: StationKpi | null;
}

export function KpiBar({ sessionBatches, sessionStartedAt, activeBreakMinutes, totalBreakMinutes, targetBph, minBph, serverKpi }: KpiBarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  const localActiveMinutes = sessionStartedAt
    ? Math.max(0, differenceInMinutes(now, sessionStartedAt) - totalBreakMinutes - activeBreakMinutes)
    : 0;
  const localBph = localActiveMinutes > 0 ? sessionBatches / (localActiveMinutes / 60) : 0;

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
