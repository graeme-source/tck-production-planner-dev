/**
 * The Business → Bonus calculator (Graeme, 29 Oct 2026): Tommy's monthly
 * bonus with every number tweakable. The founder's alone — not opened by the
 * founder.sales grant Tommy has — and behind the private PIN, which the
 * server enforces too (routes/staff-bonus.ts). Maths: lib/staff-bonus.ts.
 *
 * Top: try a month (revenue sent out, profit) and see what's paid and why.
 * Middle: what each revenue level pays and the profit it needs.
 * Bottom: the scheme's own numbers, saved as you type (visible save state).
 * Objective I.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Lock, PiggyBank, RotateCcw, SlidersHorizontal, TableProperties } from "lucide-react";
import { monthLabel } from "@workspace/revenue-targets";
import { useFounderArea } from "@/hooks/use-founder-area";
import { useSensitivePinGate } from "@/hooks/use-sensitive-pin-gate";
import { FounderNav } from "@/components/founder-nav";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { DEFAULT_BONUS_SCHEME, bonusFor, bonusLadder, type BonusScheme } from "@/lib/staff-bonus";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

interface SchemeResponse {
  scheme: Partial<BonusScheme> | null;
  savedAt: string | null;
  thisMonth: string;
  months: Array<{ month: string; minimum: number; stretch: number | null }>;
}

class HttpError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

export default function FounderBonus() {
  const { ready, isFounder, home } = useFounderArea();
  useSensitivePinGate({ enabled: ready && isFounder, includeAdmins: true, entryKey: "bonus-calculator", scope: "people" });
  if (!ready) return null;
  if (!isFounder) return <Redirect to={home ?? "/"} />;
  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader title="Bonus calculator" description="Tommy's monthly bonus — try a month, see what it pays, and change the scheme. Only you can see this." />
      <BonusCalculator />
    </div>
  );
}

function BonusCalculator() {
  const q = useQuery({
    queryKey: ["staff-bonus-scheme"],
    queryFn: async (): Promise<SchemeResponse> => {
      const r = await fetch(`${BASE}/api/staff-bonus/scheme`, { credentials: "include" });
      if (!r.ok) throw new HttpError(r.status, ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      return r.json();
    },
    // 423 = waiting for the private PIN: keep trying quietly until it's in.
    retry: (n, err) => (err instanceof HttpError && err.status === 423 ? n < 150 : n < 2),
    retryDelay: 2000,
  });

  if (q.isPending || (q.isError && q.error instanceof HttpError && q.error.status === 423)) {
    return (
      <div className="rounded-2xl border-2 border-border bg-card p-8 flex items-center justify-center gap-3 text-lg text-muted-foreground">
        <Lock className="w-6 h-6" /> Enter your private PIN to open the bonus calculator.
      </div>
    );
  }
  if (q.isError) return <p className="text-destructive text-lg">{q.error.message}</p>;
  return <Loaded data={q.data} />;
}

function Loaded({ data }: { data: SchemeResponse }) {
  const [scheme, setScheme] = useState<BonusScheme>({ ...DEFAULT_BONUS_SCHEME, ...(data.scheme ?? {}) });
  const monthTargets = (m: string) => data.months.find(x => x.month === m);
  const [month, setMonth] = useState(data.thisMonth);
  const [minimum, setMinimum] = useState(String(monthTargets(data.thisMonth)?.minimum ?? 110000));
  const [stretch, setStretch] = useState(String(monthTargets(data.thisMonth)?.stretch ?? ""));
  const [revenue, setRevenue] = useState("");
  const [profit, setProfit] = useState("");

  const pickMonth = (m: string) => {
    setMonth(m);
    const t = monthTargets(m);
    if (t) { setMinimum(String(t.minimum)); setStretch(t.stretch != null ? String(t.stretch) : ""); }
  };
  const t = monthTargets(month);
  const targetsChanged = !!t && (Number(minimum) !== t.minimum || (t.stretch != null && Number(stretch) !== t.stretch));

  const min = Number(minimum) || 0;
  const str = Number(stretch) || min;
  const rev = Number(revenue);
  const pro = Number(profit);
  const haveMonth = revenue.trim() !== "" && profit.trim() !== "";
  const result = haveMonth ? bonusFor({ revenue: rev, profit: pro, minimum: min, stretch: str }, scheme) : null;
  const ladder = useMemo(() => (min > 0 ? bonusLadder(min, str, scheme) : []), [min, str, scheme]);

  // ── Autosave the scheme ──────────────────────────────────────────────
  const save = useMutation({
    mutationFn: async (s: BonusScheme) => {
      const r = await fetch(`${BASE}/api/staff-bonus/scheme`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    },
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const id = setTimeout(() => save.mutate(scheme), 700);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);
  const setNum = (k: keyof BonusScheme) => (v: string) => {
    const n = Number(v);
    if (v.trim() !== "" && Number.isFinite(n) && n >= 0) setScheme(s => ({ ...s, [k]: n }));
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* ── Try a month ── */}
      <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2"><PiggyBank className="w-6 h-6 text-primary" /> Try a month</h2>
        <div className="flex flex-wrap gap-2">
          {data.months.map(m => (
            <button key={m.month} type="button" onClick={() => pickMonth(m.month)}
              className={cn("min-h-11 px-4 rounded-full border-2 text-base font-semibold",
                month === m.month ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60")}>
              {monthLabel(m.month, { short: true })}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MoneyField label="Revenue sent out" value={revenue} onChange={setRevenue} placeholder="e.g. 125000" big />
          <MoneyField label="Net operating profit" value={profit} onChange={setProfit} placeholder="e.g. 7000" big hint="Capital spending left out; one-offs you choose to leave out." />
          <MoneyField label="Minimum target" value={minimum} onChange={setMinimum} />
          <MoneyField label="Stretch target" value={stretch} onChange={setStretch} placeholder="Not set" />
        </div>
        {targetsChanged && (
          <button type="button" onClick={() => pickMonth(month)} className="text-sm font-semibold text-primary inline-flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4" /> Back to {monthLabel(month)}'s targets
          </button>
        )}

        {result ? (
          <div className={cn("rounded-2xl border-2 p-5 space-y-3",
            result.paid > 0 ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" : "border-border bg-secondary/40")}>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bonus paid</p>
            <p className="text-5xl font-black tabular-nums">{gbp(result.paid)}</p>
            <p className="text-base">
              {result.reason === "below-minimum" && <>Revenue is under the {gbp(min)} minimum, so there's no bonus.</>}
              {result.reason === "full" && <>Revenue earns {gbp(result.revenueBonus)}, and there's {gbp(result.room)} of profit above the {scheme.profitFloorPct}% we keep, so it's paid in full.</>}
              {result.reason === "cut-by-profit" && <>Revenue earns {gbp(result.revenueBonus)}, but only {gbp(result.room)} of profit is above the {scheme.profitFloorPct}% we keep, so it's cut to that.</>}
              {result.reason === "no-profit-room" && <>Revenue earns {gbp(result.revenueBonus)}, but profit isn't above the {scheme.profitFloorPct}% we keep ({gbp(result.profitFloor)}), so nothing is paid.</>}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Revenue earns" value={gbp(result.revenueBonus)} />
              <Stat label={`${scheme.profitFloorPct}% we keep`} value={gbp(result.profitFloor)} />
              <Stat label="Room above it" value={gbp(result.room)} />
              <Stat label={`Cost with ${scheme.employerNiPct}% NI`} value={gbp(result.cost)} />
            </div>
            {rev >= min && str > min && (
              <div>
                <div className="h-3 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${Math.round(result.progress * 100)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{Math.round(result.progress * 100)}% of the way from minimum to stretch</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-base text-muted-foreground rounded-xl border-2 border-dashed border-border px-4 py-5">
            Type the month's revenue sent out and its net operating profit to see the bonus.
          </p>
        )}
      </section>

      {/* ── What it pays ── */}
      <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-3">
        <h2 className="text-xl font-bold flex items-center gap-2"><TableProperties className="w-6 h-6 text-primary" /> What it pays</h2>
        <p className="text-sm text-muted-foreground">For {gbp(min)} minimum and {gbp(str)} stretch. "Profit needed" is the profit for the bonus in full: the {scheme.profitFloorPct}% we keep plus the bonus.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr className="text-left text-sm text-muted-foreground border-b border-border">
                <th className="py-2 pr-3 font-semibold">Revenue sent out</th>
                <th className="py-2 px-3 font-semibold text-right">Bonus</th>
                <th className="py-2 pl-3 font-semibold text-right">Profit needed</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map(r => (
                <tr key={r.revenue} className={cn("border-b border-border/50", r.revenue === str && "font-bold bg-primary/5")}>
                  <td className="py-2 pr-3 tabular-nums">{gbp(r.revenue)}{r.revenue === min ? " (minimum)" : r.revenue === str ? " (stretch)" : ""}</td>
                  <td className="py-2 px-3 tabular-nums text-right">{gbp(r.bonus)}</td>
                  <td className="py-2 pl-3 tabular-nums text-right">{gbp(r.profitNeeded)}</td>
                </tr>
              ))}
              <tr><td className="py-2 pr-3 text-muted-foreground">Under {gbp(min)}</td><td className="py-2 px-3 text-right">£0</td><td /></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── The scheme ── */}
      <section className="xl:col-span-2 rounded-2xl border-2 border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold flex items-center gap-2 flex-1"><SlidersHorizontal className="w-6 h-6 text-primary" /> The scheme</h2>
          <span className="text-sm font-semibold inline-flex items-center gap-1.5" role="status">
            {save.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : save.isError ? <span className="text-destructive">Not saved — {save.error.message}</span>
              : save.isSuccess ? <><Check className="w-4 h-4 text-emerald-600" /> Saved</>
              : <span className="text-muted-foreground">Changes save as you type</span>}
          </span>
          <button type="button" onClick={() => setScheme(DEFAULT_BONUS_SCHEME)} className="min-h-11 px-4 rounded-xl border-2 border-border text-sm font-semibold hover:bg-secondary/60 inline-flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4" /> Back to the agreed scheme
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SchemeField label="Bonus at the minimum" prefix="£" value={scheme.atMinimum} onChange={setNum("atMinimum")} />
          <SchemeField label="Bonus at stretch" prefix="£" value={scheme.atStretch} onChange={setNum("atStretch")} />
          <SchemeField label="Extra above stretch" prefix="£" value={scheme.perStep} onChange={setNum("perStep")} />
          <SchemeField label="…for every" prefix="£" value={scheme.step} onChange={setNum("step")} />
          <SchemeField label="Most it ever pays" prefix="£" value={scheme.maxBonus} onChange={setNum("maxBonus")} />
          <SchemeField label="Profit we always keep" suffix="% of revenue" value={scheme.profitFloorPct} onChange={setNum("profitFloorPct")} />
          <SchemeField label="Employer NI on top" suffix="%" value={scheme.employerNiPct} onChange={setNum("employerNiPct")} />
          <div className="space-y-1">
            <span className="block text-sm font-semibold">How it climbs to stretch</span>
            <div className="flex flex-wrap gap-2">
              {[{ v: 1, l: "Straight" }, { v: 1.5, l: "Gentle" }, { v: 2, l: "Steep (agreed)" }, { v: 3, l: "Very steep" }].map(o => (
                <button key={o.v} type="button" onClick={() => setScheme(s => ({ ...s, curve: o.v }))}
                  className={cn("min-h-11 px-3 rounded-xl border-2 text-sm font-semibold",
                    scheme.curve === o.v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary/60")}>
                  {o.l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Revenue means orders sent out that month. Under the minimum there's no bonus; it climbs from the minimum bonus to the stretch bonus, then adds the extra for every step above stretch up to the most it pays. It's never paid from profit below the share we always keep.
        </p>
      </section>
    </div>
  );
}

function MoneyField({ label, value, onChange, placeholder, big, hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; big?: boolean; hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-semibold">{label}</span>
      <span className="relative block">
        <span className={cn("absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground", big ? "text-xl" : "text-base")}>£</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={e => onChange(e.target.value.replace(/[^\d.-]/g, ""))}
          placeholder={placeholder}
          className={cn("w-full rounded-xl border-2 border-border bg-background pl-8 pr-3 tabular-nums outline-none focus:border-primary",
            big ? "h-14 text-2xl font-bold" : "h-12 text-lg font-semibold")}
        />
      </span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function SchemeField({ label, value, onChange, prefix, suffix }: {
  label: string; value: number; onChange: (v: string) => void; prefix?: string; suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        {prefix && <span className="text-lg text-muted-foreground">{prefix}</span>}
        <input
          inputMode="decimal"
          value={text}
          onChange={e => { const v = e.target.value.replace(/[^\d.]/g, ""); setText(v); onChange(v); }}
          className="w-full h-12 rounded-xl border-2 border-border bg-background px-3 text-lg font-semibold tabular-nums outline-none focus:border-primary"
        />
        {suffix && <span className="text-sm text-muted-foreground whitespace-nowrap">{suffix}</span>}
      </span>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/70 border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
