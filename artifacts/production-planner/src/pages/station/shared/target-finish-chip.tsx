import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

// Builders' target finish — when building should be done at the standard
// rate (20 batches/hour across both tables) with the standard snack and lunch
// added. Small on purpose (Graeme, 2026-10-01: "doesn't have to be big").
// The sum is server side (GET /api/building-target-finish, pure logic in
// @workspace/production-schedule computeTargetFinish) so both tables show
// the same time.

export interface BuildingTargetFinish {
  planId: number;
  batches: number;
  ratePerHour: number;
  startTime: string;
  targetFinish: string | null;
  breaksAdded: string[];
}

export function useBuildingTargetFinish(planId: number) {
  return useQuery({
    queryKey: ["building-target-finish", planId],
    // The plan's batches or break anchors can change mid-morning; a minute
    // is plenty fresh for a finish time.
    refetchInterval: 60_000,
    queryFn: async (): Promise<BuildingTargetFinish | null> => {
      const res = await fetch(`/api/building-target-finish?planId=${planId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<BuildingTargetFinish>;
    },
  });
}

const BREAK_NAMES: Record<string, string> = { morning: "snack", lunch: "lunch" };

/** "Target finish 14:49 (20/h)" — compact variant shows just the flag + time. */
export function TargetFinishChip({ planId, compact = false, className }: { planId: number; compact?: boolean; className?: string }) {
  const { data } = useBuildingTargetFinish(planId);
  if (!data?.targetFinish) return null;
  const breaks = data.breaksAdded.map(b => BREAK_NAMES[b] ?? b);
  const detail = `${data.batches} batches at ${data.ratePerHour}/h from ${data.startTime}`
    + (breaks.length ? `, plus ${breaks.join(" and ")}` : "");
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums whitespace-nowrap", className)}
      title={`Target finish ${data.targetFinish}: ${detail}`}
      aria-label={`Target finish ${data.targetFinish}, ${detail}`}
    >
      <Flag className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      {compact
        ? <span className="font-semibold text-foreground">{data.targetFinish}</span>
        : <>Target finish <span className="font-semibold text-foreground">{data.targetFinish}</span> ({data.ratePerHour}/h)</>}
    </span>
  );
}
