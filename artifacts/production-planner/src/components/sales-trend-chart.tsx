/**
 * One Numbers metric over time (Objective I) — a clean smooth line, light
 * horizontal gridlines, a crosshair tooltip. Modelled on Shopify's own
 * analytics charts, which is the look Graeme asked for.
 *
 * One measure, one axis. Ratios (AOV, ROAS) get a dashed line at the period
 * figure; today's hourly graphs can carry last week's same day as a faint
 * dashed second line (named in the legend, so it's never colour alone).
 *
 * Calm by construction (Graeme, 2026-09-25, "AOV looks a little bit unusual"):
 *  - Every line is monotone cubic ("monotoneX", d3's curveMonotoneX): it
 *    never bends above or below the real points, so a peak on screen is a
 *    peak in the data.
 *  - AOV hours with no paid orders stay gaps; a single missing hour is
 *    spanned by a faint straight dashed connector (bridge), and a point with
 *    no drawn neighbour still gets a solid dot so it doesn't vanish.
 *  - AOV hours resting on one or two baskets get a hollow, lighter dot and a
 *    "few orders" note in the tooltip, so one big or small basket isn't
 *    over-read.
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
  /** An average over baskets (AOV): the tooltip shows paid orders and revenue. */
  perBasket?: boolean;
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TipBox({ active, payload, format, seriesName, compareName, perBasket }: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  format: MetricFormat;
  seriesName: string;
  compareName?: string;
  perBasket?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const unpaid = p.orders - p.paidOrders;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg text-sm max-w-[16rem]">
      <p className="font-semibold text-foreground">{p.longLabel}{p.running ? " · still running" : ""}</p>
      <p className="text-muted-foreground">
        {compareName ? `${seriesName}: ` : perBasket ? "AOV: " : ""}
        <span className="font-semibold text-foreground tabular-nums">{formatMetric(format, p.value)}</span>
      </p>
      {perBasket && (
        <>
          <p className="text-muted-foreground">
            Paid orders: <span className="font-semibold text-foreground tabular-nums">{p.paidOrders}</span>
            {unpaid > 0 && <span> (+{unpaid} at £0)</span>}
          </p>
          <p className="text-muted-foreground">
            Revenue: <span className="font-semibold text-foreground tabular-nums">{GBP.format(p.revenue)}</span>
          </p>
          {p.fewOrders && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
              Few orders — one basket can swing this hour.
            </p>
          )}
          {p.value == null && p.paidOrders === 0 && !p.running && (
            <p className="text-xs text-muted-foreground mt-1">No paid orders this hour.</p>
          )}
        </>
      )}
      {compareName && (
        <p className="text-muted-foreground">
          {compareName}: <span className="font-semibold text-foreground tabular-nums">{formatMetric(format, p.compare)}</span>
        </p>
      )}
    </div>
  );
}

/** Dots: all of them on short series, and always on a point with no drawn
 *  neighbour; hollow and lighter where an average rests on 1–2 baskets. */
function makeDot(showAll: boolean) {
  return function Dot(props: { cx?: number; cy?: number; payload?: ChartPoint; index?: number }) {
    const { cx, cy, payload, index } = props;
    const key = `dot-${index ?? 0}`;
    if (cx == null || cy == null || !payload || payload.value == null) return <g key={key} />;
    if (!showAll && !payload.isolated) return <g key={key} />;
    if (payload.fewOrders) {
      return <circle key={key} cx={cx} cy={cy} r={payload.isolated ? 4.5 : 3.5} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth={2} strokeOpacity={0.5} />;
    }
    return <circle key={key} cx={cx} cy={cy} r={payload.isolated ? 4.5 : 3} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />;
  };
}

export function SalesTrendChart({ points, format, seriesName, compareName, reference, perBasket }: Props) {
  const showAllDots = points.length <= 31;
  const hasBridge = points.some((p) => p.bridge != null);
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
            content={<TipBox format={format} seriesName={seriesName} compareName={compareName} perBasket={perBasket} />}
            cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
          />
          {compareName && (
            <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
          )}
          {compareName && (
            <Line
              dataKey="compare" name={compareName} type="monotoneX" stroke="hsl(var(--muted-foreground))"
              strokeWidth={2} strokeDasharray="5 4" strokeOpacity={0.6} dot={false} activeDot={false}
              connectNulls={false} isAnimationActive={false}
            />
          )}
          {hasBridge && (
            <Line
              dataKey="bridge" name="bridge" legendType="none" type="linear" stroke="hsl(var(--primary))"
              strokeWidth={1.5} strokeDasharray="2 4" strokeOpacity={0.45} dot={false} activeDot={false}
              connectNulls={false} isAnimationActive={false}
            />
          )}
          <Line
            dataKey="value" name={seriesName} type="monotoneX" stroke="hsl(var(--primary))" strokeWidth={2.5}
            dot={makeDot(showAllDots)}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
            connectNulls={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
