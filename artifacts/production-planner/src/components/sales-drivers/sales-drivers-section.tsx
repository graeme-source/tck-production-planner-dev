/**
 * What's driving sales — Sales & Marketing (Graeme, 2026-10-16). Objective I.
 *
 * Daily conversion against the delivery wait customers faced, with every
 * website/offer/email change marked on the same timeline; the findings say
 * what the history suggests as a likelihood, never a verdict. The change
 * log itself lives collapsed at the very bottom of the page (change-log.tsx,
 * Graeme 2026-10-21) — the chart still marks each change.
 */
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";
import { Activity, Download, Loader2, RefreshCw, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useSalesDrivers, useRefreshDrivers, exportUrl,
  CHANGE_CATEGORIES, type Change, type Overview,
} from "./api";

const pct = (x: number | null | undefined, dp = 1) => (x == null ? "—" : `${(x * 100).toFixed(dp)}%`);
const catLabel = (c: string) => CHANGE_CATEGORIES.find(x => x.value === c)?.label ?? c;
const CAT_COLOUR: Record<string, string> = {
  offer: "#d97706", price: "#dc2626", delivery: "#2563eb", theme: "#7c3aed", email: "#db2777",
  ads: "#059669", ab_test: "#0891b2", external: "#64748b", other: "#64748b",
};

export function SalesDriversSection({ canEdit }: { canEdit: boolean }) {
  const [days, setDays] = useState(90);
  const q = useSalesDrivers(days);
  const refresh = useRefreshDrivers();

  return (
    <section id="sales-drivers" className="rounded-2xl border border-border bg-card p-5 space-y-5 scroll-mt-24">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> What's driving sales
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm" aria-label="Days shown">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
            <option value={365}>Last year</option>
          </select>
          <a href={exportUrl()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
            title="Daily sessions, conversion, delivery wait and every change, as JSON — for AI analysis">
            <Download className="w-4 h-4" /> Export for AI
          </a>
          {canEdit && (
            <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60">
              {refresh.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {refresh.isPending ? "Refreshing…" : "Refresh now"}
            </button>
          )}
        </div>
      </div>
      {refresh.error && <p className="text-sm text-destructive">Refresh failed — {(refresh.error as Error).message}</p>}
      {refresh.data && !refresh.data.refresh.ok && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          Refreshed with gaps: {Object.entries(refresh.data.refresh.steps).filter(([, v]) => v.startsWith("failed") || v.includes("GitHub")).map(([k, v]) => `${k} — ${v}`).join("; ")}
        </p>
      )}

      {q.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">Couldn't load — {(q.error as Error).message}</p>
      ) : q.data ? (
        <>
          <LatestCheck check={q.data.latestCheck} />
          <DriversChart data={q.data} />
          <Findings data={q.data} />
        </>
      ) : null}
    </section>
  );
}

function LatestCheck({ check }: { check: Overview["latestCheck"] }) {
  if (!check) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Truck className="w-4 h-4" /> No delivery check yet — the first runs at 1pm. Earlier days are estimated from orders.
      </p>
    );
  }
  const when = check.source === "zapiet_1pm" ? "at 1pm" : `at ${format(new Date(check.checked_at), "HH:mm")}`;
  return (
    <p className="text-sm flex items-center gap-2 flex-wrap">
      <Truck className="w-4 h-4 text-primary" />
      <span>
        {format(parseISO(check.day), "EEE d MMM")} {when}: earliest delivery{" "}
        <strong>{check.earliest_date ? format(parseISO(check.earliest_date), "EEE d MMM") : "none bookable"}</strong>
        {check.lead_days != null && <> ({check.lead_days} day{check.lead_days === 1 ? "" : "s"} away)</>}
        {" — "}
        {check.next_day_available ? <span className="text-primary font-medium">next-day available</span> : <span className="text-amber-700 dark:text-amber-300 font-medium">no next-day</span>}
      </span>
    </p>
  );
}

