/**
 * TCK run rate over a date range (Analytics → KPIs, Graeme 17 Nov 2026: "a
 * line graph of the run rate KPI over the last 3 months, with a rolling
 * average, to show whether it's going up or down").
 *
 *   - grey dots: each production day's own run rate,
 *   - the strong line: the 7-production-day rolling average (the trend),
 *   - faint bands behind: the dashboard's colours for the line standard —
 *     platinum / green / yellow / red — with labelled lines at their edges.
 *     Position against the labelled lines says the band; the wash only
 *     echoes it, so nothing depends on telling the colours apart.
 * Hover (or tap) anywhere for that day: its figure, its band, the average.
 * The day-by-day list under the chart is the table view.
 */
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, CartesianGrid } from "recharts";
import { BAND_RATIOS, BAND_WORDS } from "@/lib/station-kpi-bands";
import type { RunRatePoint } from "@/lib/kpis-page";

const dayLabel = (d: string, long = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", long
    ? { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }
    : { day: "numeric", month: "short", timeZone: "Europe/London" });

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Band washes — the dashboard's colours, very faint. */
const WASH = {
  platinum: "#0d9488",
  green: "#7cb342",
  amber: "#eab308",
  red: "#e11d48",
} as const;

const LINE = "hsl(var(--foreground))";
const DOT = "hsl(var(--muted-foreground))";

function TipBox({ active, payload }: { active?: boolean; payload?: Array<{ payload: RunRatePoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm space-y-1 min-w-44">
      <p className="font-semibold">{dayLabel(p.date, true)}</p>
      <p className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DOT }} />
        <span className="font-bold tabular-nums">{p.daily == null ? "—" : fmt(p.daily)}</span>
        <span className="text-muted-foreground">that day{p.daily != null && p.band !== "neutral" ? ` · ${BAND_WORDS[p.band]}` : ""}</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="w-3 h-0.5 rounded shrink-0" style={{ background: LINE }} />
        <span className="font-bold tabular-nums">{p.rolling == null ? "—" : fmt(p.rolling)}</span>
        <span className="text-muted-foreground">7-day average</span>
      </p>
      <p className="text-muted-foreground">{p.batches} batches</p>
    </div>
  );
}

export function RunRateChart({ points, standard }: { points: RunRatePoint[]; standard: number }) {
  const platinum = Math.round(standard * BAND_RATIOS.platinum * 10) / 10;
  const amber = Math.round(standard * BAND_RATIOS.amber * 10) / 10;
  const values = points.flatMap(p => [p.daily, p.rolling]).filter((v): v is number => v != null);
  // Clean ticks: steps of 2 or 4 (or more), never odd jumps like 6, 11, 16.
  const rawLo = Math.min(amber - 2, ...values);
  const rawHi = Math.max(platinum + 2, ...values);
  const step = Math.max(2, Math.ceil((rawHi - rawLo) / 6 / 2) * 2);
  const lo = Math.max(0, Math.floor(rawLo / step) * step);
  const hi = Math.ceil(rawHi / step) * step;
  const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);

  if (points.filter(p => p.daily != null).length < 2) {
    return <p className="py-16 text-center text-muted-foreground">Not enough production days in this range for a trend.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Legend — two series, so always shown. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: DOT }} /> Each day</span>
        <span className="inline-flex items-center gap-2"><span className="w-5 h-[3px] rounded" style={{ background: LINE }} /> 7-day average</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: WASH.platinum, opacity: 0.35 }} /> Platinum {fmt(platinum)}+</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: WASH.green, opacity: 0.35 }} /> Green {fmt(standard)}+</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: WASH.amber, opacity: 0.35 }} /> Yellow {fmt(amber)}+</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: WASH.red, opacity: 0.35 }} /> Red under {fmt(amber)}</span>
      </div>
      <div className="h-[340px] lg:h-[420px] w-full" data-no-swipe role="img" aria-label={`TCK run rate each production day with its 7-day average, ${points.length} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 88, bottom: 0, left: 0 }}>
            <ReferenceArea y1={platinum} y2={hi} fill={WASH.platinum} fillOpacity={0.08} ifOverflow="hidden" />
            <ReferenceArea y1={standard} y2={platinum} fill={WASH.green} fillOpacity={0.1} ifOverflow="hidden" />
            <ReferenceArea y1={amber} y2={standard} fill={WASH.amber} fillOpacity={0.1} ifOverflow="hidden" />
            <ReferenceArea y1={lo} y2={amber} fill={WASH.red} fillOpacity={0.06} ifOverflow="hidden" />
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="date" tickFormatter={d => dayLabel(d)} minTickGap={28} axisLine={false} tickLine={false}
              tick={{ fontSize: 13, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={[lo, hi]} ticks={ticks} allowDecimals={false} width={40} axisLine={false} tickLine={false}
              tick={{ fontSize: 13, fill: "hsl(var(--muted-foreground))" }} />
            <ReferenceLine y={platinum} stroke={WASH.platinum} strokeOpacity={0.7} ifOverflow="hidden"
              label={{ value: `Platinum ${fmt(platinum)}`, position: "right", fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <ReferenceLine y={standard} stroke={WASH.green} strokeWidth={1.5} ifOverflow="hidden"
              label={{ value: `Standard ${fmt(standard)}`, position: "right", fontSize: 12, fontWeight: 600, fill: "hsl(var(--foreground))" }} />
            <ReferenceLine y={amber} stroke={WASH.amber} strokeOpacity={0.8} ifOverflow="hidden"
              label={{ value: `Yellow ${fmt(amber)}`, position: "right", fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={<TipBox />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1 }} />
            {/* Each day: grey dots, no line between them. */}
            <Line dataKey="daily" stroke="none" isAnimationActive={false} legendType="none"
              dot={(props: { cx?: number; cy?: number; index?: number; value?: number | null }) => {
                const { cx, cy, index, value } = props;
                if (cx == null || cy == null || value == null) return <g key={`d${index}`} />;
                return <circle key={`d${index}`} cx={cx} cy={cy} r={4} fill={DOT} fillOpacity={0.75} stroke="hsl(var(--card))" strokeWidth={2} />;
              }}
              activeDot={{ r: 6, fill: DOT, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
            {/* The trend. */}
            <Line dataKey="rolling" type="monotone" stroke={LINE} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
              dot={false} connectNulls isAnimationActive={false}
              activeDot={{ r: 6, fill: LINE, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
