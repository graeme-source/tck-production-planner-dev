/**
 * TCK run rate in detail — the range's start/finish, each builder, and each
 * production day with its break deductions. Was Analytics' "Production KPIs"
 * tab (pages/reports.tsx) until 17 Nov 2026; now under Analytics → KPIs →
 * TCK run rate, below the trend chart. Same endpoint, same maths. Objective G.
 *
 * Each DAY is the whole line's run rate, so it's coloured against the line
 * standard (20, the dashboard's bands) — the server's day status compares it
 * with one building table's target (10), which made every day "Above".
 * Builders keep the server's status: they are per-table rates.
 */
import { useState } from "react";
import { format } from "date-fns";
import {
  ArrowDown, ArrowUp, CheckCircle, ChevronDown, ChevronRight, Clock, Coffee, Lightbulb, Loader2,
  Minus as MinusIcon, Play, Square, Timer, TrendingUp, Users, Utensils,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SummaryCard } from "@/components/reports/summary-card";
import { useRunRateReport, type KpiDay } from "@/hooks/use-run-rate-report";
import { BAND_ICON_CLASS, BAND_WORDS, RUN_RATE_STANDARD, kpiBand, type KpiBand } from "@/lib/station-kpi-bands";

const dayBand = (day: KpiDay): KpiBand => kpiBand({ rate: day.bph, activeMinutes: day.activeMinutes }, RUN_RATE_STANDARD);
const BAND_TEXT: Record<KpiBand, string> = {
  platinum: "text-teal-600", green: "text-[#558b2f]", amber: "text-yellow-700", red: "text-rose-600", neutral: "text-foreground",
};

