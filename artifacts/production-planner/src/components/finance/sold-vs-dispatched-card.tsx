/**
 * Orders sold vs dispatched — the founder P&L page's month-balancing card
 * (Objective I, finance & reporting). Shopify books an order when it's
 * placed; we earn it when it goes out. This shows both, month by month,
 * so the P&L can be balanced. Counting rules: api-server
 * lib/pnl-sold-vs-dispatched.ts.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Row {
  key: string;
  label: string;
  partial: boolean;
  sold: number;
  dispatched: number;
  difference: number;
  soldValue: number;
  dispatchedValue: number;
  valueDifference: number;
  noDeliveryDate: number;
  apcScanned: number | null;
}

interface Report {
  rows: Row[];
  totals: Omit<Row, "key" | "label" | "partial">;
  valueBasis: string;
  apcFrom: string;
  today: string;
}

/** The mirror is complete from 23 Sep 2025; dispatch needs 6 weeks before. */
const EARLIEST_MONTH = "2025-11";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

function monthOptions(today: string): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  let [y, m] = EARLIEST_MONTH.split("-").map(Number) as [number, number];
  const last = today.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) {
    const v = `${y}-${String(m).padStart(2, "0")}`;
    if (v > last) break;
    out.push({ value: v, label: `${MONTH_NAMES[m - 1]} ${y}` });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Last 3 complete months plus this month (same rule as the server). */
function defaultRange(today: string): { fromMonth: string; toMonth: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const back = new Date(Date.UTC(y, m - 1 - 3, 1)).toISOString().slice(0, 7);
  return { fromMonth: back < EARLIEST_MONTH ? EARLIEST_MONTH : back, toMonth: today.slice(0, 7) };
}

const count = (n: number) => n.toLocaleString("en-GB");
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const signed = (n: number, fmt: (x: number) => string) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : fmt(0));
const diffClass = (n: number) => (n > 0 ? "text-emerald-700 dark:text-emerald-400" : n < 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground");

async function fetchReport(params: URLSearchParams): Promise<Report> {
  const res = await fetch(`${BASE}/api/pnl-sold-vs-dispatched?${params}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Couldn't load (${res.status})`);
  }
  return res.json();
}

