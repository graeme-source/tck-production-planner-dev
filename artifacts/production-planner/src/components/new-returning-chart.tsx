/**
 * The "New customers, % of orders" trend graph (Objective I): the % new line
 * plus the order counts behind it — new orders and returning orders — so a
 * falling % can be read for what it is (Graeme, 2026-10-14: "the graph's
 * going down when new customer order numbers are going up sometimes,
 * because returning customer orders spiked massively").
 *
 * One chart, two axes: % on the left, orders on the right. Both axes start at
 * 0 with the same number of equal steps, so one set of gridlines serves both.
 * Each line has a tappable chip that switches it on and off (the last one on
 * stays on), remembered on this device. Colour is never the only cue: the %
 * line is the thick green one, new orders solid blue, returning orders
 * dashed amber, and the chips name them.
 *
 * Every other metric's graph is SalesTrendChart, unchanged.
 */
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { TipBox, makeDot } from "@/components/sales-trend-chart";
import { formatAxis, type ChartPoint } from "@/lib/sales-trend-view";
import {
  countAxis, isLastOn, parseSplitVisibility, percentAxis, SPLIT_SERIES, SPLIT_VISIBILITY_STORAGE_KEY,
  toggleSplitSeries, type SplitSeriesId, type SplitVisibility,
} from "@/lib/new-returning-series";

/** Readable on white and on the dark card. */
const NEW_COLOUR = "#3b82f6"; // blue-500
const RETURNING_COLOUR = "#f59e0b"; // amber-500
const RETURNING_DASH = "6 4";

const STYLE: Record<SplitSeriesId, { stroke: string; dash?: string; width: number }> = {
  share: { stroke: "hsl(var(--primary))", width: 2.5 },
  new: { stroke: NEW_COLOUR, width: 2 },
  returning: { stroke: RETURNING_COLOUR, dash: RETURNING_DASH, width: 2 },
};

function readVisibility(): SplitVisibility {
  try {
    return parseSplitVisibility(window.localStorage.getItem(SPLIT_VISIBILITY_STORAGE_KEY));
  } catch {
    return parseSplitVisibility(null);
  }
}

function saveVisibility(v: SplitVisibility) {
  try {
    window.localStorage.setItem(SPLIT_VISIBILITY_STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Private window / blocked storage: the choice just isn't remembered.
  }
}

interface Props {
  points: ChartPoint[];
  seriesName: string;
  /** Dashed line at the period %. */
  reference?: { value: number; label: string } | null;
}

export function NewReturningChart({ points, seriesName, reference }: Props) {
  const [show, setShow] = useState<SplitVisibility>(readVisibility);
  const toggle = (id: SplitSeriesId) => {
    setShow(prev => {
      const next = toggleSplitSeries(prev, id);
      if (next !== prev) saveVisibility(next);
      return next;
    });
  };

  const showAllDots = points.length <= 31;
  const pct = percentAxis(points);
  const orders = countAxis(points, show);
  // Filled in the line's own colour (recharts' default white fill punches
  // holes that make a solid line look dashed).
  const countDot = (fill: string) => (showAllDots ? { r: 2.5, fill, stroke: fill, strokeWidth: 0 } : false);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="Lines to show">
        {SPLIT_SERIES.map(s => {
          const on = show[s.id];
          const locked = isLastOn(show, s.id);
          const st = STYLE[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              aria-pressed={on}
              aria-disabled={locked}
              title={locked ? "At least one line stays on" : on ? `Hide ${s.label}` : `Show ${s.label}`}
              className={`inline-flex items-center gap-2 min-h-9 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                on ? "border-border bg-card text-foreground shadow-sm" : "border-dashed border-border text-muted-foreground opacity-70 hover:opacity-100"
              } ${locked ? "cursor-default" : ""}`}
            >
              <svg width="20" height="8" aria-hidden="true" className="shrink-0">
                <line
                  x1="1" y1="4" x2="19" y2="4" stroke={on ? st.stroke : "currentColor"}
                  strokeWidth={st.width + 0.5} strokeDasharray={st.dash} strokeLinecap="round"
                />
              </svg>
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[11px] text-muted-foreground px-1" aria-hidden="true">
        <span>{show.share ? "% of paid orders" : ""}</span>
        <span>{orders ? "orders" : ""}</span>
      </div>

      <div className="h-64 sm:h-72 w-full" role="img" aria-label={`${seriesName}, with new and returning orders, over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false} tickLine={false} minTickGap={16} interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="pct" orientation="left" hide={!show.share}
              domain={[0, pct.max]} ticks={pct.ticks} allowDataOverflow
              tickFormatter={(v: number) => formatAxis("percent", v)} width={48}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
            />
            <YAxis
              yAxisId="orders" orientation="right" hide={!orders}
              domain={[0, orders?.max ?? 4]} ticks={orders?.ticks} allowDecimals={false} allowDataOverflow
              tickFormatter={(v: number) => formatAxis("count", v)} width={44}
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
            />
            {show.share && reference && (
              <ReferenceLine
                yAxisId="pct" y={reference.value} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.8}
                label={{ value: reference.label, position: "insideTopLeft", fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              />
            )}
            <Tooltip
              content={<TipBox format="percent" seriesName={seriesName} orderSplit />}
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.4 }}
            />
            {show.returning && (
              <Line
                yAxisId="orders" dataKey="returningLine" name="Returning orders" type="monotoneX"
                stroke={STYLE.returning.stroke} strokeWidth={STYLE.returning.width} strokeDasharray={STYLE.returning.dash}
                dot={countDot(STYLE.returning.stroke)} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                connectNulls={false} isAnimationActive={false}
              />
            )}
            {show.new && (
              <Line
                yAxisId="orders" dataKey="newLine" name="New orders" type="monotoneX"
                stroke={STYLE.new.stroke} strokeWidth={STYLE.new.width}
                dot={countDot(STYLE.new.stroke)} activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                connectNulls={false} isAnimationActive={false}
              />
            )}
            {show.share && (
              <Line
                yAxisId="pct" dataKey="value" name={seriesName} type="monotoneX"
                stroke={STYLE.share.stroke} strokeWidth={STYLE.share.width}
                dot={makeDot(showAllDots)}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                connectNulls={false} isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
