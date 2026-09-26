import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, addWeeks, addDays } from "date-fns";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { useRefreshSpin } from "@/hooks/use-refresh-spin";
import { cn } from "@/lib/utils";

// The Dispatch Orders panel — Shopify dispatch packs per day vs calzone packs
// being made, plus the team-based "could make" forecast. ONE component shown on
// both the Kitchen Dashboard and The Business page, so a change here changes
// both (Graeme, 2026-09-26). Moved out of pages/dashboard.tsx unchanged.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getDefaultWeekOffset(): number {
  const now = new Date();
  const day = now.getDay();
  if (day === 6) return 1;
  if (day === 0) return 1;
  if (day === 5 && now.getHours() >= 15) return 1;
  return 0;
}

export function getMonday(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export async function fetchWeeklyOrders(weekStart: string) {
  const res = await fetch(`${BASE}/api/shopify/weekly-orders?weekStart=${encodeURIComponent(weekStart)}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch weekly orders");
  const data = await res.json();
  return (data.days ?? data) as { date: string; deliveryDate: string; day: string; orderCount: number; fulfilledCount: number; unfulfilledCount: number; packCount: number }[];
}

/** In-bar label for the dispatch chart: just the number, big white and
 *  bold, sitting inside the top of the column (the legend blocks say which
 *  series is which — words in the bars were unreadable). Short bars can't
 *  hold it, so the number perches above them in the page colour instead. */
function renderBarLabel(props: any) {
  const { x, y, width, height, value } = props;
  if (!value) return null;
  const cx = x + width / 2;
  // The number shrinks with its bar so neighbouring labels can't print over
  // each other on a phone; below ~14px there's no honest room for a number
  // at all — the tooltip still carries it.
  if ((width ?? 0) < 14) return null;
  const fontSize = width >= 26 ? 15 : width >= 18 ? 11 : 9;
  if ((height ?? 0) < 26) {
    return (
      <text x={cx} y={y - 5} textAnchor="middle" fontSize={Math.min(fontSize, 14)} fontWeight={800} fill="hsl(var(--foreground))">
        {value}
      </text>
    );
  }
  return (
    <text x={cx} y={y + 19} textAnchor="middle" fontSize={fontSize} fontWeight={800} fill="#fff">
      {value}
    </text>
  );
}

export function DispatchOrdersPanel({ className }: { className?: string }) {
  const dashRefresh = useRefreshSpin();
  const [weekOffset, setWeekOffset] = useState<number>(getDefaultWeekOffset);
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");
  const currentMonday = getMonday(today);
  const selectedMonday = addWeeks(currentMonday, weekOffset);
  const weekStartStr = format(selectedMonday, "yyyy-MM-dd");
  const weekSunday = new Date(selectedMonday);
  weekSunday.setDate(weekSunday.getDate() + 6);
  const weekLabel = `${format(selectedMonday, "d MMM")} – ${format(weekSunday, "d MMM yyyy")}`;
  const isCurrentWeek = weekOffset === 0;

  // Calzone packs planned per day this week — drawn beside the dispatch
  // packs so making-vs-dispatching compares in the same unit.
  const { data: weekPacksMade } = useQuery({
    queryKey: ["packs-by-date", weekStartStr],
    queryFn: async () => {
      const end = format(addDays(selectedMonday, 6), "yyyy-MM-dd");
      const res = await fetch(`${BASE}/api/production-plans/packs-by-date?start=${weekStartStr}&end=${end}`, { credentials: "include" });
      if (!res.ok) return [] as { date: string; calzonePacks: number }[];
      return res.json() as Promise<{ date: string; calzonePacks: number }[]>;
    },
    refetchInterval: 60000,
  });
  const madePacksByDate = new Map((weekPacksMade ?? []).map(r => [r.date, r.calzonePacks]));

  // Forecast capacity for weekdays that have NO production plan yet, today
  // onwards. Deliberately calls the SAME /schedule-capacity endpoint the
  // Create Plan dialog uses (Planday shifts → dough-prep rule → capacity
  // settings), so this forecast can never drift from the planner's own
  // suggestion. Packs = batches × 5 (default 10 portions per batch ÷ 2 per
  // pack — how plan batches translate to calzone packs).
  const plannedDatesKey = (weekPacksMade ?? []).map(r => `${r.date}:${r.calzonePacks}`).join(",");
  const { data: forecastByDate } = useQuery({
    queryKey: ["capacity-forecast", weekStartStr, plannedDatesKey],
    enabled: !!weekPacksMade,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const today = format(new Date(), "yyyy-MM-dd");
      const dates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(selectedMonday, i);
        const ds = format(d, "yyyy-MM-dd");
        const isWeekday = d.getDay() >= 1 && d.getDay() <= 5;
        const hasPlan = (madePacksByDate.get(ds) ?? 0) > 0;
        if (isWeekday && !hasPlan && ds >= today) dates.push(ds);
      }
      const out: Record<string, number> = {};
      await Promise.all(dates.map(async ds => {
        try {
          const res = await fetch(`${BASE}/api/production-plans/schedule-capacity?planDate=${ds}`, { credentials: "include" });
          if (!res.ok) return;
          const data = await res.json() as { available?: boolean; capacityBatches?: number };
          if (data?.available && Number.isFinite(data.capacityBatches)) {
            out[ds] = Math.round((data.capacityBatches as number) * 5);
          }
        } catch { /* Planday hiccup — that day simply shows no forecast bar */ }
      }));
      return out;
    },
  });

  const { data: weeklyOrders, isLoading: weeklyLoading, error: weeklyError, refetch } = useQuery({
    queryKey: ["shopify-weekly-orders-dashboard", weekStartStr],
    queryFn: () => fetchWeeklyOrders(weekStartStr),
    staleTime: 5 * 60 * 1000,
  });

  // Seven days plus a WEEK TOTAL column on the end, so the week's making vs
  // dispatching can be read at a glance instead of added up in your head
  // (Graeme, 2026-08-12). The total is a synthetic row: it carries isTotal so
  // the tooltip, the axis label and the bar colour can treat it as a summary
  // rather than an eighth day.
  // Days only — the week total lives in its own block BESIDE the chart, on
  // its own scale. When it was an eighth bar it dictated the Y axis and
  // squashed every daily bar to a sliver (Graeme, 2026-08-19).
  const dispatchChartData = useMemo(() => {
    if (!weeklyOrders) return undefined;
    return weeklyOrders.map(d => ({
      ...d,
      madePacks: madePacksByDate.get(d.date) ?? 0,
      forecastPacks: forecastByDate?.[d.date] ?? 0,
    }));
  }, [weeklyOrders, weekPacksMade, forecastByDate]);

  const dispatchWeekTotals = useMemo(() => {
    if (!dispatchChartData) return undefined;
    const sum = (pick: (d: NonNullable<typeof dispatchChartData>[number]) => number) =>
      dispatchChartData.reduce((s, d) => s + pick(d), 0);
    return {
      orderCount: sum(d => d.orderCount),
      fulfilledCount: sum(d => d.fulfilledCount),
      packCount: sum(d => d.packCount),
      madePacks: sum(d => d.madePacks),
      forecastPacks: sum(d => d.forecastPacks),
    };
  }, [dispatchChartData]);

  // Which bar is today — looked up in the week being SHOWN, so paging to
  // another week never highlights (or reports "today" for) the wrong day.
  const todayIndex = weeklyOrders?.findIndex(d => d.date === todayStr) ?? -1;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      // The week-total column is a summary, not a dispatch day — it has no
      // delivery date and its fulfilled/unfulfilled split isn't meaningful.
      if (item.isTotal) {
        const diff = (item.madePacks ?? 0) - (item.packCount ?? 0);
        return (
          <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
            <p className="font-semibold">Week total</p>
            <p className="font-bold pt-1">{item.packCount} packs dispatching</p>
            <p className="font-bold text-blue-500">{item.madePacks} calzone packs making</p>
            <p className={`text-xs pt-1 font-medium ${diff < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
              {diff === 0 ? "Level" : diff > 0 ? `${diff} packs ahead` : `${Math.abs(diff)} packs behind`}
            </p>
            <p className="text-xs text-muted-foreground">{item.orderCount} orders this week</p>
          </div>
        );
      }
      return (
        <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-lg text-sm space-y-1">
          <p className="font-semibold">Dispatch: {item.date}</p>
          <p className="text-muted-foreground text-xs">Delivery: {item.deliveryDate}</p>
          <p className="font-bold pt-1">{item.packCount} packs dispatching</p>
          {(item.forecastPacks ?? 0) > 0 && (
            <p className="font-bold" style={{ color: "hsl(38 92% 50%)" }}>
              {item.forecastPacks} packs possible — no plan yet (team-based forecast)
            </p>
          )}
          {(item.madePacks ?? 0) > 0 && (
            <p className="font-bold text-blue-500">{item.madePacks} calzone packs making</p>
          )}
          <p className="text-xs text-muted-foreground pt-1">{item.orderCount} orders</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            <span>{item.fulfilledCount} fulfilled</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "hsl(var(--primary) / 0.3)" }} />
            <span>{item.unfulfilledCount} unfulfilled</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn("glass-panel p-6 rounded-2xl", className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/dispatches" className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors">
              <h3 className="font-display font-bold text-lg group-hover:text-primary transition-colors">Dispatch Orders</h3>
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
            {isCurrentWeek && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">This Week</span>
            )}
            {weekOffset < 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Past</span>
            )}
            {weekOffset > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">Upcoming</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setWeekOffset(o => o - 1)}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              title="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium min-w-[170px] text-center">{weekLabel}</span>
            <button
              onClick={() => setWeekOffset(o => o + 1)}
              className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              title="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {!isCurrentWeek && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-primary hover:underline ml-1"
              >
                This week
              </button>
            )}
          </div>
          {/* Legend as big solid blocks in each series' colour — the tiny
              dot legend was unreadable at a glance (Graeme, 2026-08-20).
              Smaller and allowed to wrap on phones, full size on the
              kitchen screens. */}
          <div className="flex items-center flex-wrap gap-2 mt-2">
            <span className="px-3 py-1 sm:px-4 sm:py-1.5 rounded-lg text-sm sm:text-base font-bold text-white whitespace-nowrap" style={{ background: "hsl(var(--primary))" }}>
              Dispatching <span className="font-normal text-xs sm:text-sm opacity-80">(packs)</span>
            </span>
            <span className="px-3 py-1 sm:px-4 sm:py-1.5 rounded-lg text-sm sm:text-base font-bold text-white whitespace-nowrap" style={{ background: "hsl(217 91% 60%)" }}>
              Making <span className="font-normal text-xs sm:text-sm opacity-80">(calzone packs)</span>
            </span>
            {(dispatchWeekTotals?.forecastPacks ?? 0) > 0 && (
              <span className="px-3 py-1 sm:px-4 sm:py-1.5 rounded-lg text-sm sm:text-base font-bold text-white whitespace-nowrap" style={{ background: "hsl(38 92% 50%)" }}>
                Could make <span className="font-normal text-xs sm:text-sm opacity-80">(forecast)</span>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => { dashRefresh.triggerSpin(); refetch(); }}
          disabled={weeklyLoading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${weeklyLoading || dashRefresh.spinning ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Phones stack the week-total figures BELOW the chart — beside it
          they stole nearly half the width and the bars printed over each
          other (Graeme, 2026-08-25). */}
      <div className="w-full flex flex-col sm:flex-row sm:items-stretch">
        {weeklyLoading ? (
          <div className="flex items-center justify-center h-[300px] w-full text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Fetching Shopify orders…</span>
          </div>
        ) : weeklyError ? (
          <div className="flex items-center justify-center h-[300px] w-full text-destructive text-sm">
            Could not load order data. Check Shopify connection.
          </div>
        ) : (
          <>
          <div className="flex-1 min-w-0 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dispatchChartData}
              barGap={3}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={32}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--secondary))" }} />
              {/* Both bars are PACKS so the eye can honestly compare
                  dispatch volume against production volume. Orders and
                  fulfilment progress live in the tooltip and summary.
                  Each bar carries its own number + what it is: inside
                  and rotated when there's room, perched on top when
                  the bar is too short. */}
              {/* maxBarSize instead of a fixed barSize: on phones the
                  bars shrink to fit instead of overlapping. */}
              <Bar dataKey="packCount" name="Dispatching (packs)" maxBarSize={34} radius={[6, 6, 0, 0]}>
                {dispatchChartData?.map((entry, i) => (
                  <Cell
                    key={entry.date}
                    // Solid enough that the white in-bar number reads;
                    // today still pops at full strength.
                    fill={i === todayIndex ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.7)"}
                  />
                ))}
                <LabelList dataKey="packCount" content={renderBarLabel} />
              </Bar>
              {/* Making and forecast SHARE one column (stackId): a day
                  has a plan or it doesn't, so only one of the pair is
                  ever non-zero. Three separate series squeezed every
                  bar too thin for its number (Graeme, 2026-08-23). */}
              <Bar dataKey="madePacks" stackId="madeOrForecast" name="Making (calzone packs)" maxBarSize={34} radius={[6, 6, 0, 0]}>
                {dispatchChartData?.map(entry => (
                  <Cell
                    key={entry.date}
                    fill="hsl(217 91% 60% / 0.85)"
                  />
                ))}
                <LabelList dataKey="madePacks" content={renderBarLabel} />
              </Bar>
              {/* Forecast: what we COULD make on plan-less weekdays at
                  the Create Plan dialog's own suggested capacity. */}
              <Bar dataKey="forecastPacks" stackId="madeOrForecast" name="Could make (forecast)" maxBarSize={34} radius={[6, 6, 0, 0]}>
                {dispatchChartData?.map(entry => (
                  <Cell
                    key={entry.date}
                    fill="hsl(38 92% 50% / 0.85)"
                  />
                ))}
                <LabelList dataKey="forecastPacks" content={renderBarLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
          {/* Week total on its OWN scale, clearly fenced off from the
              daily bars — as a bar it dwarfed them into unreadability. */}
          {dispatchWeekTotals && (
            <div className="shrink-0 w-full sm:w-[150px] flex flex-wrap sm:flex-col sm:justify-center gap-x-8 gap-y-2 sm:gap-4 border-t-2 sm:border-t-0 sm:border-l-2 border-border pt-3 mt-3 sm:pt-0 sm:mt-0 sm:pl-4 sm:ml-3">
              <p className="w-full sm:w-auto text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Week total</p>
              <div>
                <p className="text-3xl font-display font-bold tabular-nums text-primary">
                  {dispatchWeekTotals.packCount.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground leading-snug">dispatching (packs)</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                  {dispatchWeekTotals.fulfilledCount} / {dispatchWeekTotals.orderCount} orders fulfilled
                </p>
              </div>
              <div>
                <p className="text-3xl font-display font-bold tabular-nums" style={{ color: "hsl(217 91% 60%)" }}>
                  {dispatchWeekTotals.madePacks.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground leading-snug">making (calzone packs)</p>
              </div>
              {dispatchWeekTotals.forecastPacks > 0 && (
                <div>
                  <p className="text-3xl font-display font-bold tabular-nums" style={{ color: "hsl(38 92% 50%)" }}>
                    {dispatchWeekTotals.forecastPacks.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">could still make (forecast, unplanned days)</p>
                </div>
              )}
            </div>
          )}
          </>
        )}
      </div>

      {weeklyOrders && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {weeklyOrders.reduce((s, d) => s + d.orderCount, 0)}
            </span>{" "}
            total orders {isCurrentWeek ? "this week" : ""}
          </span>
          <span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {weeklyOrders.reduce((s, d) => s + d.fulfilledCount, 0)}
            </span>{" "}fulfilled
          </span>
          {todayIndex >= 0 && (
            <span>
              <span className="font-semibold text-primary">
                {weeklyOrders[todayIndex].orderCount}
              </span>{" "}
              today
            </span>
          )}
          {/* Totals now live big in the Week Total block beside the
              chart; this keeps just the up-or-down verdict. */}
          {(() => {
            if (!dispatchWeekTotals) return null;
            const diff = dispatchWeekTotals.madePacks - dispatchWeekTotals.packCount;
            return (
              <span className="ml-auto">
                week:{" "}
                <span className={`font-semibold ${diff < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {diff === 0 ? "level" : diff > 0 ? `${diff} ahead` : `${Math.abs(diff)} behind`}
                </span>
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}
