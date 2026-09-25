/**
 * Team efficiency — Analytics (Objective I; feeds E/G). Graeme, 2026-09-25:
 * "an analytics section in the KPIs bit ... a line graph that shows me what
 * we've been doing over recent times ... backdate it ... 12 months".
 *
 * Managers and admins see percentages, packs and orders. The founder also
 * sees value credited, labour cost, R and the settings — the SERVER decides
 * that (GET /api/team-efficiency strips £ for everyone else); this page only
 * renders what arrives. Lives in Analytics only for now (Graeme: nothing on
 * the dashboard or meetings until it's right).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, AlertTriangle, Clock, Loader2, Minus, Info } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { TeamEfficiencyChart } from "@/components/team-efficiency-chart";
import { TeamEfficiencySettings, type EffSettings } from "@/components/team-efficiency-settings";
import {
  RANGES, BAND_LABEL, band, pctLabel, trend, changeLabel, chartPoints, lineOrder,
  dayLabel, weekLabel, monthLabel, gbp,
  type RangeKey, type EffDay, type EffPeriod, type EffHeadline, type Band, type ChartPoint,
} from "@/lib/team-efficiency-view";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface EffResponse {
  ready: boolean;
  founder: boolean;
  range?: RangeKey;
  report?: { range: { from: string; to: string }; headline: EffHeadline; days: EffDay[]; weekly: EffPeriod[]; monthly: EffPeriod[] };
  lines?: string[];
  meta?: { historyFrom: string | null; historyTo: string | null; lastComputedAt: string | null; backfillDone: boolean; running: boolean };
  settings?: EffSettings;
}

async function fetchEfficiency(range: RangeKey): Promise<EffResponse> {
  const res = await fetch(`${BASE}/api/team-efficiency?range=${range}`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 403 ? "Managers only" : `Couldn't load team efficiency (${res.status})`);
  return res.json();
}

type View = "daily" | "weekly" | "monthly";

const BAND_STYLE: Record<Band, string> = {
  great: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  on: "bg-secondary text-foreground",
  below: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  none: "bg-secondary text-muted-foreground",
};

function BandChip({ pct }: { pct: number | null | undefined }) {
  const b = band(pct);
  return <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold", BAND_STYLE[b])}>{BAND_LABEL[b]}</span>;
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ key: T; label: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-2xl bg-secondary/60 p-1 gap-1">
      {options.map(o => (
        <button
          key={o.key} type="button" onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={cn(
            "px-4 py-2 rounded-xl text-sm font-semibold transition-colors min-h-[40px]",
            value === o.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >{o.label}</button>
      ))}
    </div>
  );
}

function Headline({ h, founder, days }: { h: EffHeadline; founder: boolean; days: EffDay[] }) {
  const t = trend(h.changePts);
  const Arrow = t === "up" ? ArrowUp : t === "down" ? ArrowDown : t === "flat" ? ArrowRight : Minus;
  const span = h.from && h.to ? `${dayLabel(h.from)} – ${dayLabel(h.to)}` : "No counted days yet";
  const win = founder && h.from && h.to ? days.filter(d => d.status === "ok" && d.date >= h.from! && d.date <= h.to!) : [];
  const credited = win.reduce((n, d) => n + (d.valueCredited ?? 0), 0);
  const labour = win.reduce((n, d) => n + (d.labourCost ?? 0), 0);
  return (
    <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <p className="text-base font-semibold text-muted-foreground">Last 7 production days</p>
      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-3">
        <span className="text-6xl sm:text-7xl font-extrabold tabular-nums leading-none">{pctLabel(h.pct)}</span>
        <BandChip pct={h.pct} />
      </div>
      <div className={cn(
        "mt-4 flex items-center gap-2 text-lg font-semibold",
        t === "up" ? "text-emerald-700 dark:text-emerald-300" : t === "down" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
      )}>
        <Arrow className="w-5 h-5" aria-hidden />
        <span>{changeLabel(h.changePts)}</span>
        {h.previousPct != null && <span className="text-muted-foreground font-normal">(was {pctLabel(h.previousPct)})</span>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{span}</p>
      {founder && labour > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {gbp(credited)} credited on {gbp(labour)} of labour — R {(credited / labour).toFixed(2)}
        </p>
      )}
    </section>
  );
}

function FlagList({ flags }: { flags: EffDay["flags"] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="space-y-0.5">
      {flags.map((f, i) => (
        <li key={i} className={cn("flex items-start gap-1.5 text-sm", f.code === "pending_approval" ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300")}>
          {f.code === "pending_approval" ? <Clock className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

const th = "px-3 py-3 text-left text-sm font-semibold text-muted-foreground whitespace-nowrap";
const td = "px-3 py-3 align-top tabular-nums";

function DailyTable({ days, lines, founder }: { days: EffDay[]; lines: string[]; founder: boolean }) {
  const rows = [...days].reverse();
  return (
    <div className="overflow-x-auto -mx-5 sm:mx-0">
      <table className="w-full min-w-[640px] text-base">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Day</th>
            {lines.map(l => <th key={l} className={cn(th, "text-right")}>{l}</th>)}
            <th className={cn(th, "text-right")}>8-pk bags</th>
            <th className={cn(th, "text-right")}>Orders out</th>
            <th className={cn(th, "text-right")}>Efficiency</th>
            <th className={cn(th, "text-right")}>7-day</th>
            {founder && <th className={cn(th, "text-right")}>Credited</th>}
            {founder && <th className={cn(th, "text-right")}>Labour</th>}
            {founder && <th className={cn(th, "text-right")}>R</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(d => (
            <tr key={d.date} className={cn(d.status !== "ok" && "bg-secondary/30")}>
              <td className={cn(td, "font-semibold whitespace-nowrap")}>
                {dayLabel(d.date)}
                <div className="font-normal mt-1 max-w-[18rem] whitespace-normal"><FlagList flags={d.flags} /></div>
              </td>
              {lines.map(l => <td key={l} className={cn(td, "text-right")}>{d.packsByLine[l] ?? "—"}</td>)}
              <td className={cn(td, "text-right")}>{d.eightPackBags || "—"}</td>
              <td className={cn(td, "text-right")}>{d.ordersDespatched}</td>
              <td className={cn(td, "text-right font-bold")}>{d.status === "ok" ? pctLabel(d.efficiencyPct) : "—"}</td>
              <td className={cn(td, "text-right text-muted-foreground")}>{pctLabel(d.rollingPct)}</td>
              {founder && <td className={cn(td, "text-right")}>{gbp(d.valueCredited)}</td>}
              {founder && <td className={cn(td, "text-right")}>{gbp(d.labourCost)}</td>}
              {founder && <td className={cn(td, "text-right")}>{d.ratio != null ? d.ratio.toFixed(2) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodTable({ periods, label, founder }: { periods: EffPeriod[]; label: (p: string) => string; founder: boolean }) {
  const rows = [...periods].reverse();
  return (
    <div className="overflow-x-auto -mx-5 sm:mx-0">
      <table className="w-full min-w-[520px] text-base">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Period</th>
            <th className={cn(th, "text-right")}>Days counted</th>
            <th className={cn(th, "text-right")}>Packs</th>
            <th className={cn(th, "text-right")}>Orders out</th>
            <th className={cn(th, "text-right")}>Efficiency</th>
            {founder && <th className={cn(th, "text-right")}>Credited</th>}
            {founder && <th className={cn(th, "text-right")}>Labour</th>}
            {founder && <th className={cn(th, "text-right")}>R</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(p => (
            <tr key={p.period}>
              <td className={cn(td, "font-semibold whitespace-nowrap")}>{label(p.period)}</td>
              <td className={cn(td, "text-right")}>
                {p.countedDays}
                {p.flaggedDays > 0 && <span className="text-sm text-muted-foreground"> (+{p.flaggedDays} not counted)</span>}
              </td>
              <td className={cn(td, "text-right")}>{p.packs.toLocaleString("en-GB")}</td>
              <td className={cn(td, "text-right")}>{p.orders.toLocaleString("en-GB")}</td>
              <td className={cn(td, "text-right font-bold")}>{pctLabel(p.pct)}</td>
              {founder && <td className={cn(td, "text-right")}>{gbp(p.valueCredited)}</td>}
              {founder && <td className={cn(td, "text-right")}>{gbp(p.labourCost)}</td>}
              {founder && <td className={cn(td, "text-right")}>{p.ratio != null ? p.ratio.toFixed(2) : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function periodPoints(periods: EffPeriod[], toDate: (p: string) => string): ChartPoint[] {
  return periods.filter(p => p.pct != null).map(p => {
    const date = toDate(p.period);
    return { date: p.period, t: Date.parse(`${date}T12:00:00Z`), daily: null, rolling: p.pct };
  });
}

export default function TeamEfficiencyPage() {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const allowed = role === "admin" || role === "manager";
  const [range, setRange] = useState<RangeKey>("3m");
  const [view, setView] = useState<View>("daily");

  const q = useQuery({
    queryKey: ["team-efficiency", range],
    queryFn: () => fetchEfficiency(range),
    enabled: allowed,
    staleTime: 5 * 60_000,
  });

  const data = q.data;
  const report = data?.report;
  const founder = Boolean(data?.founder);
  const lines = useMemo(() => (report ? lineOrder(report.days) : []), [report]);
  const points = useMemo<ChartPoint[]>(() => {
    if (!report) return [];
    if (view === "weekly") return periodPoints(report.weekly, p => p);
    if (view === "monthly") return periodPoints(report.monthly, p => `${p}-15`);
    return chartPoints(report.days);
  }, [report, view]);

  const header = <PageHeader title="Team efficiency" />;

  if (!allowed) {
    return (
      <div className="p-5 sm:p-8">{header}
        <div className="rounded-3xl border border-border bg-card p-8 text-lg">Team efficiency is for managers.</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-6xl mx-auto">
      {header}
      <p className="text-lg text-muted-foreground">
        Good packs made (and orders sent) for every £1 of production wages, as a percentage of our standard. 100% is standard, 110% and up is great, under 90% is below.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<RangeKey> label="Time range" value={range} options={RANGES} onChange={setRange} />
        <Segmented<View> label="Show" value={view} onChange={setView}
          options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]} />
        {q.isFetching && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>

      {q.isLoading && <div className="rounded-3xl border border-border bg-card p-8 text-muted-foreground">Loading…</div>}
      {q.error && (
        <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-destructive flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" /> {(q.error as Error).message}
        </div>
      )}
      {data && !data.ready && (
        <div className="rounded-3xl border border-border bg-card p-6 text-muted-foreground">Setting up — the figures appear after the next restart.</div>
      )}

      {report && data?.meta && !data.meta.backfillDone && (
        <div className="rounded-2xl border border-border bg-secondary/40 p-4 flex items-start gap-2 text-base">
          <Info className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
          <span>Working out the history from Planday — older days will fill in over the next few minutes.</span>
        </div>
      )}

      {report && (
        <>
          <Headline h={report.headline} founder={founder} days={report.days} />

          <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">
                {view === "daily" ? "Each day, and the last-7-days line" : view === "weekly" ? "Week by week" : "Month by month"}
              </h2>
              {view === "daily" && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-primary/40" /> A day</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-0.5 bg-primary" /> Last 7 days</span>
                </div>
              )}
            </div>
            <TeamEfficiencyChart
              points={points}
              mode={view === "daily" ? "daily" : "period"}
              periodLabel={view === "weekly" ? weekLabel : view === "monthly" ? monthLabel : undefined}
            />
            {data?.meta?.historyFrom && (
              <p className="text-sm text-muted-foreground">
                History starts {dayLabel(data.meta.historyFrom)}, when production counts began. Days with output that wasn't counted are shown but left out of every average.
              </p>
            )}
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-3">
            <h2 className="text-xl font-bold">
              {view === "daily" ? "Day by day" : view === "weekly" ? "Weekly figures" : "Monthly figures"}
            </h2>
            {view === "daily" && <DailyTable days={report.days} lines={lines} founder={founder} />}
            {view === "weekly" && <PeriodTable periods={report.weekly} label={weekLabel} founder={founder} />}
            {view === "monthly" && <PeriodTable periods={report.monthly} label={monthLabel} founder={founder} />}
          </section>

          {founder && data?.settings && <TeamEfficiencySettings settings={data.settings} />}
        </>
      )}
    </div>
  );
}
