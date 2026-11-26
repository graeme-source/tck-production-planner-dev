/**
 * Each KPI's day-by-day figures, drawn with the shared trend graph
 * (kpi-trend-chart.tsx). Every figure comes from the KPI's own existing
 * endpoint, through the same hooks (and cache) as the rest of the page —
 * nothing is worked out here. Used by the Trend panel under an All KPIs card
 * and at the top of each KPI's own view. Objective G.
 */
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useRunRateReport } from "@/hooks/use-run-rate-report";
import { useProductionKpis } from "@/hooks/use-production-kpis";
import { useDefectSummary } from "@/hooks/use-defects";
import { amberFrom, type ProductionKpi } from "@/lib/production-kpis";
import { RUN_RATE_STANDARD } from "@/lib/station-kpi-bands";
import { runRateSeries, type KpiViewId } from "@/lib/kpis-page";
import { BELOW_PCT, GREAT_PCT, type EffDay } from "@/lib/team-efficiency-view";
import type { TrendBands, TrendRow } from "@/lib/kpi-trend-bands";
import { useRoomKpi } from "@/components/room-kpi-card";
import { useWrappingSpeedHistory } from "@/components/wrapping-speed-report";
import { usePackingSpeed } from "./packing-speed-report";
import { RunRateChart } from "./run-rate-chart";
import { RunRateDayChart } from "./run-rate-day-chart";
import { KpiTrendChart } from "./kpi-trend-chart";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pct = (n: number) => `${one(n)}%`;

/** A KPI's stored standard + stretch, as the graph's bands. */
export function kpiBands(kpi: ProductionKpi): TrendBands {
  return { stretch: kpi.stretch, standard: kpi.standard, close: amberFrom(kpi) };
}

function Loading() {
  return <p className="py-16 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Loading the days…</p>;
}

function Problem({ text }: { text: string }) {
  return <p className="py-12 text-center text-muted-foreground">{text}</p>;
}

export function RunRateTrend({ from, to }: { from: string; to: string }) {
  // One day: how the number moved through it, in 15-minute steps (26 Nov 2026).
  if (from === to) return <RunRateDayChart date={from} standard={RUN_RATE_STANDARD} />;
  return <RunRateRangeTrend from={from} to={to} />;
}

function RunRateRangeTrend({ from, to }: { from: string; to: string }) {
  const { data, isLoading, isError } = useRunRateReport(from, to);
  const points = useMemo(() => runRateSeries(data?.dailyDetail ?? [], RUN_RATE_STANDARD), [data]);
  if (isLoading) return <Loading />;
  if (isError) return <Problem text="Couldn't load the run rate." />;
  return <RunRateChart points={points} standard={RUN_RATE_STANDARD} />;
}

/** The room's scored days. The endpoint keeps the last six weeks; a range
 *  narrows them. */
export function RoomTrend({ from, to }: { from?: string; to?: string }) {
  const { data, isLoading, isError } = useRoomKpi();
  const rows = useMemo<TrendRow[]>(() => (data?.days ?? [])
    .filter(d => d.status === "ok" && (!from || d.date >= from) && (!to || d.date <= to))
    .map(d => ({ date: d.date, value: d.score, note: `${d.boxes} boxes · ${d.packs} packs · ${d.deliveries} deliveries · ${one(d.paidHours)} paid hours` })), [data, from, to]);
  if (isLoading) return <Loading />;
  if (isError) return <Problem text="Couldn't load the room's days." />;
  return (
    <KpiTrendChart rows={rows} unit="% of a typical day" format={pct}
      bands={{ stretch: 110, standard: 100, close: 90 }} bandLabels={{ standard: "Typical day" }} />
  );
}

export function PackingTrend({ from, to }: { from: string; to: string }) {
  const { data, isLoading, isError } = usePackingSpeed(from, to);
  const { kpis } = useProductionKpis();
  const rows = useMemo<TrendRow[]>(() => (data?.dailyRows ?? []).map(d => ({
    date: d.date, value: d.ordersPerHour, note: `${d.count.toLocaleString("en-GB")} orders`,
  })), [data]);
  if (isLoading) return <Loading />;
  if (isError) return <Problem text="Couldn't reach Shopify for the packing days." />;
  return <KpiTrendChart rows={rows} unit="orders an hour" format={one} bands={kpiBands(kpis.packing)} />;
}

