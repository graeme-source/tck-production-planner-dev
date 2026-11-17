/**
 * Analytics → KPIs → TCK run rate: headline figures for the range, the trend
 * chart (each day + 7-day rolling average against the line standard's
 * bands), the targets and settings, then the old Analytics detail (builders,
 * day by day). All from GET /api/reports/production-kpis — the server's
 * lib/run-rate.ts — so these figures match the station, dashboard and
 * meetings. Objective G.
 */
import { useMemo } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunRateReport } from "@/hooks/use-run-rate-report";
import { RUN_RATE_STANDARD, BAND_ICON_CLASS, BAND_WORDS, kpiBand } from "@/lib/station-kpi-bands";
import { rangeTrend, runRateSeries, trendWords, RUN_RATE_ROLLING_DAYS } from "@/lib/kpis-page";
import { RunRateChart } from "./run-rate-chart";
import { RunRateSettings } from "./run-rate-settings";
import { RunRateDetail } from "./run-rate-detail";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

export function Stat({ label, value, sub, chip }: { label: string; value: string; sub?: string; chip?: { text: string; className: string } }) {
  return (
    <div className="rounded-3xl border-2 border-border bg-card p-5 shadow-sm min-w-0">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-4xl font-display font-extrabold leading-tight">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {chip && <span className={cn("rounded-full px-2.5 py-0.5 text-sm font-semibold", chip.className)}>{chip.text}</span>}
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

export function RunRateView({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { data, isLoading, isError, isFetching } = useRunRateReport(fromDate, toDate);
  const points = useMemo(() => runRateSeries(data?.dailyDetail ?? [], RUN_RATE_STANDARD), [data]);
  const trend = rangeTrend(points);
  const avg = data?.overview.overallBph ?? null;
  const avgBand = kpiBand({ rate: avg, activeMinutes: data?.overview.totalActiveMinutes ?? 0 }, RUN_RATE_STANDARD);
  const daysAtStandard = points.filter(p => p.band === "green" || p.band === "platinum").length;
  const daysCounted = points.filter(p => p.daily != null).length;
  const TrendIcon = trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : ArrowRight;

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : isError || !data ? (
        <p className="text-muted-foreground py-8">Couldn't load the run rate.</p>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isFetching && "opacity-60")}>
          <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Run rate over the range"
              value={avg != null ? fmt(avg) : "—"}
              sub="batches an hour"
              chip={avg != null ? { text: BAND_WORDS[avgBand], className: BAND_ICON_CLASS[avgBand] } : undefined}
            />
            <Stat
              label="Trend"
              value={trend ? trendWords(trend) : "—"}
              sub={trend ? `${RUN_RATE_ROLLING_DAYS}-day average ${fmt(trend.start)} on ${day(trend.startDate)} → ${fmt(trend.end)} on ${day(trend.endDate)}` : "Needs more production days"}
              chip={trend ? {
                text: trend.direction === "flat" ? "Level" : trend.direction === "up" ? "Going up" : "Going down",
                className: trend.direction === "up" ? BAND_ICON_CLASS.green : trend.direction === "down" ? BAND_ICON_CLASS.red : BAND_ICON_CLASS.neutral,
              } : undefined}
            />
            <Stat label="Days at standard or better" value={`${daysAtStandard} of ${daysCounted}`} sub={`${fmt(RUN_RATE_STANDARD)}+ batches an hour`} />
            <Stat label="Batches built" value={data.overview.totalBatches.toLocaleString("en-GB")} sub={`${data.overview.uniqueDays} production days`} />
          </div>

          <section className="rounded-3xl border-2 border-border bg-card p-4 lg:p-6 shadow-sm space-y-3">
            <h2 className="text-2xl font-display font-extrabold flex items-center gap-2">
              TCK run rate
              {trend && <TrendIcon className={cn("w-6 h-6", trend.direction === "up" ? "text-[#558b2f]" : trend.direction === "down" ? "text-rose-600" : "text-muted-foreground")} aria-hidden />}
            </h2>
            <RunRateChart points={points} standard={RUN_RATE_STANDARD} />
          </section>
        </div>
      )}

      <RunRateSettings />

      <RunRateDetail fromDate={fromDate} toDate={toDate} />
    </div>
  );
}
