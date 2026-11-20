/**
 * Analytics → KPIs → All KPIs: one big card per KPI with its figure for the
 * chosen range and how it stands against its target. Tap a card to open that
 * KPI. Every figure comes from the KPI's own existing endpoint — nothing is
 * worked out here. Objective G.
 */
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2 } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useRunRateReport } from "@/hooks/use-run-rate-report";
import { useProductionKpis } from "@/hooks/use-production-kpis";
import { useDefectSummary } from "@/hooks/use-defects";
import { pctText } from "@/lib/defects-view";
import { paceLevel, type PaceLevel } from "@/lib/production-kpis";
import { BAND_ICON_CLASS, BAND_WORDS, RUN_RATE_STANDARD, kpiBand, type KpiBand } from "@/lib/station-kpi-bands";
import { capRange, PACKING_OVERVIEW_DAYS, rangeTrend, runRateSeries, trendWords, type KpiViewId } from "@/lib/kpis-page";
import { band as effBand, BAND_LABEL as EFF_LABEL, pctLabel, type EffHeadline } from "@/lib/team-efficiency-view";
import { latestRoomDay, useRoomKpi } from "@/components/room-kpi-card";
import { roomSpeedsLine } from "@/lib/room-speeds-line";
import { overallWrappingRate, useWrappingSpeedHistory } from "@/components/wrapping-speed-report";
import { usePackingSpeed } from "./packing-speed-report";
import { TrendChip } from "@/components/sales-trend-panel";
import { KpiTrend, TrendCard } from "./kpi-trends";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });

const PACE_BAND: Record<PaceLevel, KpiBand> = { stretch: "platinum", standard: "green", close: "amber", below: "red" };
const PACE_WORDS: Record<PaceLevel, string> = { stretch: "Smashing it", standard: "On target", close: "Close", below: "Below target" };

interface TileProps {
  name: string;
  unit: string;
  loading?: boolean;
  value: string;
  chip?: { text: string; band: KpiBand };
  sub?: ReactNode;
  children?: ReactNode;
  onOpen: () => void;
  /** The Trend button at the foot (Graeme, 17 Nov 2026, like the Numbers tiles). */
  trend?: { open: boolean; onToggle: () => void };
  className?: string;
}

function Tile({ name, unit, loading, value, chip, sub, children, onOpen, trend, className }: TileProps) {
  return (
    <div className={cn("rounded-3xl border-2 bg-card shadow-sm transition-all min-w-0 flex flex-col",
      trend?.open ? "border-primary" : "border-border hover:border-primary/50 hover:shadow-md", className)}>
    <button
      type="button"
      onClick={onOpen}
      className="group text-left p-5 lg:p-6 pb-3 lg:pb-3 flex flex-col gap-2 flex-1 min-w-0 rounded-3xl"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-display font-extrabold leading-tight">{name}</h2>
          <p className="text-sm text-muted-foreground">{unit}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground shrink-0 mt-1" />
      </div>
      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground my-3" />
      ) : (
        <>
          <p className="text-5xl font-display font-extrabold leading-none mt-1">{value}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {chip && <span className={cn("rounded-full px-2.5 py-0.5 font-semibold", BAND_ICON_CLASS[chip.band])}>{chip.text}</span>}
            {sub && <span className="text-muted-foreground">{sub}</span>}
          </div>
        </>
      )}
      {children}
    </button>
    {trend && (
      <div className="px-5 lg:px-6 pb-4">
        <TrendChip open={trend.open} onClick={trend.onToggle} />
      </div>
    )}
    </div>
  );
}

