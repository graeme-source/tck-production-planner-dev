import { format, parseISO } from "date-fns";
import type { PlanStartStock } from "@workspace/stock-prediction";
import { cn } from "@/lib/utils";

export { macStockWorking, withLiveStock } from "@/lib/mac-stock-working";

/**
 * The working behind a mac cheese Stock figure — the same terms the calzone
 * Factory Number breakdown shows, so a planner can see why the number is what
 * it is instead of trusting an unexplained drop:
 *
 *   fridge now + still to wrap today − still to go out today
 *   + each working day before the plan: made − dispatched
 *   = stock at the start of the plan day
 */

function dayLabel(date: string): string {
  try {
    return format(parseISO(date), "EEE");
  } catch {
    return date;
  }
}

export function MacStockWorking({ working, planDate, className }: {
  working: PlanStartStock;
  planDate: string;
  className?: string;
}) {
  const lines: Array<{ label: string; value: string; tone?: "plus" | "minus" | "muted" }> = [
    { label: "fridge now", value: String(Math.round(working.liveStock)) },
  ];
  if (working.stillToWrapToday > 0) {
    lines.push({ label: "to wrap today", value: `+${Math.round(working.stillToWrapToday)}`, tone: "plus" });
  }
  if (working.stillToDispatchToday > 0) {
    lines.push({ label: "to go out today", value: `−${Math.round(working.stillToDispatchToday)}`, tone: "minus" });
  }
  for (const d of working.rollForward) {
    const made = Math.round(d.plannedProductionPacks);
    const out = Math.round(d.dispatchPacks);
    const day = dayLabel(d.date);
    lines.push(made > 0
      ? { label: `made ${day}`, value: `+${made}`, tone: "plus" }
      : { label: `${day} not planned yet`, value: "+0", tone: "muted" });
    lines.push({ label: `out ${day}`, value: `−${out}`, tone: out > 0 ? "minus" : "muted" });
  }
  const onlyLive = lines.length === 1;

  return (
    <div className={cn("text-[11px] leading-tight text-muted-foreground tabular-nums text-right space-y-0.5", className)}>
      {lines.map((l, i) => (
        <div key={i} className="flex justify-end gap-1.5 whitespace-nowrap">
          <span>{l.label}</span>
          <span className={cn(
            "font-medium",
            l.tone === "plus" && "text-green-600 dark:text-green-400",
            l.tone === "minus" && "text-red-500 dark:text-red-400",
          )}>{l.value}</span>
        </div>
      ))}
      {!onlyLive && (
        <div className="flex justify-end gap-1.5 whitespace-nowrap border-t border-border/60 pt-0.5 text-foreground">
          <span>at start of {dayLabel(planDate)}</span>
          <span className="font-semibold">= {Math.round(working.atPlanStart)}</span>
        </div>
      )}
    </div>
  );
}
