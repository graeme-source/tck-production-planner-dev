/**
 * Packing speed — orders an hour (Analytics → KPIs). Moved out of
 * pages/reports.tsx on 17 Nov 2026 when the KPIs got one page; the period
 * section now follows the page's date range. Same endpoint and maths as
 * before (GET /api/reports/packing-speed). Objective G.
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, Coffee, Hourglass, Loader2, Package, Snail, Timer, TrendingUp, Trophy, Zap } from "lucide-react";
import { SummaryCard } from "@/components/reports/summary-card";
import { capRange, PACKING_MAX_DAYS } from "@/lib/kpis-page";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PackingDayRow {
  date: string;
  count: number;
  firstFulfilledAt: string | null;
  lastFulfilledAt: string | null;
  windowMinutes: number | null;
  activeMinutes: number | null;
  idleMinutes: number | null;
  idleBreaks: number;
  ordersPerHour: number | null;
}

export interface PackingSpeedData {
  totalOrders: number;
  totalDays: number;
  ordersPerHour: number;
  avgPerDay: number;
  busiestDay: { date: string; count: number } | null;
  fastestDay: { date: string; ordersPerHour: number } | null;
  slowestDay: { date: string; ordersPerHour: number } | null;
  totalIdleMinutes: number;
  totalActiveMinutes: number;
  dailyRows: PackingDayRow[];
  source?: string;
}


/** One period's packing speed. Shared with the KPIs overview. */
export function usePackingSpeed(fromDate: string, toDate: string) {
  return useQuery<PackingSpeedData>({
    queryKey: ["reports", "packing-speed", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/reports/packing-speed?from=${fromDate}&to=${toDate}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as { error?: string }).error || "Failed");
      return d as PackingSpeedData;
    },
    staleTime: 60_000,
    placeholderData: prev => prev,
  });
}