function RunRateTile({ from, to, onOpen, trendToggle }: { from: string; to: string; onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  const { data, isLoading } = useRunRateReport(from, to);
  const points = useMemo(() => runRateSeries(data?.dailyDetail ?? [], RUN_RATE_STANDARD), [data]);
  const trend = rangeTrend(points);
  const avg = data?.overview.overallBph ?? null;
  const b = kpiBand({ rate: avg, activeMinutes: data?.overview.totalActiveMinutes ?? 0 }, RUN_RATE_STANDARD);
  const line = points.filter(p => p.rolling != null);
  return (
    <Tile
      name="TCK run rate" unit={`batches an hour · standard ${fmt(RUN_RATE_STANDARD)}`}
      loading={isLoading} value={avg != null ? fmt(avg) : "—"}
      chip={avg != null ? { text: BAND_WORDS[b], band: b } : undefined}
      sub={trend ? `${trendWords(trend)} over the range` : undefined}
      onOpen={onOpen}
      trend={trendToggle}
      className="sm:col-span-2"
    >
      {line.length >= 2 && (
        <div className="h-20 w-full" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={line} margin={{ top: 6, right: 4, bottom: 4, left: 4 }}>
              <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
              <Line dataKey="rolling" type="monotone" stroke="hsl(var(--foreground))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tile>
  );
}

function PackingTile({ from, to, onOpen, trendToggle }: { from: string; to: string; onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  // Live Shopify, one call per day — the overview asks for the last week only.
  const win = capRange(from, to, PACKING_OVERVIEW_DAYS);
  const { data, isLoading, isError } = usePackingSpeed(win.from, win.to);
  const { kpis } = useProductionKpis();
  const rate = data && data.ordersPerHour > 0 ? data.ordersPerHour : null;
  const level = rate != null ? paceLevel(rate, kpis.packing) : null;
  return (
    <Tile
      name="Packing speed" unit={`orders an hour · target ${fmt(kpis.packing.standard)}`}
      loading={isLoading} value={rate != null ? fmt(rate) : "—"}
      chip={level ? { text: PACE_WORDS[level], band: PACE_BAND[level] } : undefined}
      sub={isError ? "Couldn't reach Shopify" : data ? `${data.totalOrders.toLocaleString("en-GB")} orders${win.capped ? ` · last ${PACKING_OVERVIEW_DAYS} days` : ""}` : undefined}
      onOpen={onOpen}
      trend={trendToggle}
    />
  );
}

function WrappingTile({ from, to, onOpen, trendToggle }: { from: string; to: string; onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  const { data, isLoading } = useWrappingSpeedHistory(from, to);
  const { kpis } = useProductionKpis();
  const o = overallWrappingRate(data?.days ?? []);
  const level = o.rate != null ? paceLevel(o.rate, kpis.wrapping) : null;
  return (
    <Tile
      name="Wrapping speed" unit={`packs an hour · target ${fmt(kpis.wrapping.standard)}`}
      loading={isLoading} value={o.rate != null ? fmt(o.rate) : "—"}
      chip={level ? { text: PACE_WORDS[level], band: PACE_BAND[level] } : undefined}
      sub={`${o.packs.toLocaleString("en-GB")} packs`}
      onOpen={onOpen}
      trend={trendToggle}
    />
  );
}

function RoomTile({ onOpen, trendToggle }: { onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  const { data, isLoading } = useRoomKpi();
  // Today so far leads once the room has started (Graeme, 20 Nov 2026), with
  // boxes/hr and packs wrapped/hr under it; else the latest day.
  const today = data?.today?.score != null ? data.today : null;
  const latest = latestRoomDay(data);
  const shown = today ?? latest;
  return (
    <Tile
      name="Packing & wrapping room" unit="% of a typical day"
      loading={isLoading} value={shown?.score != null ? `${shown.score}%` : "—"}
      chip={shown && shown.band !== "neutral" ? { text: BAND_WORDS[shown.band], band: shown.band } : undefined}
      sub={today ? `Today so far · ${roomSpeedsLine(today)}${today.estimate ? " · estimate" : ""}` : latest ? `${day(latest.date)}${latest.status === "pending" ? " · estimate" : ""}` : undefined}
      onOpen={onOpen}
      trend={trendToggle}
    />
  );
}

const EFF_BAND: Record<ReturnType<typeof effBand>, KpiBand> = { great: "platinum", on: "green", below: "red", none: "neutral" };

function EfficiencyTile({ from, to, onOpen, trendToggle }: { from: string; to: string; onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  const query = `from=${from}&to=${to}`;
  const { data, isLoading } = useQuery<{ ready: boolean; report?: { headline: EffHeadline } }>({
    queryKey: ["team-efficiency", query],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/team-efficiency?${query}`, { credentials: "include" });
      if (!r.ok) throw new Error("Couldn't load team efficiency");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const pct = data?.report?.headline.pct ?? null;
  const b = effBand(pct);
  return (
    <Tile
      name="Team efficiency" unit="% of standard"
      loading={isLoading} value={pctLabel(pct)}
      chip={pct != null ? { text: EFF_LABEL[b], band: EFF_BAND[b] } : undefined}
      onOpen={onOpen}
      trend={trendToggle}
    />
  );
}

function DefectsTile({ from, to, onOpen, trendToggle }: { from: string; to: string; onOpen: () => void; trendToggle?: TileProps["trend"] }) {
  const { data, isLoading } = useDefectSummary({ from, to });
  return (
    <Tile
      name="Defects & waste" unit="% of packs made"
      loading={isLoading} value={pctText(data?.pct ?? null)}
      sub={data ? `${data.defects.toLocaleString("en-GB")} of ${data.packsMade.toLocaleString("en-GB")} packs · £${Math.round(data.waste.totalCost).toLocaleString("en-GB")} waste` : undefined}
      onOpen={onOpen}
      trend={trendToggle}
    />
  );
}

export function KpiOverview({ from, to, onOpen }: { from: string; to: string; onOpen: (id: KpiViewId) => void }) {
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : "viewer";
  const isManagerOrAdmin = role === "admin" || role === "manager";
  // One trend open at a time, full width under its card.
  const [trendOf, setTrendOf] = useState<KpiViewId | null>(null);
  const trend = (id: KpiViewId) => ({ open: trendOf === id, onToggle: () => setTrendOf(t => (t === id ? null : id)) });
  const tiles: Array<{ id: KpiViewId; node: ReactNode }> = [
    { id: "run-rate", node: <RunRateTile from={from} to={to} onOpen={() => onOpen("run-rate")} trendToggle={trend("run-rate")} /> },
    { id: "room", node: <RoomTile onOpen={() => onOpen("room")} trendToggle={trend("room")} /> },
    { id: "packing", node: <PackingTile from={from} to={to} onOpen={() => onOpen("packing")} trendToggle={trend("packing")} /> },
    { id: "wrapping", node: <WrappingTile from={from} to={to} onOpen={() => onOpen("wrapping")} trendToggle={trend("wrapping")} /> },
    ...(isManagerOrAdmin ? [{ id: "efficiency" as const, node: <EfficiencyTile from={from} to={to} onOpen={() => onOpen("efficiency")} trendToggle={trend("efficiency")} /> }] : []),
    { id: "defects", node: <DefectsTile from={from} to={to} onOpen={() => onOpen("defects")} trendToggle={trend("defects")} /> },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {tiles.map(t => (
        <Fragment key={t.id}>
          {t.node}
          {trendOf === t.id && (
            <TrendCard id={t.id} onClose={() => setTrendOf(null)} className="col-span-full">
              <KpiTrend id={t.id} from={from} to={to} />
            </TrendCard>
          )}
        </Fragment>
      ))}
    </div>
  );
}
