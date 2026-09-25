/**
 * Team efficiency line graph (Objective I). One measure, one axis: daily
 * efficiency as faint dots, the rolling 7-day figure as the line, with
 * reference lines at 90% (below), 100% (standard) and 110% (great). In the
 * weekly/monthly views the line is the period figure instead.
 */
import {
  ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { BELOW_PCT, GREAT_PCT, pctLabel, yDomain, type ChartPoint } from "@/lib/team-efficiency-view";

const fmtTick = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

interface Props {
  points: ChartPoint[];
  /** "daily" shows dots + rolling line; otherwise one line of period figures. */
  mode: "daily" | "period";
  /** Label for a period point in the tooltip. */
  periodLabel?: (date: string) => string;
}

function TipBox({ active, payload, mode, periodLabel }: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  mode: Props["mode"];
  periodLabel?: Props["periodLabel"];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const title = mode === "period" && periodLabel
    ? periodLabel(p.date)
    : new Date(p.t).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-foreground">{title}</p>
      {mode === "daily" ? (
        <>
          <p className="text-muted-foreground">That day: <span className="font-semibold text-foreground tabular-nums">{p.daily == null ? "not counted" : pctLabel(p.daily)}</span></p>
          <p className="text-muted-foreground">Last 7 days: <span className="font-semibold text-foreground tabular-nums">{pctLabel(p.rolling)}</span></p>
        </>
      ) : (
        <p className="text-muted-foreground">Efficiency: <span className="font-semibold text-foreground tabular-nums">{pctLabel(p.rolling)}</span></p>
      )}
    </div>
  );
}

export function TeamEfficiencyChart({ points, mode, periodLabel }: Props) {
  if (points.length === 0) {
    return <div className="h-72 flex items-center justify-center text-muted-foreground">Nothing counted in this range yet.</div>;
  }
  const [lo, hi] = yDomain(points);
  const refLabel = (text: string) => ({ value: text, position: "insideTopLeft" as const, fill: "hsl(var(--muted-foreground))", fontSize: 12 });
  return (
    <div className="h-72 sm:h-80 w-full" role="img" aria-label="Team efficiency over time, with lines at 90, 100 and 110 percent">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
          <XAxis
            dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTick} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false} tickLine={false} minTickGap={24}
          />
          <YAxis
            domain={[lo, hi]} tickFormatter={v => `${v}%`} width={48}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
          />
          <ReferenceLine y={GREAT_PCT} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.7} label={refLabel("110% great")} />
          <ReferenceLine y={100} stroke="hsl(var(--foreground))" strokeOpacity={0.45} label={refLabel("100% standard")} />
          <ReferenceLine y={BELOW_PCT} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.7} label={refLabel("90% below")} />
          <Tooltip
            content={<TipBox mode={mode} periodLabel={periodLabel} />}
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
          />
          {mode === "daily" && (
            <Scatter dataKey="daily" fill="hsl(var(--primary))" fillOpacity={0.35} shape="circle" isAnimationActive={false} />
          )}
          <Line
            dataKey="rolling" type="monotone" stroke="hsl(var(--primary))" strokeWidth={2.5}
            dot={mode === "period" ? { r: 4, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "hsl(var(--primary))" } : false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            connectNulls isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
