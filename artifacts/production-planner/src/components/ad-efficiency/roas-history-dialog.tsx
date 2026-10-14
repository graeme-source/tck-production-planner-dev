/**
 * 90-day history for the 7-day new-customer ROAS card (Graeme, 2026-10-14:
 * "a button on this card that can show us what's happened daily and on
 * average, with the two columns, over the last 90 days… we keep ebbing and
 * flowing above and below our target. I want to be able to see how
 * consistently we're doing that"). Objective I.
 *
 * Same maths as the card: "That day" is one day's new-customer sales ÷ that
 * day's spend; "7-day avg" is the rolling 7-day figure as it stood that day,
 * coloured against the target with the card's shade scale.
 */
import { useEffect, useMemo } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSalesTrend } from "@/hooks/use-sales-trend";
import { roasShade, rollingSeries, summariseRoasHistory, type AdDay } from "@/lib/ad-efficiency";
import { addDays } from "@/lib/roas";

export const HISTORY_DAYS = 90;

const gbp = (n: number | null) => (n == null ? "—" : `£${Math.round(n).toLocaleString("en-GB")}`);
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

export function RoasHistoryDialog({ lastDay, target, onClose }: { lastDay: string; target: number; onClose: () => void }) {
  // 90 days of the rolling figure needs the 6 days before the first one too.
  const from = addDays(lastDay, -(HISTORY_DAYS + 6 - 1));
  const trend = useSalesTrend(from, lastDay, "day");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const view = useMemo(() => {
    if (!trend.data) return null;
    const days: AdDay[] = trend.data.buckets.map(b => ({
      date: b.key, revenue: b.revenue, newCustomerRevenue: b.newCustomerRevenue, spend: b.adSpend,
    }));
    const byDate = new Map(days.map(d => [d.date, d]));
    const daily = rollingSeries(days, "newCustomer", 1, lastDay, HISTORY_DAYS);
    const avg7 = rollingSeries(days, "newCustomer", 7, lastDay, HISTORY_DAYS);
    const rows = avg7.map((p, i) => ({
      date: p.date,
      day: daily[i]?.percent ?? null,
      avg7: p.percent,
      spend: byDate.get(p.date)?.spend ?? null,
      ncRevenue: byDate.get(p.date)?.newCustomerRevenue ?? null,
    }));
    return { rows: rows.slice().reverse(), summary: summariseRoasHistory(avg7, daily, target) };
  }, [trend.data, lastDay, target]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label="7-day new customer ROAS — last 90 days">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-4xl max-h-[92dvh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-display font-bold">7-day new customer ROAS — last 90 days</h2>
            <p className="text-sm text-muted-foreground">Target {Math.round(target)}% · newest first</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl bg-secondary hover:bg-secondary/70 flex items-center justify-center">
            <X className="w-6 h-6" />
          </button>
        </div>

        {!view ? (
          <div className="flex items-center gap-2 text-muted-foreground p-6">
            {trend.error ? `Couldn't load the history — ${(trend.error as Error).message}` : <><Loader2 className="w-5 h-5 animate-spin" /> Loading 90 days…</>}
          </div>
        ) : (
          <>
            {/* How consistently we're on target. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4 border-b border-border">
              <Stat label="7-day avg on or above target" value={`${view.summary.avgOnTarget} of ${view.summary.avgDays} days`} sub={view.summary.avgDays ? `${Math.round((view.summary.avgOnTarget / view.summary.avgDays) * 100)}%` : ""} />
              <Stat label="Single days on or above target" value={`${view.summary.dayOnTarget} of ${view.summary.dayDays} days`} sub={view.summary.dayDays ? `${Math.round((view.summary.dayOnTarget / view.summary.dayDays) * 100)}%` : ""} />
              <Stat label="Longest run on target (7-day avg)" value={`${view.summary.longestRun} days`} />
              <Stat label="Right now (7-day avg)" value={view.summary.currentRun > 0 ? `${view.summary.currentRun} days on target` : `${view.summary.currentBelow} days below`} />
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left px-5 py-2">Day</th>
                    <th className="text-right px-3 py-2 hidden sm:table-cell">Ad spend</th>
                    <th className="text-right px-3 py-2 hidden sm:table-cell">New cust. sales</th>
                    <th className="text-right px-3 py-2">That day</th>
                    <th className="text-right px-5 py-2">7-day avg</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map(r => {
                    const shade = roasShade(r.avg7, target);
                    const d = new Date(`${r.date}T12:00:00Z`);
                    const monday = d.getUTCDay() === 1;
                    return (
                      <tr key={r.date} className={cn("border-b border-border/50", monday && "border-b-2 border-border")}>
                        <td className="px-5 py-1.5 text-muted-foreground whitespace-nowrap">
                          {d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" })}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums hidden sm:table-cell">{gbp(r.spend)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums hidden sm:table-cell">{gbp(r.ncRevenue)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.day)}</td>
                        <td className="px-5 py-1.5 text-right">
                          <span
                            className={cn("inline-block min-w-[4rem] text-right rounded px-1.5 font-bold tabular-nums", !shade && "bg-secondary text-muted-foreground", shade && (shade.darkBackground ? "text-white" : "text-stone-900"))}
                            style={shade ? { backgroundColor: shade.hex } : undefined}
                          >{pct(r.avg7)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-secondary/50 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