export function WrappingTrend({ from, to }: { from: string; to: string }) {
  const { data, isLoading, isError } = useWrappingSpeedHistory(from, to);
  const { kpis } = useProductionKpis();
  const rows = useMemo<TrendRow[]>(() => (data?.days ?? []).map(d => ({
    date: d.date, value: d.packsPerHour, note: `${d.packs.toLocaleString("en-GB")} packs`,
  })), [data]);
  if (isLoading) return <Loading />;
  if (isError) return <Problem text="Couldn't load the wrapping days." />;
  return <KpiTrendChart rows={rows} unit="packs an hour" format={one} bands={kpiBands(kpis.wrapping)} />;
}

export function EfficiencyTrend({ from, to }: { from: string; to: string }) {
  const query = `from=${from}&to=${to}`;
  const { data, isLoading, isError } = useQuery<{ ready: boolean; report?: { days: EffDay[] } }>({
    queryKey: ["team-efficiency", query],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/team-efficiency?${query}`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load team efficiency");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const rows = useMemo<TrendRow[]>(() => (data?.report?.days ?? [])
    .filter(d => d.status === "ok")
    .map(d => ({ date: d.date, value: d.efficiencyPct, note: `${d.packsDespatched.toLocaleString("en-GB")} packs despatched` })), [data]);
  if (isLoading) return <Loading />;
  if (isError) return <Problem text="Couldn't load team efficiency." />;
  return (
    <KpiTrendChart rows={rows} unit="% of standard" format={pct}
      bands={{ stretch: GREAT_PCT, standard: BELOW_PCT, close: null }} bandLabels={{ stretch: "Great", standard: "On target" }} />
  );
}

export function DefectsTrend({ from, to }: { from: string; to: string }) {
  const { data, isLoading, isError } = useDefectSummary({ from, to });
  if (isLoading) return <Loading />;
  if (isError || !data) return <Problem text="Couldn't load the defect days." />;
  return <DefectsTrendChart byDay={data.byDay} />;
}

/** Defects have no target yet: a plain line, where lower is better. */
export function DefectsTrendChart({ byDay }: { byDay: Array<{ date: string; defects: number; packsMade: number; pct: number | null }> }) {
  const rows = byDay.filter(d => d.packsMade > 0).map(d => ({
    date: d.date, value: d.pct, note: `${d.defects} of ${d.packsMade.toLocaleString("en-GB")} packs`,
  }));
  return <KpiTrendChart rows={rows} unit="% of packs made" format={pct} bands={null} hint="Lower is better" />;
}

const TREND_TITLE: Partial<Record<KpiViewId, string>> = {
  "run-rate": "TCK run rate",
  room: "Packing & wrapping room",
  packing: "Packing speed",
  wrapping: "Wrapping speed",
  efficiency: "Team efficiency",
  defects: "Defects & waste",
};

/** The graph for one KPI over a range. */
export function KpiTrend({ id, from, to }: { id: KpiViewId; from: string; to: string }) {
  switch (id) {
    case "run-rate": return <RunRateTrend from={from} to={to} />;
    case "room": return <RoomTrend from={from} to={to} />;
    case "packing": return <PackingTrend from={from} to={to} />;
    case "wrapping": return <WrappingTrend from={from} to={to} />;
    case "efficiency": return <EfficiencyTrend from={from} to={to} />;
    case "defects": return <DefectsTrend from={from} to={to} />;
    default: return null;
  }
}

/** A card holding a KPI's trend, with a title and (in the overview) an X. */
export function TrendCard({ id, title, onClose, children, className }: {
  id?: KpiViewId; title?: string; onClose?: () => void; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-3xl border-2 border-border bg-card p-5 lg:p-6 shadow-sm space-y-3 min-w-0 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <h2 className="flex-1 text-xl font-display font-extrabold">{title ?? (id ? `${TREND_TITLE[id] ?? ""} — trend` : "Trend")}</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close the trend" className="w-10 h-10 rounded-full hover:bg-secondary flex items-center justify-center shrink-0">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
