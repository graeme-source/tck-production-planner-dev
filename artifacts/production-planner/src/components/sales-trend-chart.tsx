/**
 * One Numbers metric over time (Objective I) — a clean smooth line, light
 * horizontal gridlines, a crosshair tooltip. Modelled on Shopify's own
 * analytics charts, which is the look Graeme asked for.
 *
 * One measure, one axis. Ratios (AOV, ROAS) get a dashed line at the period
 * figure; today's hourly graphs can carry last week's same day as a faint
 * dashed second line (named in the legend, so it's never colour alone).
 */
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { formatAxis, formatMetric, type ChartPoint, type MetricFormat } from "@/lib/sales-trend-view";

interface Props {
  points: ChartPoint[];
  format: MetricFormat;
  /** Name of the main line in tooltip/legend, e.g. "Today". */
  seriesName: string;
  /** Name of the comparison line when there is one, e.g. "Last Thursday". */
  compareName?: string;
  /** Dashed reference at the period figure (ratios only). */
  reference?: { value: number; label: string } | null;
}

function TipBox({ active, payload, format, seriesName, compareName }: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  format: MetricFormat;
  seriesName: string;
  compareName?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm">
      <p className="font-semibold text-foreground">{p.longLabel}{p.partial ? " · still running" : ""}</p>
      <p className="text-muted-foreground">
        {compareName ? `${seriesName}: ` : ""}
        <span className="font-semibold text-foreground tabular-nums">{formatMetric(format, p.value)}</span>
      </p>
      {compareName && (
        <p className="text-muted-foreground">
          {compareName}: <span className="font-semibold text-foreground tabular-nums">{formatMetric(format, p.compare)}</span>
        </p>
      )}
    </div>
  );
}

export function SalesTrendChart({ points, format, seriesName, compareName, reference }: Props) {
  const showDots = points.length <= 31;
  return (
    <div className="h-64 sm:h-72 w-full" role="img" aria-label={`${seriesName} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
          <XAxis
            dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false} tickLine={false} minTickGap={16} interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => formatAxis(format, v)} width={56} allowDecimals={format !== "count"}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
          />
          {reference && (
            <ReferenceLine
              y={reference.value} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.8}
              label={{ value: reference.label, position: "insideTopLeft", fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
          )}
          <Tooltip
            content={<TipBox format={format} seriesName={seriesName} compareName={compareName} />}
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
          />
          {compareName && (
            <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
          )}
          {compareName && (
            <Line
              dataKey="compare" name={compareName} type="monotone" stroke="hsl(var(--muted-foreground))"
              strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.6} dot={false} activeDot={false}
              connectNulls={false} isAnimationActive={false}
            />
          )}
          <Line
            dataKey="value" name={seriesName} type="monotone" stroke="hsl(var(--primary))" strokeWidth={2.5}
            dot={showDots ? { r: 3, strokeWidth: 2, stroke: "hsl(var(--card))", fill: "hsl(var(--primary))" } : false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            connectNulls={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