export function RunRateDetail({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { data, isLoading, isError } = useRunRateReport(fromDate, toDate);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return <div className="text-center text-muted-foreground py-8">Couldn't load the run rate.</div>;
  }

  const toggleDate = (date: string) => {
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const fmtMins = (mins: number) =>
    mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <SummaryCard
          icon={<Play className="w-5 h-5 text-emerald-600" />}
          label="Start Time"
          value={data.overview.productionStartTime ? format(new Date(data.overview.productionStartTime), "HH:mm") : "—"}
          sub={data.overview.productionStartTime ? format(new Date(data.overview.productionStartTime), "d MMM yyyy") : "No data"}
        />
        <SummaryCard
          icon={<Square className="w-5 h-5 text-red-500" />}
          label="Finish Time"
          value={data.overview.productionFinishTime ? format(new Date(data.overview.productionFinishTime), "HH:mm") : "—"}
          sub={data.overview.wallClockMinutes > 0
            ? `${fmtMins(data.overview.wallClockMinutes)} wall clock`
            : "No data"}
        />
        <SummaryCard
          icon={<Timer className="w-5 h-5 text-amber-600" />}
          label="Active Time"
          value={fmtMins(data.overview.totalActiveMinutes)}
          sub={`Minus standard breaks (${data.breakConfig.morningMinutes}m + ${data.breakConfig.lunchMinutes}m lunch)`}
        />
      </div>

      {data.builders.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Builders
            <span className="text-xs text-muted-foreground font-normal">same calculation as the team number</span>
          </h2>
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">Builder</th>
                  <th className="px-4 py-3 font-medium text-center">Batches</th>
                  <th className="px-4 py-3 font-medium text-center">Run rate per builder</th>
                  <th className="px-4 py-3 font-medium text-center">Active Time</th>
                  <th className="px-4 py-3 font-medium text-center">Days</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.builders.map(b => (
                  <tr key={b.userId} className="hover:bg-secondary/10 transition-colors">
                    <td className="px-4 py-3 font-medium">{b.userName}</td>
                    <td className="px-4 py-3 text-center tabular-nums font-semibold">{b.totalBatches}</td>
                    <td className={cn("px-4 py-3 text-center tabular-nums font-bold", bphColor(b.status))}>
                      {b.bph ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                      {fmtMins(b.totalActiveMinutes)}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{b.daysWorked}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Daily Detail
        </h2>
        {data.dailyDetail.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">No production data found for this period</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.dailyDetail.map(day => {
              const isExpanded = expandedDates.has(day.date);
              return (
                <div key={day.date} className="rounded-2xl border border-border bg-card overflow-hidden">
                  <button
                    onClick={() => toggleDate(day.date)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors"
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    }
                    <span className="font-semibold text-sm">{format(new Date(day.date + "T00:00:00"), "EEE dd MMM yyyy")}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {day.batches} batch{day.batches !== 1 ? "es" : ""}
                      {day.windowStart && day.windowEnd && (
                        <> · {format(new Date(day.windowStart), "HH:mm")}–{format(new Date(day.windowEnd), "HH:mm")}</>
                      )}
                    </span>
                    <div className="ml-auto flex items-center gap-3">
                      <span className={cn("text-sm font-bold tabular-nums", BAND_TEXT[dayBand(day)])}>
                        {day.bph != null ? `${day.bph}/hr` : "—"}
                      </span>
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", BAND_ICON_CLASS[dayBand(day)])}>
                        {BAND_WORDS[dayBand(day)]}
                      </span>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Wall clock {fmtMins(day.wallClockMinutes)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Coffee className="w-3.5 h-3.5" />
                          {day.morningBreakDeducted ? `Morning break −${data.breakConfig.morningMinutes}m` : "Morning break not spanned"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Utensils className="w-3.5 h-3.5" />
                          {day.lunchBreakDeducted ? `Lunch −${data.breakConfig.lunchMinutes}m` : "Finished before lunch"}
                        </span>
                        {day.improvementCredit?.minutesApplied > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Lightbulb className="w-3.5 h-3.5" />
                            Improvements −{fmtMins(Math.round(day.improvementCredit.minutesApplied))} ({day.improvementCredit.improvements}; {day.bphBeforeCredit ?? "—"}/hr without)
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Timer className="w-3.5 h-3.5" /> Active {fmtMins(day.activeMinutes)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {day.finishSource === "marked" ? "Finish marked by builder" : "Finish = last batch (not marked)"}
                        </span>
                      </div>
                      {day.builders.length > 0 && (
                        <table className="w-full text-sm">
                          <thead className="bg-secondary/20 text-muted-foreground text-xs">
                            <tr>
                              <th className="px-3 py-2 font-medium text-left">Builder</th>
                              <th className="px-3 py-2 font-medium text-center">Batches</th>
                              <th className="px-3 py-2 font-medium text-center">Active</th>
                              <th className="px-3 py-2 font-medium text-center">Breaks</th>
                              <th className="px-3 py-2 font-medium text-center">Run rate per builder</th>
                              <th className="px-3 py-2 font-medium text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {day.builders.map(b => (
                              <tr key={b.userId} className="hover:bg-secondary/5 transition-colors">
                                <td className="px-3 py-2 font-medium">{b.userName}</td>
                                <td className="px-3 py-2 text-center tabular-nums font-semibold">{b.batches}</td>
                                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{fmtMins(b.activeMinutes)}</td>
                                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{b.breakMinutesDeducted}m</td>
                                <td className={cn("px-3 py-2 text-center tabular-nums font-bold", bphColor(b.status))}>
                                  {b.bph ?? "—"}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <StatusBadge status={b.status} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {day.recipes.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {day.recipes.map(r => `${r.name} (${r.count})`).join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </>
  );
}

function bphColor(status: string) {
  if (status === "above") return "text-emerald-600";
  if (status === "on-target") return "text-amber-600";
  if (status === "below") return "text-red-600";
  return "text-foreground";
}

function StatusBadge({ status }: { status: string }) {
  if (status === "above") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <ArrowUp className="w-3 h-3" /> Above
      </span>
    );
  }
  if (status === "on-target") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        <MinusIcon className="w-3 h-3" /> On Target
      </span>
    );
  }
  if (status === "below") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
        <ArrowDown className="w-3 h-3" /> Below
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground">
      — No Target
    </span>
  );
}

