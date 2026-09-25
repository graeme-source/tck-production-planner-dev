/**
 * Team efficiency — "Today so far" live estimate tile (Objective I). The
 * real figure is only computed once every Planday shift is approved
 * (usually tomorrow), so this is labelled as an estimate everywhere and
 * refreshes every few minutes. Pounds, R and hours arrive only for the
 * founder — the server strips them for everyone else.
 */
import { Activity, AlertTriangle, Clock, Info, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BAND_LABEL, band, pctLabel, lineOrder, todayMessage, asOfLabel, gbp, type TodayEstimate, type EffHeadline,
} from "@/lib/team-efficiency-view";

export function TeamEfficiencyToday({ today, founder, lastSeven, error, loading }: {
  today: TodayEstimate | null;
  founder: boolean;
  /** Last 7 counted (approved) days, for context. */
  lastSeven: EffHeadline | null;
  /** Why there's no estimate (Planday unreachable etc.). */
  error: string | null;
  loading: boolean;
}) {
  const b = band(today?.estimatePct);
  const message = today ? todayMessage(today.status) : null;
  const lines = today ? lineOrder([today]) : [];
  return (
    <section className="rounded-3xl border-2 border-dashed border-primary/40 bg-card p-6 sm:p-8 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="w-5 h-5 text-primary" aria-hidden />
        <p className="text-base font-semibold">Today so far — live estimate</p>
        {today && <span className="text-sm text-muted-foreground">· {asOfLabel(today.asOf)}</span>}
      </div>

      {loading && !today && <p className="text-lg text-muted-foreground">Working out today's figure…</p>}
      {error && !today && (
        <p className="flex items-center gap-2 text-lg text-muted-foreground">
          <AlertTriangle className="w-5 h-5" /> {error} — efficiency available tomorrow once shifts are approved.
        </p>
      )}

      {today && (
        <>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            {message ? (
              <span className="text-3xl sm:text-4xl font-bold leading-tight">{message}</span>
            ) : (
              <>
                <span className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none">≈{pctLabel(today.estimatePct)}</span>
                <span className={cn(
                  "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold",
                  b === "great" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : b === "below" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                    : "bg-secondary text-foreground",
                )}>{BAND_LABEL[b]} so far</span>
              </>
            )}
          </div>
          <p className="flex items-start gap-2 text-base text-muted-foreground">
            <Info className="w-5 h-5 mt-0.5 shrink-0" aria-hidden />
            <span>
              An estimate from the packs counted so far and the hours worked up to now. The final figure comes tomorrow, once
              everyone's shifts are approved in Planday. It usually climbs through the afternoon as packs get counted.
            </span>
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {lines.map(l => (
              <div key={l} className="rounded-2xl bg-secondary/40 p-4">
                <p className="text-sm text-muted-foreground">{l}</p>
                <p className="text-3xl font-bold tabular-nums">{today.packsByLine[l] ?? 0}</p>
                <p className="text-sm text-muted-foreground">packs counted</p>
              </div>
            ))}
            {today.eightPackBags > 0 && (
              <div className="rounded-2xl bg-secondary/40 p-4">
                <p className="text-sm text-muted-foreground">8-pack bags</p>
                <p className="text-3xl font-bold tabular-nums">{today.eightPackBags}</p>
              </div>
            )}
            <div className="rounded-2xl bg-secondary/40 p-4">
              <p className="text-sm text-muted-foreground">Orders out</p>
              <p className="text-3xl font-bold tabular-nums">{today.ordersDespatched}</p>
              <p className="text-sm text-muted-foreground">despatched so far</p>
            </div>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" aria-hidden />
            {today.shiftsCounted} production shift{today.shiftsCounted === 1 ? "" : "s"} clocked in
            {today.shiftsNotStarted > 0 && ` · ${today.shiftsNotStarted} not clocked in yet (not counted)`}
          </p>

          {today.notes.length > 0 && (
            <ul className="space-y-1">
              {today.notes.map((n, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> <span>{n}</span>
                </li>
              ))}
            </ul>
          )}

          {founder && today.labourCost != null && today.labourCost > 0 && (
            <p className="text-sm text-muted-foreground">
              {gbp(today.valueCredited)} credited so far on {gbp(today.labourCost)} of labour
              ({(today.paidHours ?? 0).toFixed(1)} paid hours){today.ratio != null && ` — R ${today.ratio.toFixed(2)}`}
            </p>
          )}
        </>
      )}

      {lastSeven?.pct != null && (
        <p className="text-base border-t border-border pt-4">
          <span className="text-muted-foreground">For comparison, the last 7 approved production days: </span>
          <span className="font-bold tabular-nums">{pctLabel(lastSeven.pct)}</span>
        </p>
      )}
    </section>
  );
}
