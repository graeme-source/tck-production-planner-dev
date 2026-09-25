/**
 * The graph that opens under a Numbers tile (Objective I): the metric's
 * period figure in big type — the SAME figure as the tile, taken from the
 * server's whole-period totals — then the line over time, hourly / daily /
 * weekly as suits the period, with a Daily/Weekly switch where both make
 * sense. Opens inline (no modal), closes with the X or by tapping the tile.
 */
import { useState } from "react";
import { AlertCircle, LineChart as LineChartIcon, RefreshCw, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SalesTrendChart } from "@/components/sales-trend-chart";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import {
  chartPoints, formatMetric, granularityLabel, headlineNote, TREND_METRICS, unavailableReason,
  type Granularity, type TrendMetricId,
} from "@/lib/sales-trend-view";

interface Props {
  metric: TrendMetricId;
  from: string;
  to: string;
  /** Heading override, e.g. "Sales by the hour — today". */
  title?: string;
  /** Plain words for the period, e.g. "Wed 24 Sep". */
  periodCaption: string;
  /** Name of the main line when a comparison is drawn. */
  seriesName?: string;
  /** A single day to draw faintly behind an hourly graph (same weekday last week). */
  compare?: { date: string; name: string } | null;
  /** Sibling metrics the same graph can switch to (e.g. Sales ↔ Orders). */
  alternatives?: Array<{ metric: TrendMetricId; label: string }>;
  onSwitchMetric?: (metric: TrendMetricId) => void;
  onClose: () => void;
}

export function SalesTrendPanel({ metric, from, to, title, periodCaption, seriesName, compare, alternatives, onSwitchMetric, onClose }: Props) {
  const m = TREND_METRICS[metric];
  const [granularity, setGranularity] = useState<Granularity | null>(null);
  const trend = useSalesTrend(from, to, granularity);
  const series = trend.data;
  const hourly = series?.granularity === "hour";
  const comparison = useSalesTrend(compare?.date ?? from, compare?.date ?? to, "hour", !!compare && hourly);

  const reason = series ? unavailableReason(series, metric) : null;
  const points = series ? chartPoints(series, metric, compare && hourly ? comparison.data : null) : [];
  const headline = series ? m.value(series.totals) : null;
  const reference = series && m.kind === "ratio" && headline != null && !reason
    ? { value: headline, label: `Period ${formatMetric(m.format, headline)}` }
    : null;
  const showCompare = !!compare && hourly && !!comparison.data;

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-6" role="region" aria-label={`${title ?? m.label} graph`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <LineChartIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">{title ?? m.label}</span>
          </p>
          {trend.isLoading ? (
            <Skeleton className="h-9 w-40 mt-1" />
          ) : (
            <>
              <p className={`text-3xl font-display font-bold mt-1 ${headline == null ? "text-muted-foreground" : ""}`}>
                {formatMetric(m.format, headline)}
              </p>
              {series && <p className="text-xs text-muted-foreground mt-0.5">{headlineNote(series, metric)}</p>}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-2 -m-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary"
          aria-label="Close graph"
          title="Close graph"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap mt-3 mb-2">
        <p className="text-xs text-muted-foreground">
          {series ? granularityLabel(series.granularity) : "…"} · {periodCaption}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
        {alternatives && alternatives.length > 1 && onSwitchMetric && (
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="What to graph">
            {alternatives.map((a) => (
              <button
                key={a.metric}
                type="button"
                onClick={() => onSwitchMetric(a.metric)}
                aria-pressed={a.metric === metric}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  a.metric === metric ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {series && series.allowed.length > 1 && (
          <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Graph by day or by week">
            {series.allowed.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                aria-pressed={series.granularity === g}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  series.granularity === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {granularityLabel(g)}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {trend.isLoading ? (
        <Skeleton className="h-64 sm:h-72 w-full rounded-xl" />
      ) : trend.error ? (
        <div className="h-40 flex flex-col items-center justify-center gap-3 text-destructive text-sm">
          <p className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {(trend.error as Error).message}</p>
          <button
            type="button"
            onClick={() => trend.refetch()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-secondary"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      ) : reason ? (
        <div className="h-32 flex items-center justify-center text-center text-sm text-muted-foreground px-4">{reason}</div>
      ) : (
        <SalesTrendChart
          points={points}
          format={m.format}
          seriesName={seriesName ?? m.label}
          compareName={showCompare ? compare?.name : undefined}
          reference={reference}
          perBasket={m.perBasket}
        />
      )}

      {series && series.granularity === "week" && series.buckets.some((b) => b.partial) && (
        <p className="text-xs text-muted-foreground mt-2">
          The first or last week is only partly inside this period — hover it to see how many days it covers.
        </p>
      )}
      {series && series.outsideOrders > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 flex items-start gap-1">
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{series.outsideOrders} order{series.outsideOrders === 1 ? "" : "s"} fell outside these days and aren't drawn, so the graph may be short of the tile — worth reporting as an issue.</span>
        </p>
      )}
    </div>
  );
}

/**
 * The "Trend" control built into a tile. Rendered as a plain span when the
 * whole tile is already the button (a button can't contain a button), or as
 * its own button beside other controls.
 */
export function TrendChip({ open, onClick }: { open: boolean; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
    open ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary"
  }`;
  const body = (
    <>
      <LineChartIcon className="w-3.5 h-3.5" />
      {open ? "Hide" : "Trend"}
    </>
  );
  if (!onClick) return <span className={cls} aria-hidden="true">{body}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cls}
      aria-expanded={open}
      aria-label={open ? "Hide trend graph" : "Show trend graph"}
    >
      {body}
    </button>
  );
}
