/**
 * Month-end adjustments on Finance → Payroll (Graeme, 27 Oct 2026). Two
 * figures for the month end inside the pay period, for the accountant:
 *   · deferred income — orders paid by 23:59 on the month end but not yet
 *     dispatched (counted as sales when paid, made and sent next month);
 *   · labour from the 25th to the month end — paid in this pay period but
 *     belonging to the month before.
 * Plus the history from 31 Mar 2025, grouped by financial year (April →
 * March), with each month's opening, closing and movement. API:
 * /api/payroll/month-end (rules in api-server lib/payroll/month-end.ts).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Download, History, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Bucket { orders: number; incVat: number }
interface Deferred {
  monthEnd: string; label: string; orders: number; incVat: number; exVat: number; vat: number; lineCount: number;
  bySource: Record<"not_yet" | "shopify" | "app" | "apc" | "estimate", Bucket>;
  unknown: Bucket; laterCancelled: Bucket; staleUnsent: Bucket; nothingToSend: Bucket;
  trust: { exactPct: number | null; trustworthy: boolean; summary: string };
  warnings: string[];
}
interface Labour {
  monthEnd: string; from: string; to: string; people: number; hours: number; pay: number;
  workedHours: number; workedPay: number; holidayHours: number; holidayPay: number; holidayByHand: number;
  employer: { ni: number; pension: number; total: number; note: string } | null;
  provisional: boolean; warnings: string[];
}
interface MonthEnd {
  monthEnd: string; label: string; final: boolean; computedAt: string; fromStore: boolean;
  deferred: Deferred | null; deferredError: string | null; labour: Labour | null; labourError: string | null;
}
interface Section {
  current: MonthEnd; previous: MonthEnd | null;
  movement: { deferredIncVat: number | null; deferredExVat: number | null; labourPay: number | null; employer: number | null };
}
interface Mv { opening: number | null; closing: number | null; movement: number | null }
interface HistoryRow {
  monthEnd: string; label: string; financialYear: string; isOpening: boolean;
  deferredIncVat: Mv; deferredExVat: Mv; deferredOrders: number | null; labourPay: Mv; labourHours: number | null; labourEmployer: Mv;
  trustworthy: boolean | null; notes: string[]; error: string | null;
}
interface Year { year: string; span: string; complete: boolean; rows: HistoryRow[]; deferredIncVat: Mv; labourPay: Mv }
interface HistoryRes { first: string; last: string; rows: HistoryRow[]; years: Year[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/payroll/month-end${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

const gbp = (n: number | null | undefined) => n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number | null | undefined) => n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${gbp(Math.abs(n))}`;
const hrs = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("en-GB")} h`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const nextMonthName = (monthEnd: string) => new Date(Date.parse(`${monthEnd}T12:00:00Z`) + 86_400_000).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

export function PayrollMonthEnd({ from, to }: { from: string; to: string }) {
  const qc = useQueryClient();
  const key = ["payroll-month-end", from, to];
  const q = useQuery({ queryKey: key, queryFn: () => api<Section>(`?from=${from}&to=${to}`) });
  const recalc = useMutation({
    mutationFn: (monthEnd: string) => api<Section>("/recalculate", { method: "POST", body: JSON.stringify({ monthEnd }) }),
    onSuccess: res => { qc.setQueryData(key, res); void qc.invalidateQueries({ queryKey: ["payroll-month-end-history"] }); toast({ title: "Worked out again", description: `${res.current.label} · saved` }); },
    onError: (e: Error) => toast({ title: "Didn't recalculate", description: e.message, variant: "destructive" }),
  });

  const s = q.data;
  const c = s?.current;
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold flex items-center gap-2"><CalendarClock className="w-5 h-5" />Month-end adjustments{c ? ` for ${c.label}` : ""}</h3>
        {c && (
          <button type="button" disabled={recalc.isPending} onClick={() => recalc.mutate(c.monthEnd)}
            className="ml-auto h-10 px-3 rounded-xl border-2 border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-secondary disabled:opacity-50">
            {recalc.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recalculate
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground max-w-prose">
        For the accountant, every month: sales Shopify counted before the food went out, and wages paid next period for this month's last days.
        Both go in the PDF and email automatically.
      </p>
      {q.isLoading && <p className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="w-5 h-5 animate-spin" /> Working out the month end…</p>}
      {q.error && <p className="text-red-600">{(q.error as Error).message}</p>}
      {s && c && (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Deferred income */}
          <div className="rounded-2xl border-2 border-border p-4 space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">Deferred income at {day(c.monthEnd)}</p>
            {c.deferred ? (
              <>
                <p className="text-3xl font-display font-bold tabular-nums">{gbp(c.deferred.incVat)}</p>
                <p className="text-sm text-muted-foreground">
                  {c.deferred.orders} order{c.deferred.orders === 1 ? "" : "s"}
                  {Math.abs(c.deferred.vat) >= 0.005 ? ` · ${gbp(c.deferred.exVat)} ex VAT` : " · no VAT in it"}
                </p>
                <div className="rounded-xl bg-secondary/50 px-3 py-2 text-sm tabular-nums space-y-0.5">
                  <p className="flex justify-between gap-3"><span>Opening ({s.previous ? day(s.previous.monthEnd) : "—"})</span><span>{gbp(s.previous?.deferred?.incVat)}</span></p>
                  <p className="flex justify-between gap-3 font-semibold"><span>Movement — take off {c.label}'s sales</span><span>{signed(s.movement.deferredIncVat)}</span></p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Orders paid by 23:59 on {day(c.monthEnd)} (London time) but not dispatched by then. Cancelled or fully refunded by then are left out,
                  as are gift cards and memberships. Released into {nextMonthName(c.monthEnd)}'s sales.
                </p>
                <Trust ok={c.deferred.trust.trustworthy} text={c.deferred.trust.summary} />
                {c.deferred.laterCancelled.orders > 0 && (
                  <p className="text-xs text-muted-foreground">Includes {c.deferred.laterCancelled.orders} order{c.deferred.laterCancelled.orders === 1 ? "" : "s"} ({gbp(c.deferred.laterCancelled.incVat)}) cancelled or refunded after the month end.</p>
                )}
                <Warnings items={c.deferred.warnings.filter(w => !w.startsWith("Not enough real dispatch"))} />
                <a href={`${BASE}/api/payroll/month-end/lines.csv?monthEnd=${c.monthEnd}`}
                  className="h-11 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary text-sm">
                  <Download className="w-4 h-4" /> The {c.deferred.lineCount} orders (CSV)
                </a>
              </>
            ) : <p className="text-red-600 text-sm">Couldn't work it out: {c.deferredError}</p>}
          </div>

          {/* Labour */}
          <div className="rounded-2xl border-2 border-border p-4 space-y-2">
            <p className="text-sm font-semibold text-muted-foreground">Labour {c.labour ? `${day(c.labour.from)} – ${day(c.labour.to)}` : ""}, paid in this period</p>
            {c.labour ? (
              <>
                <p className="text-3xl font-display font-bold tabular-nums">{gbp(c.labour.pay)}</p>
                <p className="text-sm text-muted-foreground">
                  {hrs(c.labour.hours)} · {c.labour.people} {c.labour.people === 1 ? "person" : "people"}
                  {c.labour.holidayHours > 0 ? ` · incl. ${gbp(c.labour.holidayPay)} holiday` : ""}
                </p>
                <div className="rounded-xl bg-secondary/50 px-3 py-2 text-sm tabular-nums space-y-0.5">
                  <p className="flex justify-between gap-3"><span>Opening ({s.previous?.labour ? `${day(s.previous.labour.from)} – ${day(s.previous.labour.to)}` : "—"})</span><span>{gbp(s.previous?.labour?.pay)}</span></p>
                  <p className="flex justify-between gap-3 font-semibold"><span>Movement — add to {c.label}'s wages</span><span>{signed(s.movement.labourPay)}</span></p>
                </div>
                {c.labour.employer && (
                  <div className="rounded-xl border-2 border-dashed border-amber-400 px-3 py-2 text-sm">
                    <p className="flex justify-between gap-3 font-semibold tabular-nums"><span>Employer NI + pension — estimate</span><span>{gbp(c.labour.employer.total)}</span></p>
                    <p className="text-xs text-muted-foreground">{c.labour.employer.note}</p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Same pay rules as the report: approved shifts, unpaid breaks off, holiday hours at the person's rate.</p>
                <Warnings items={c.labour.warnings} />
              </>
            ) : <p className="text-red-600 text-sm">Couldn't work it out: {c.labourError}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function Trust({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={cn("text-xs flex items-start gap-1.5", ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300 font-semibold")}>
      {ok ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      <span>{ok ? text : `Check this one — ${text}`}</span>
    </p>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs space-y-1">
      {items.map((w, i) => <p key={i}>{w}</p>)}
    </div>
  );
}

/** Every month end since 31 Mar 2025. Loaded on request: the first time on
 *  live it reads a year and a half of Shopify and Planday (then it's kept). */
export function PayrollMonthEndHistory() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["payroll-month-end-history"], queryFn: () => api<HistoryRes>("/history"), enabled: open, staleTime: 5 * 60_000 });
  const h = q.data;
  const opening = h?.rows.find(r => r.isOpening);
  return (
    <section className="rounded-3xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-bold flex items-center gap-2"><History className="w-5 h-5" />Month-end history — since 31 Mar 2025</h3>
        <div className="ml-auto flex flex-wrap gap-2">
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-semibold">Show the history</button>
          )}
          <a href={`${BASE}/api/payroll/month-end/history.csv`} className="h-11 px-4 rounded-xl border-2 border-border font-semibold inline-flex items-center gap-2 hover:bg-secondary">
            <Download className="w-4 h-4" /> CSV
          </a>
        </div>
      </div>
      <p className="text-sm text-muted-foreground max-w-prose">
        Each month: opening (the month end before), closing and the movement. The deferred-income movement comes off that month's sales; the
        labour movement goes on its wages. Grouped by financial year (April to March). The first time, this reads a year and a half of
        orders and shifts — give it a minute or two.
      </p>
      {q.isFetching && !h && <p className="flex items-center gap-2 text-muted-foreground py-4"><Loader2 className="w-5 h-5 animate-spin" /> Working out every month end…</p>}
      {q.error && <p className="text-red-600">{(q.error as Error).message}</p>}
      {h && (
        <div className="space-y-4">
          {opening && (
            <div className="rounded-2xl border-2 border-primary/50 bg-primary/5 p-3">
              <p className="font-bold break-words">{opening.label}</p>
              <p className="text-sm tabular-nums">Deferred income {gbp(opening.deferredIncVat.closing)} · labour {gbp(opening.labourPay.closing)}</p>
              {opening.error && <p className="text-sm text-red-600">{opening.error}</p>}
            </div>
          )}
          {h.years.map(y => (
            <div key={y.year} className="space-y-2">
              <div className="rounded-2xl bg-secondary/60 px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-lg font-bold">{y.year} <span className="text-sm font-normal text-muted-foreground">{y.span}{y.complete ? "" : " · so far"}</span></p>
                <p className="text-sm tabular-nums">Deferred income {gbp(y.deferredIncVat.opening)} → {gbp(y.deferredIncVat.closing)} <b>{signed(y.deferredIncVat.movement)}</b></p>
                <p className="text-sm tabular-nums">Labour {gbp(y.labourPay.opening)} → {gbp(y.labourPay.closing)} <b>{signed(y.labourPay.movement)}</b></p>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {y.rows.map(r => <MonthCard key={r.monthEnd} r={r} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MonthCard({ r }: { r: HistoryRow }) {
  const yearEnd = r.monthEnd.endsWith("-03-31");
  return (
    <div className={cn("rounded-2xl border-2 p-3 space-y-2", yearEnd || r.monthEnd === "2025-11-30" ? "border-primary/60" : "border-border")}>
      <p className="font-bold break-words">{r.label}</p>
      <div className="grid grid-cols-2 gap-2 text-sm tabular-nums">
        <div>
          <p className="text-xs text-muted-foreground">Deferred at {day(r.monthEnd)}</p>
          <p className="font-bold text-lg">{gbp(r.deferredIncVat.closing)}</p>
          <p className="text-xs text-muted-foreground">from {gbp(r.deferredIncVat.opening)}</p>
          <p className="font-semibold">{signed(r.deferredIncVat.movement)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Labour 25th – month end</p>
          <p className="font-bold text-lg">{gbp(r.labourPay.closing)}</p>
          <p className="text-xs text-muted-foreground">from {gbp(r.labourPay.opening)}</p>
          <p className="font-semibold">{signed(r.labourPay.movement)}</p>
        </div>
      </div>
      {r.trustworthy === false && <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />Dispatch dates thin — check</p>}
      {r.error && <p className="text-xs text-red-600">{r.error}</p>}
      {r.notes.length > 0 && <p className="text-xs text-muted-foreground">{r.notes.join(" ")}</p>}
    </div>
  );
}