export function PackingSpeedReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const today = usePackingSpeed(todayStr, todayStr);
  // Shopify is asked once per day, so a long range is cut to its last 31 days.
  const win = capRange(fromDate, toDate, PACKING_MAX_DAYS);
  const range = usePackingSpeed(win.from, win.to);
  const todayData = today.data ?? null;
  const todayLoading = today.isLoading;
  const todayError = today.error ? (today.error as Error).message : null;
  const rangeData = range.data ?? null;
  const rangeLoading = range.isFetching;
  const rangeError = range.error ? (range.error as Error).message : null;

  const fmtMins = (m: number | null) => {
    if (m == null || m === 0) return "—";
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  const todayRow = todayData?.dailyRows[0] ?? null;

  return (
    <div className="space-y-8">

      {/* ── TODAY: Fixed KPIs ──────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-base font-semibold">Today's Packing</h2>
          <span className="text-xs text-muted-foreground bg-secondary px-2.5 py-1 rounded-full font-medium">
            {format(new Date(), "EEEE d MMMM yyyy")}
          </span>
          {todayLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        {todayError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{todayError}</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Package className="w-4 h-4 text-blue-500" />}
              label="Orders Packed"
              value={todayData ? String(todayData.totalOrders) : "—"}
              sub={todayData?.totalOrders === 0 ? "None fulfilled yet today" : undefined}
            />
            <SummaryCard
              icon={<Zap className="w-4 h-4 text-amber-500" />}
              label="Packing Speed"
              value={todayData && todayData.ordersPerHour > 0 ? `${todayData.ordersPerHour}/hr` : "—"}
              sub="orders/hr · idle deducted"
            />
            <SummaryCard
              icon={<Timer className="w-4 h-4 text-emerald-500" />}
              label="Active Packing Time"
              value={todayData ? fmtMins(todayData.totalActiveMinutes) : "—"}
              sub={todayRow?.firstFulfilledAt ? `Started ${format(new Date(todayRow.firstFulfilledAt), "HH:mm")}` : undefined}
            />
            <SummaryCard
              icon={<Coffee className="w-4 h-4 text-orange-400" />}
              label="Idle / Breaks"
              value={todayData ? fmtMins(todayData.totalIdleMinutes) : "—"}
              sub={todayRow && todayRow.idleBreaks > 0 ? `${todayRow.idleBreaks} break${todayRow.idleBreaks !== 1 ? "s" : ""} detected` : "No idle gaps"}
            />
          </div>
        )}
      </section>

      {/* ── DIVIDER + DATE PICKER ──────────────────────────────────────────── */}
      <div className="border-t border-border pt-6">
        <div className="flex items-center gap-4 flex-wrap justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold">Period Analysis</h2>
            
          </div>
          <div className="flex items-center gap-2">
            {win.capped && (
              <span className="text-sm font-semibold text-muted-foreground">
                Last {PACKING_MAX_DAYS} days of the range: {format(new Date(`${win.from}T12:00:00`), "d MMM")} – {format(new Date(`${win.to}T12:00:00`), "d MMM")}
              </span>
            )}
            {rangeLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* ── RANGE KPIs ──────────────────────────────────────────────────── */}
        {rangeError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">{rangeError}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
              <SummaryCard
                icon={<Package className="w-4 h-4 text-blue-500" />}
                label="Total Orders Packed"
                value={rangeData ? String(rangeData.totalOrders) : "—"}
                sub={rangeData ? `across ${rangeData.totalDays} day${rangeData.totalDays !== 1 ? "s" : ""}` : undefined}
              />
              <SummaryCard
                icon={<Zap className="w-4 h-4 text-amber-500" />}
                label="Avg Packing Speed"
                value={rangeData && rangeData.ordersPerHour > 0 ? `${rangeData.ordersPerHour}/hr` : "—"}
                sub="orders/hr · active time only"
              />
              <SummaryCard
                icon={<Activity className="w-4 h-4 text-violet-500" />}
                label="Avg Orders / Day"
                value={rangeData && rangeData.avgPerDay > 0 ? String(rangeData.avgPerDay) : "—"}
                sub={rangeData && rangeData.totalDays > 0 ? `over ${rangeData.totalDays} packing day${rangeData.totalDays !== 1 ? "s" : ""}` : undefined}
              />
              <SummaryCard
                icon={<Trophy className="w-4 h-4 text-amber-500" />}
                label="Fastest Day"
                value={rangeData?.fastestDay ? `${rangeData.fastestDay.ordersPerHour}/hr` : "—"}
                sub={rangeData?.fastestDay ? format(new Date(rangeData.fastestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
                highlight="green"
              />
              <SummaryCard
                icon={<Snail className="w-4 h-4 text-muted-foreground" />}
                label="Slowest Day"
                value={rangeData?.slowestDay ? `${rangeData.slowestDay.ordersPerHour}/hr` : "—"}
                sub={rangeData?.slowestDay ? format(new Date(rangeData.slowestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
              />
              <SummaryCard
                icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
                label="Most Orders in a Day"
                value={rangeData?.busiestDay ? String(rangeData.busiestDay.count) : "—"}
                sub={rangeData?.busiestDay ? format(new Date(rangeData.busiestDay.date + "T00:00:00"), "EEE d MMM") : undefined}
                highlight="green"
              />
              <SummaryCard
                icon={<Timer className="w-4 h-4 text-emerald-500" />}
                label="Total Active Time"
                value={rangeData ? fmtMins(rangeData.totalActiveMinutes) : "—"}
                sub="packing time · idle deducted"
              />
              <SummaryCard
                icon={<Hourglass className="w-4 h-4 text-orange-400" />}
                label="Total Idle Time"
                value={rangeData ? fmtMins(rangeData.totalIdleMinutes) : "—"}
                sub="gaps >5 min between fulfillments"
              />
            </div>

            {/* ── Daily Breakdown Table ─────────────────────────────────── */}
            {rangeData && rangeData.totalOrders === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
                No fulfilled orders found for this date range. Orders are counted when their status is set to "fulfilled".
              </div>
            ) : rangeData ? (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/10">
                  <h3 className="text-sm font-semibold text-foreground">Daily Breakdown</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Based on Shopify fulfilled orders — start/end times are from the first and last fulfillment of the day</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/20">
                        <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Date</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Orders</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">First</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Last</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Window</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Active</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Idle</th>
                        <th className="text-center px-4 py-3 font-semibold text-muted-foreground">Rate</th>
                        <th className="px-4 py-3 w-32"><span className="sr-only">Bar</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rangeData.dailyRows.map(row => {
                        const maxCount = Math.max(...rangeData.dailyRows.map(r => r.count), 1);
                        const pct = Math.round((row.count / maxCount) * 100);
                        const isFastest = rangeData.fastestDay?.date === row.date;
                        const isBusiest = rangeData.busiestDay?.date === row.date;
                        return (
                          <tr key={row.date} className="hover:bg-secondary/10 transition-colors">
                            <td className="px-4 py-3 font-medium whitespace-nowrap">
                              {format(new Date(row.date + "T00:00:00"), "EEE dd MMM yyyy")}
                              {isFastest && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400 font-semibold">⚡ fastest</span>}
                              {isBusiest && !isFastest && <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">★ busiest</span>}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-semibold">
                              {row.count}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                              {row.firstFulfilledAt ? format(new Date(row.firstFulfilledAt), "HH:mm") : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground whitespace-nowrap">
                              {row.lastFulfilledAt ? format(new Date(row.lastFulfilledAt), "HH:mm") : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                              {fmtMins(row.windowMinutes)}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                              {fmtMins(row.activeMinutes)}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                              {row.idleMinutes && row.idleMinutes > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400" title={`${row.idleBreaks} break${row.idleBreaks !== 1 ? "s" : ""} detected`}>
                                  {fmtMins(row.idleMinutes)}
                                  <span className="text-xs ml-1 opacity-70">({row.idleBreaks})</span>
                                </span>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums font-medium">
                              {row.ordersPerHour != null ? `${row.ordersPerHour}/hr` : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <div className="w-full bg-secondary/40 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        * Data sourced from Shopify fulfilled orders. Rate is based on active packing time — gaps longer than 5 minutes between fulfillments are automatically detected and deducted as idle time. The "Idle" column shows total idle time with the number of breaks in brackets. Days with only one fulfillment show "—" for rate.
      </p>
    </div>
  );
}
