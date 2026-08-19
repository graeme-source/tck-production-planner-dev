/**
 * The station pace KPI strip — rate / count / active time, with optional
 * traffic-light banding against a standard and a rotating lean nudge.
 *
 * Born on the packing station and generalised 2026-08-19 so every station
 * gets the same indicator as its KPI is defined (wrapping first). Two house
 * rules baked in:
 *
 *  - The message is LEAN, not "go faster". Graeme's brief: "Try and focus
 *    on where to remove some wasteful activity each time, rather than just
 *    speed up." So the nudges talk about removing waste and what a couple
 *    of seconds per unit adds up to — never about hurrying.
 *  - "Active time" already excludes idle pauses (the server drops gaps over
 *    the station's threshold), so the rate is honest about interruptions —
 *    deliveries arriving, role changes — without punishing them.
 */
import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaceBands {
  /** Rate at or above this shows green. */
  green: number;
  /** Rate at or above this (but below green) shows amber; below shows red. */
  amber: number;
  /** Aspirational marker, shown as "stretch N" next to the standard. */
  stretch?: number;
}

function bandClass(rate: number | null, bands?: PaceBands): string {
  if (rate == null || !bands) return "";
  if (rate >= bands.green) return "text-emerald-600 dark:text-emerald-400";
  if (rate >= bands.amber) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

/** Deterministic per-hour rotation — everyone at the station sees the same
 *  nudge, and it changes through the day without a re-render loop. */
function pickLeanMessage(unitNoun: string, count: number, perUnitSeconds = 2): string {
  const gainMin = Math.max(1, Math.round((count * perUnitSeconds) / 60));
  const messages = [
    `Lean thinking: save just ${perUnitSeconds} seconds per ${unitNoun} and today gains ~${gainMin} minute${gainMin === 1 ? "" : "s"}.`,
    `Don't speed up — remove waste. What's the one movement you could cut from each ${unitNoun}?`,
    `Smooth is fast: set the next ${unitNoun} up before you need it, and the pace looks after itself.`,
    `Had to stop? That's not lost pace, it's a problem worth flagging — drop it in Quick Idea.`,
  ];
  return messages[new Date().getHours() % messages.length];
}

export function PaceKpiStrip({ rate, rateUnit, count, countLabel, activeMinutes, bands, unitNoun, className }: {
  /** Units per active hour, null while unmeasurable. */
  rate: number | null;
  /** e.g. "Orders / hour", "Packs / hour". */
  rateUnit: string;
  count: number;
  /** e.g. "Packed today", "Wrapped today". */
  countLabel: string;
  activeMinutes: number | null;
  bands?: PaceBands;
  /** Singular noun for the lean nudge: "order", "pack". */
  unitNoun: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wider mb-1">
            <Gauge className="w-3.5 h-3.5" />
            {rateUnit}
          </div>
          <div className={cn("text-3xl font-bold tabular-nums font-display", bandClass(rate, bands))}>
            {rate != null ? (Number.isInteger(rate) ? rate : rate.toFixed(1)) : "—"}
          </div>
          {bands && (
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              standard {bands.green}
              {bands.stretch ? ` · stretch ${bands.stretch}` : ""}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{countLabel}</div>
          <div className="text-3xl font-bold tabular-nums font-display">{count}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Active time</div>
          <div className="text-3xl font-bold tabular-nums font-display">
            {activeMinutes != null
              ? activeMinutes >= 60
                ? `${Math.floor(activeMinutes / 60)}h ${activeMinutes % 60}m`
                : `${activeMinutes}m`
              : "—"}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground italic border-t border-border pt-2">
        {pickLeanMessage(unitNoun, count)}
      </p>
    </div>
  );
}
