/**
 * Sales so far against BOTH monthly targets — the minimum and this month's
 * stretch — as one bar with two markers and plain-English lines
 * (Graeme, 2026-10-08). The same component on Numbers (Month to Date tile)
 * and Sales & Marketing (Revenue pace), fed by the same hook, so the two
 * pages can't show different numbers. Objective I.
 */
import { daysInMonth, formatGbp, formatGbpShort, paceAgainstTargets, type TargetPace } from "@workspace/revenue-targets";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useThisMonthTargets } from "./api";

export function TargetsProgress({
  monthToDate,
  projected,
  compact = false,
  className,
}: {
  monthToDate: number;
  /** Projected month-end (the sales summary's estimate). */
  projected: number;
  /** Tighter spacing for a KPI tile. */
  compact?: boolean;
  className?: string;
}) {
  const { thisMonth, today, isLoading, error } = useThisMonthTargets();

  if (isLoading) return <Skeleton className={cn("h-16 w-full", className)} />;
  if (error || !thisMonth || !today) {
    return <p className={cn("text-sm text-muted-foreground", className)}>Targets unavailable right now.</p>;
  }

  const pace = paceAgainstTargets(
    { monthToDate, projected, dayOfMonth: Number(today.slice(8, 10)), daysInMonth: daysInMonth(thisMonth.month) },
    thisMonth.minimum,
    thisMonth.stretch,
  );
  const { bar } = pace;
  const toneText = pace.tone === "stretch" ? "text-primary" : pace.tone === "minimum" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const fill = pace.tone === "stretch" ? "bg-primary" : pace.tone === "minimum" ? "bg-amber-500" : "bg-red-500";

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3", className)}>
      {/* Bar: filled to month-to-date, a marker at the minimum and at the
          stretch, and a faint tick where we should be today for the minimum. */}
      <div className="relative pt-5 pb-5">
        <div className={cn("relative rounded-full bg-secondary overflow-hidden", compact ? "h-3" : "h-4")}>
          <div className={cn("absolute inset-y-0 left-0 rounded-full", fill)} style={{ width: `${bar.fillPct}%` }} />
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/30"
            title="Where sales should be by today to reach the minimum"
            style={{ left: `${bar.minimumTodayPct}%` }}
          />
        </div>
        <Marker pct={bar.minimumPct} label="Min" position="below" />
        {bar.stretchPct != null && <Marker pct={bar.stretchPct} label="Stretch" position="above" />}
      </div>

      <p className={cn("tabular-nums", compact ? "text-sm" : "text-base")}>
        <b>{formatGbp(monthToDate)}</b> of {formatGbp(thisMonth.minimum)} minimum
        {thisMonth.stretch != null && <> · {formatGbp(thisMonth.stretch)} stretch</>}
      </p>
      <p className={cn("font-semibold", compact ? "text-sm" : "text-base", toneText)}>{pace.headline}</p>
      <div className={cn("flex flex-wrap gap-1.5", compact ? "text-xs" : "text-sm")}>
        <span className="text-muted-foreground self-center">Projected {formatGbp(projected)}:</span>
        <GapChip label="minimum" pace={pace.minimum} />
        {pace.stretch && <GapChip label="stretch" pace={pace.stretch} />}
      </div>
    </div>
  );
}

function Marker({ pct, label, position }: { pct: number; label: string; position: "above" | "below" }) {
  // Keep the words inside the bar's width at the ends.
  const align = pct > 88 ? "-translate-x-full" : pct < 12 ? "translate-x-0" : "-translate-x-1/2";
  return (
    <>
      <div
        className={cn("absolute w-0.5 bg-foreground", position === "above" ? "top-3 bottom-5" : "top-5 bottom-3")}
        style={{ left: `calc(${pct}% - 1px)` }}
        aria-hidden
      />
      <span
        className={cn("absolute text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap", align,
          position === "above" ? "top-0" : "bottom-0")}
        style={{ left: `${pct}%` }}
      >
        {label}
      </span>
    </>
  );
}

function GapChip({ label, pace }: { label: string; pace: TargetPace }) {
  const over = pace.projectedGap >= 0;
  return (
    <span className={cn("rounded-full px-2 py-0.5 font-medium tabular-nums",
      over ? "bg-primary/10 text-primary" : "bg-red-500/10 text-red-600 dark:text-red-400")}>
      {over ? `${formatGbpShort(pace.projectedGap)} over` : `${formatGbpShort(-pace.projectedGap)} short of`} {label}
    </span>
  );
}
