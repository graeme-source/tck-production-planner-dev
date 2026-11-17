/**
 * The trend graph every KPI shares (Graeme, 17 Nov 2026: the run rate's line
 * graph "on all KPI windows", colour-coded, with hover, both axes labelled
 * so "we can see what we're actually measuring and over how long").
 *
 *   - a dot for each day, in that day's band colour (platinum / green /
 *     yellow / red against the KPI's targets; grey where there's no target),
 *   - the strong line: the 7-day average — the trend,
 *   - faint band washes behind, with labelled target lines at their edges,
 *     so position says the band and nothing depends on colour alone,
 *   - y axis titled with the unit; x axis with the days and the range.
 * Hover (or tap) anywhere for that day: its figure, its band in words, the
 * average and any note. Rules: lib/kpi-trend-bands.ts.
 */
import { useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, CartesianGrid, Label,
} from "recharts";
import { trendAxis, trendPoints, type TrendBand, type TrendBands, type TrendPoint, type TrendRow } from "@/lib/kpi-trend-bands";

const BAND_COLOUR: Record<TrendBand, string> = {
  platinum: "#0d9488",
  green: "#7cb342",
  amber: "#eab308",
  red: "#e11d48",
  neutral: "hsl(var(--muted-foreground))",
};
const BAND_NAME: Record<TrendBand, string> = { platinum: "Platinum", green: "On target", amber: "Close", red: "Below target", neutral: "" };
const LINE = "hsl(var(--foreground))";
const MUTED = "hsl(var(--muted-foreground))";

const dayLabel = (d: string, long = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", long
    ? { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }
    : { day: "numeric", month: "short", timeZone: "Europe/London" });

/** A point as drawn: freak days held to the top edge. */
interface DrawnPoint extends TrendPoint {
  shown: number | null;
  rollingShown: number | null;
}

export interface KpiTrendChartProps {
  rows: readonly TrendRow[];
  /** Targets, higher is better; null = no bands (a plain line). */
  bands: TrendBands | null;
  /** What's measured, for the y axis and the hover: "orders an hour". */
  unit: string;
  /** How a figure reads: 47.2 → "47.2", or "92%". */
  format: (n: number) => string;
  /** Names for the target lines (defaults: Platinum / Target / Yellow). */
  bandLabels?: { stretch?: string; standard?: string; close?: string };
  /** Shown under the legend, e.g. "Lower is better". */
  hint?: string;
  window?: number;
  className?: string;
}

function TipBox({ active, payload, unit, format, hasBands }: {
  active?: boolean; payload?: Array<{ payload: TrendPoint }>; unit: string; format: (n: number) => string; hasBands: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm space-y-1 min-w-48">
      <p className="font-semibold">{dayLabel(p.date, true)}</p>
      <p className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: BAND_COLOUR[p.band] }} />
        <span className="font-bold tabular-nums">{p.value == null ? "—" : format(p.value)}</span>
        <span className="text-muted-foreground">{unit}{p.value != null && hasBands && p.band !== "neutral" ? ` · ${BAND_NAME[p.band]}` : ""}</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="w-3 h-0.5 rounded shrink-0" style={{ background: LINE }} />
        <span className="font-bold tabular-nums">{p.rolling == null ? "—" : format(p.rolling)}</span>
        <span className="text-muted-foreground">7-day average</span>
      </p>
      {p.note && <p className="text-muted-foreground">{p.note}</p>}
    </div>
  );
}

