import { useEffect, useState } from "react";
import { AlarmClock, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { cutoffLabel, cutoffStatus, tickIntervalMs, type SupplierCutoffInfo } from "@/lib/supplier-cutoff";

/**
 * "Cut-off 4pm · order within 35 min" on a supplier order card, counting
 * down live (every 30 s; every second in the last 10 minutes). Neutral with
 * more than 2 h left, amber within 2 h, red within 30 min, grey once passed.
 * `ordered` replaces the countdown with "Ordered ✓" so a supplier that has
 * already had its order doesn't nag.
 */
export function SupplierCutoffBadge({
  info,
  deliveryText,
  ordered = false,
}: {
  info: SupplierCutoffInfo;
  /** Delivery date for an order placed now — shown once the cut-off passes. */
  deliveryText: string;
  ordered?: boolean;
}) {
  const [interval, setTickInterval] = useState(30_000);
  const now = useNow(interval);
  const status = cutoffStatus(info, now);
  const wanted = tickIntervalMs(status);
  useEffect(() => {
    if (wanted !== interval) setTickInterval(wanted);
  }, [wanted, interval]);

  const base = "inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg text-sm leading-snug border text-left";

  if (ordered) {
    return (
      <span className={cn(base, "font-semibold bg-green-600/10 border-green-600/30 text-green-700 dark:text-green-400")}>
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        Ordered ✓
      </span>
    );
  }

  const label = cutoffLabel(status, deliveryText);
  if (status.kind === "open") {
    return (
      <span
        role="timer"
        aria-live="off"
        className={cn(
          base,
          "font-semibold tabular-nums",
          status.urgency === "urgent" && "bg-red-600/10 border-red-600/40 text-red-700 dark:text-red-400",
          status.urgency === "soon" && "bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300",
          status.urgency === "calm" && "bg-secondary border-border text-foreground",
        )}
      >
        <AlarmClock className="w-4 h-4 shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className={cn(base, "font-medium bg-secondary/40 border-border text-muted-foreground")}>
      <Clock className="w-4 h-4 shrink-0" />
      {label}
    </span>
  );
}
