/**
 * Sales so far against BOTH monthly targets — the minimum and this month's
 * stretch — as one bar with two markers and plain-English lines
 * (Graeme, 2026-10-08). The same component on Numbers (Month to Date tile)
 * and Sales & Marketing (Revenue pace), fed by the same hook, so the two
 * pages can't show different numbers. Objective I.
 *
 * 25 Nov 2026 (Graeme): projected month-end first (under the orders), then
 * the bar, the two targets, and where we are against today's mark. One
 * colour throughout — the header's shade (lib/targets-progress-colour.ts) —
 * and no "£301 short of minimum / £60k short of stretch" chips: the bar
 * already shows that.
 */
import { daysInMonth, formatGbp, paceAgainstTargets } from "@workspace/revenue-targets";
import { targetsProgressColour } from "@/lib/targets-progress-colour";
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
  const colour = targetsProgressColour(projected, thisMonth.minimum, thisMonth.stretch);

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3", className)}>
      <p className={cn("tabular-nums text-muted-foreground", compact ? "text-sm" : "text-base")}>
        Projected <b className="text-foreground">{formatGbp(projected)}</b>
      </p>
      {/* Bar: filled to month-to-date, a marker at the minimum and at the
          stretch, and a faint tick where we should be today for the minimum. */}
      <div className="relative pt-5 pb-5">
        <div className={cn("relative rounded-full bg-secondary overflow-hidden", compact ? "h-3" : "h-4")}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${bar.fillPct}%`, backgroundColor: colour.barHex }} />
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground/30"
            title="Where sales should be by today to reach the minimum"
            style={{ left: `${bar.minimumTodayPct}%` }}
          />
        </div>
        <Marker pct={bar.minimumPct} label="Min" position="below" />
        {bar.stretchPct != null && <Marker pct={bar.stretchPct} label="Stretch" position="above" />}
      </div>

      <p className={cn("tabular-nums text-muted-foreground", compact ? "text-sm" : "text-base")}>
        {formatGbp(thisMonth.minimum)} minimum
        {thisMonth.stretch != null && <> · {formatGbp(thisMonth.stretch)} stretch</>}
      </p>
      {/* Against today's tick (Graeme, 2026-10-11), in the card's colour. */}
      <p className={cn("font-semibold", compact ? "text-sm" : "text-base", !colour.textHex && "text-foreground")}
        style={colour.textHex ? { color: colour.textHex } : undefined}>
        {pace.today.headline}
        <span className="font-normal text-muted-foreground"> · {formatGbp(Math.round(pace.today.expected))} by today</span>
      </p>
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