export function SoldVsDispatchedCard() {
  const today = useMemo(londonToday, []);
  const months = useMemo(() => monthOptions(today), [today]);
  const [mode, setMode] = useState<"months" | "dates">("months");
  const [range, setRange] = useState(() => defaultRange(today));
  const [dates, setDates] = useState(() => ({ from: `${today.slice(0, 7)}-01`, to: today }));

  const datesValid = dates.from !== "" && dates.to !== "" && dates.from <= dates.to;
  const params = new URLSearchParams(
    mode === "months" ? { fromMonth: range.fromMonth, toMonth: range.toMonth } : { from: dates.from, to: dates.to },
  );
  const { data, isLoading, error } = useQuery({
    queryKey: ["pnl-sold-vs-dispatched", params.toString()],
    queryFn: () => fetchReport(params),
    enabled: mode === "months" || datesValid,
    staleTime: 60_000,
  });

  const selectClass = "min-h-[48px] rounded-xl border border-border bg-background px-3 text-base";

  return (
    <section className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Truck className="w-5 h-5 text-muted-foreground" />
            Orders sold vs dispatched
          </h2>
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["months", "dates"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`min-h-[40px] px-4 rounded-lg text-sm font-medium ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {m === "months" ? "Whole months" : "Custom dates"}
              </button>
            ))}
          </div>
        </div>

        {mode === "months" ? (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              From
              <select
                className={selectClass}
                value={range.fromMonth}
                onChange={e => setRange(r => ({ fromMonth: e.target.value, toMonth: e.target.value > r.toMonth ? e.target.value : r.toMonth }))}
              >
                {months.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              To
              <select
                className={selectClass}
                value={range.toMonth}
                onChange={e => setRange(r => ({ toMonth: e.target.value, fromMonth: e.target.value < r.fromMonth ? e.target.value : r.fromMonth }))}
              >
                {months.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              From
              <input type="date" className={selectClass} min={`${EARLIEST_MONTH}-01`} max={today} value={dates.from}
                onChange={e => setDates(d => ({ ...d, from: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              To
              <input type="date" className={selectClass} min={`${EARLIEST_MONTH}-01`} value={dates.to}
                onChange={e => setDates(d => ({ ...d, to: e.target.value }))} />
            </label>
            {!datesValid && <span className="text-sm text-destructive">The start date must be on or before the end date.</span>}
          </div>
        )}
      </div>

      {error ? (
        <p className="px-5 pb-5 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error instanceof Error ? error.message : "Couldn't load"}
        </p>
      ) : isLoading || !data ? (
        <div className="px-5 pb-5 space-y-2">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-base tabular-nums">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-semibold px-5 py-3">{mode === "months" ? "Month" : "Period"}</th>
                  <th className="text-right font-semibold px-3 py-3">Sold</th>
                  <th className="text-right font-semibold px-3 py-3">Dispatched</th>
                  <th className="text-right font-semibold px-3 py-3">Difference</th>
                  <th className="text-right font-semibold px-3 py-3">Sold £</th>
                  <th className="text-right font-semibold px-3 py-3">Dispatched £</th>
                  <th className="text-right font-semibold px-3 py-3">£ difference</th>
                  <th className="text-right font-semibold px-5 py-3">On APC</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="px-5 py-3">
                      <div className="font-semibold whitespace-nowrap">{r.label}{r.partial && <span className="ml-2 text-xs font-normal text-muted-foreground">so far</span>}</div>
                      {r.noDeliveryDate > 0 && (
                        <div className="text-xs text-muted-foreground">{count(r.noDeliveryDate)} sold with no delivery date</div>
                      )}
                    </td>
                    <td className="text-right px-3 py-3">{count(r.sold)}</td>
                    <td className="text-right px-3 py-3">{count(r.dispatched)}</td>
                    <td className={`text-right px-3 py-3 font-semibold ${diffClass(r.difference)}`}>{signed(r.difference, count)}</td>
                    <td className="text-right px-3 py-3">{gbp(r.soldValue)}</td>
                    <td className="text-right px-3 py-3">{gbp(r.dispatchedValue)}</td>
                    <td className={`text-right px-3 py-3 font-semibold ${diffClass(r.valueDifference)}`}>{signed(r.valueDifference, gbp)}</td>
                    <td className="text-right px-5 py-3 text-muted-foreground">{r.apcScanned == null ? "—" : count(r.apcScanned)}</td>
                  </tr>
                ))}
                {data.rows.length > 1 && (
                  <tr className="border-t-2 border-border bg-secondary/40 font-bold">
                    <td className="px-5 py-3">
                      Total
                      {data.totals.noDeliveryDate > 0 && (
                        <div className="text-xs font-normal text-muted-foreground">{count(data.totals.noDeliveryDate)} sold with no delivery date</div>
                      )}
                    </td>
                    <td className="text-right px-3 py-3">{count(data.totals.sold)}</td>
                    <td className="text-right px-3 py-3">{count(data.totals.dispatched)}</td>
                    <td className={`text-right px-3 py-3 ${diffClass(data.totals.difference)}`}>{signed(data.totals.difference, count)}</td>
                    <td className="text-right px-3 py-3">{gbp(data.totals.soldValue)}</td>
                    <td className="text-right px-3 py-3">{gbp(data.totals.dispatchedValue)}</td>
                    <td className={`text-right px-3 py-3 ${diffClass(data.totals.valueDifference)}`}>{signed(data.totals.valueDifference, gbp)}</td>
                    <td className="text-right px-5 py-3 text-muted-foreground">{data.totals.apcScanned == null ? "—" : count(data.totals.apcScanned)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-4 border-t border-border space-y-1 text-sm text-muted-foreground">
            <p><span className="font-semibold text-foreground">Plus</span> = sold this month, delivered next month · <span className="font-semibold text-foreground">minus</span> = last month's orders delivered this month.</p>
            <p>£ is the order total, {data.valueBasis}. Cancelled orders are left out. On APC = orders scanned onto APC (from 30 Jul 2026).</p>
            <p>Shopify orders only — wholesale and 8-pack orders on Dispatch Orders aren't Shopify orders, so they're not in here.</p>
          </div>
        </>
      )}
    </section>
  );
}
