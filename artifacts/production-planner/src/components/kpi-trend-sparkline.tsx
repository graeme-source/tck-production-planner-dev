/**
 * Mini line chart for one KPI on the morning meeting's Last Production Day
 * slide (Graeme, 2026-10-22): the last 7 PRODUCTION days, oldest on the left,
 * the last production day on the right (its dot is filled). Day labels sit
 * under the line so the room can read it from across the floor; hover or tap
 * a point for the figure. The line takes the trend's colour — green when the
 * KPI is moving the good way, red the bad way, grey when level or neutral.
 * A day without a figure is a gap, never a fake zero.
 */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { trendDayLabel, type KpiTrend } from "@/lib/kpi-trend";

export const TREND_COLOUR: Record<KpiTrend["tone"], string> = {
  good: "#7cb342", // brand Fresh Basil
  bad: "#e11d48",  // rose-600
  neutral: "hsl(var(--muted-foreground))",
};

interface Point { day: string; value: number | null }

function TipBox({ active, payload, fmt }: { active?: boolean; payload?: Array<{ payload: Point }>; fmt: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-1.5 shadow-lg text-base">
      <span className="font-semibold">{new Date(`${p.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" })}</span>
      <span className="ml-2 tabular-nums">{p.value == null ? "no figure" : fmt(p.value)}</span>
    </div>
  );
}

export function KpiTrendSparkline({ days, values, tone, fmt, label }: {
  days: string[];
  values: Array<number | null>;
  tone: KpiTrend["tone"];
  fmt: (n: number) => string;
  label: string;
}) {
  const data: Point[] = days.map((day, i) => ({ day, value: values[i] ?? null }));
  if (data.filter(p => p.value != null).length < 2) {
    return <p className="text-base text-muted-foreground mt-3">Not enough production days for a trend yet</p>;
  }
  const colour = TREND_COLOUR[tone];
  const last = data.length - 1;
  return (
    <div className="h-24 w-full mt-2" data-no-swipe role="img" aria-label={`${label} over the last ${days.length} production days`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          {/* Padding keeps the first and last day labels whole at the edges. */}
          <XAxis dataKey="day" tickFormatter={trendDayLabel} interval={0} axisLine={false} tickLine={false} padding={{ left: 24, right: 24 }}
            tick={{ fontSize: 14, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip content={<TipBox fmt={fmt} />} cursor={{ stroke: "hsl(var(--border))" }} />
          <Line type="monotone" dataKey="value" stroke={colour} strokeWidth={3} isAnimationActive={false} connectNulls={false}
            dot={(props: { cx?: number; cy?: number; index?: number; value?: number | null }) => {
              const { cx, cy, index, value } = props;
              if (cx == null || cy == null || value == null) return <g key={`d${index}`} />;
              const isLast = index === last;
              return <circle key={`d${index}`} cx={cx} cy={cy} r={isLast ? 6 : 3.5} fill={isLast ? colour : "hsl(var(--card))"} stroke={colour} strokeWidth={2} />;
            }}
            activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