function DriversChart({ data }: { data: Overview }) {
  const points = useMemo(() => data.series.map(r => ({
    day: r.day,
    conversion: r.conversionRate == null ? null : +(r.conversionRate * 100).toFixed(2),
    lead: r.leadDays,
    estimated: r.leadSource === "orders_estimate",
  })), [data.series]);
  // One marker per day (several changes on a day share it).
  const markers = useMemo(() => {
    const byDay = new Map<string, Change[]>();
    for (const c of data.changes) {
      const d = c.effectiveAt.slice(0, 10);
      if (d < data.from) continue;
      byDay.set(d, [...(byDay.get(d) ?? []), c]);
    }
    return [...byDay.entries()];
  }, [data.changes, data.from]);

  return (
    <div className="space-y-1">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="day" tickFormatter={d => format(parseISO(d), "d MMM")} minTickGap={24} tick={{ fontSize: 11 }} />
            <YAxis yAxisId="conv" tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} width={44} />
            <YAxis yAxisId="lead" orientation="right" allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip content={<ChartTip changes={data.changes} />} />
            <Bar yAxisId="conv" dataKey="conversion" name="Conversion" fill="hsl(var(--primary))" fillOpacity={0.55} radius={[3, 3, 0, 0]} />
            <Line yAxisId="lead" dataKey="lead" name="Days to earliest delivery" type="stepAfter" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} />
            {markers.map(([day, cs]) => (
              <ReferenceLine key={day} yAxisId="conv" x={day} stroke={CAT_COLOUR[cs[0].category] ?? "#64748b"} strokeDasharray="4 3" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">
        Bars: Shopify conversion rate. Blue line: days from that day to the earliest bookable delivery (right axis). Dashed lines: changes — hover a day to see them.
      </p>
    </div>
  );
}

function ChartTip({ active, payload, changes }: { active?: boolean; payload?: Array<{ payload: { day: string; conversion: number | null; lead: number | null; estimated: boolean } }>; changes: Change[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const todays = changes.filter(c => c.effectiveAt.slice(0, 10) === p.day);
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md max-w-xs space-y-1">
      <p className="font-semibold">{format(parseISO(p.day), "EEE d MMM yyyy")}</p>
      <p>Conversion: {p.conversion == null ? "—" : `${p.conversion}%`}</p>
      <p>Earliest delivery: {p.lead == null ? "—" : `${p.lead} day${p.lead === 1 ? "" : "s"} away${p.estimated ? " (estimated from orders)" : ""}`}</p>
      {todays.map(c => <p key={c.id} className="text-muted-foreground">• {catLabel(c.category)}: {c.title}</p>)}
    </div>
  );
}

function Findings({ data }: { data: Overview }) {
  const f = data.findings;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-5">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Delivery wait and conversion</h3>
        <ul className="space-y-2">
          {f.lead.map(l => (
            <li key={l.extraDays} className="text-sm flex gap-2">
              <span className={cn("mt-1.5 w-2 h-2 rounded-full flex-shrink-0",
                !l.comparison.enoughData ? "bg-muted-foreground/40"
                  : (l.comparison.probabilityLower ?? 0.5) >= 0.8 ? "bg-amber-500" : "bg-primary")} />
              <span>{l.sentence}</span>
            </li>
          ))}
        </ul>
        {f.weekendNote && <p className="text-sm text-muted-foreground">{f.weekendNote}</p>}
        <p className="text-xs text-muted-foreground">
          {f.daysAnalysed} days analysed · delivery wait from {f.exactLeadDays} exact 1pm checks and {f.estimatedLeadDays} days estimated from orders (the shortest wait anyone booked that morning).
          Each slow day is compared with the same weekday at its usual wait, so weekends aren't held against weekdays. Percentages are likelihoods from your own history, not proof of cause — ads, emails and offers change on the same days.
        </p>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Conversion by weekday <span className="font-normal text-muted-foreground">(usual-wait days only)</span></h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="font-medium py-1">Day</th><th className="font-medium">Conversion</th><th className="font-medium">Usual wait</th><th className="font-medium text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {f.weekday.map(w => (
              <tr key={w.weekday} className="border-t border-border/60">
                <td className="py-1">{w.weekday.slice(0, 3)}</td>
                <td>{pct(w.conversion, 2)}</td>
                <td>{w.usualLead == null ? "—" : `${w.usualLead} day${w.usualLead === 1 ? "" : "s"}`}</td>
                <td className="text-right text-muted-foreground">{w.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