export function KpiTrendChart({ rows, bands, unit, format, bandLabels, hint, window = 7, className }: KpiTrendChartProps) {
  const points = useMemo(() => trendPoints(rows, bands, window), [rows, bands, window]);
  const { lo, hi, ticks, capped } = useMemo(() => trendAxis(points, bands), [points, bands]);
  // A freak day sits on the top edge; the hover still gives its real figure.
  const drawn = useMemo<DrawnPoint[]>(() => points.map(p => ({
    ...p,
    shown: p.value == null ? null : Math.min(p.value, hi),
    rollingShown: p.rolling == null ? null : Math.min(p.rolling, hi),
  })), [points, hi]);
  const days = points.filter(p => p.value != null);
  if (days.length < 2) {
    return <p className="py-12 text-center text-muted-foreground">Not enough days with a figure in this range for a trend.</p>;
  }
  const names = {
    stretch: bandLabels?.stretch ?? "Platinum",
    standard: bandLabels?.standard ?? "Target",
    close: bandLabels?.close ?? "Yellow",
  };
  const first = points[0].date;
  const last = points[points.length - 1].date;
  const range = `${dayLabel(first, true)} – ${dayLabel(last, true)} · ${days.length} days with a figure`;

  return (
    <div className={className}>
      {/* Legend: the day dots, the average, and each band with its number. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground mb-2">
        <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: bands ? BAND_COLOUR.green : MUTED }} /> Each day{bands ? ", in its colour" : ""}</span>
        <span className="inline-flex items-center gap-2"><span className="w-5 h-[3px] rounded" style={{ background: LINE }} /> 7-day average</span>
        {bands?.stretch != null && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLOUR.platinum, opacity: 0.4 }} /> {names.stretch} {format(bands.stretch)}+</span>}
        {bands && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLOUR.green, opacity: 0.4 }} /> {names.standard} {format(bands.standard)}+</span>}
        {bands?.close != null && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLOUR.amber, opacity: 0.4 }} /> {names.close} {format(bands.close)}+</span>}
        {bands && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: BAND_COLOUR.red, opacity: 0.4 }} /> Red under {format(bands.close ?? bands.standard)}</span>}
        {hint && <span>{hint}</span>}
        {capped && <span>A day far above the rest sits on the top edge — hover it for the real figure.</span>}
      </div>
      <div className="h-[320px] lg:h-[400px] w-full" data-no-swipe role="img" aria-label={`${unit} each day with its 7-day average, ${range}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={drawn} margin={{ top: 8, right: bands ? 124 : 16, bottom: 28, left: 12 }}>
            {bands && (
              <>
                {bands.stretch != null && <ReferenceArea y1={bands.stretch} y2={hi} fill={BAND_COLOUR.platinum} fillOpacity={0.08} ifOverflow="hidden" />}
                <ReferenceArea y1={bands.standard} y2={bands.stretch ?? hi} fill={BAND_COLOUR.green} fillOpacity={0.1} ifOverflow="hidden" />
                {bands.close != null && <ReferenceArea y1={bands.close} y2={bands.standard} fill={BAND_COLOUR.amber} fillOpacity={0.1} ifOverflow="hidden" />}
                <ReferenceArea y1={lo} y2={bands.close ?? bands.standard} fill={BAND_COLOUR.red} fillOpacity={0.06} ifOverflow="hidden" />
              </>
            )}
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="date" tickFormatter={d => dayLabel(d)} minTickGap={28} tickLine={false}
              stroke="hsl(var(--border))" tick={{ fontSize: 13, fill: MUTED }}>
              <Label value={range} position="insideBottom" offset={-20} fontSize={12} fill={MUTED} />
            </XAxis>
            <YAxis domain={[lo, hi]} ticks={ticks} width={56} tickLine={false} stroke="hsl(var(--border))"
              tickFormatter={(v: number) => format(v)} tick={{ fontSize: 13, fill: MUTED }}>
              <Label value={unit} angle={-90} position="insideLeft" offset={-2} style={{ textAnchor: "middle" }} fontSize={12} fill={MUTED} />
            </YAxis>
            {bands?.stretch != null && (
              <ReferenceLine y={bands.stretch} stroke={BAND_COLOUR.platinum} strokeOpacity={0.7} ifOverflow="hidden"
                label={{ value: `${names.stretch} ${format(bands.stretch)}`, position: "right", fontSize: 12, fill: MUTED }} />
            )}
            {bands && (
              <ReferenceLine y={bands.standard} stroke={BAND_COLOUR.green} strokeWidth={1.5} ifOverflow="hidden"
                label={{ value: `${names.standard} ${format(bands.standard)}`, position: "right", fontSize: 12, fontWeight: 600, fill: "hsl(var(--foreground))" }} />
            )}
            {bands?.close != null && (
              <ReferenceLine y={bands.close} stroke={BAND_COLOUR.amber} strokeOpacity={0.8} ifOverflow="hidden"
                label={{ value: `${names.close} ${format(bands.close)}`, position: "right", fontSize: 12, fill: MUTED }} />
            )}
            <Tooltip content={<TipBox unit={unit} format={format} hasBands={bands != null} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
            {/* Each day: a dot in its band colour, no line between them. */}
            <Line dataKey="shown" stroke="none" isAnimationActive={false} legendType="none"
              dot={(props: { cx?: number; cy?: number; index?: number; value?: number | null }) => {
                const { cx, cy, index, value } = props;
                const p = index != null ? points[index] : undefined;
                if (cx == null || cy == null || value == null || !p) return <g key={`d${index}`} />;
                return <circle key={`d${index}`} cx={cx} cy={cy} r={4.5} fill={BAND_COLOUR[p.band]} stroke="hsl(var(--card))" strokeWidth={2} />;
              }}
              activeDot={{ r: 7, fill: LINE, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
            {/* The trend. */}
            <Line dataKey="rollingShown" type="monotone" stroke={LINE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              dot={false} connectNulls isAnimationActive={false}
              activeDot={{ r: 6, fill: LINE, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
