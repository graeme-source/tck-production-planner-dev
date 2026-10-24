/**
 * Business → Website A/B tests (Graeme, 2026-10-24): "a website A/B testing
 * tab which shows all of our tests ... pull them straight from Rollouts ...
 * put our own revenue per variation on top ... revenue per session ... new
 * subscription orders ... so we don't have to pay the £300 a month."
 *
 * Tests come from Shopify Rollouts (or are added by hand); the numbers come
 * from the website snippet (sessions, add-to-carts) and the orders each
 * theme sold (revenue, subscriptions) — api routes/ab-tests.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Plus, Trophy, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { FounderNav } from "@/components/founder-nav";
import { useFounderArea } from "@/hooks/use-founder-area";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api/ab-tests${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

interface Variant { label: string; themeId: number; themeName: string | null; split: number | null }
interface Test {
  id: number; rolloutId: string | null; name: string; status: string; source: "rollouts" | "manual";
  startedAt: string; endsAt: string | null; concludedAt: string | null; variants: Variant[];
}
interface VariantResult extends Variant {
  sessions: number; addToCartSessions: number; addToCartRate: number | null; orders: number; conversionRate: number | null;
  revenue: number; revenuePerSession: number | null; averageOrderValue: number | null;
  newSubscriptions: number; newSubscriptionRate: number | null; newCustomers: number;
  vsControl: null | {
    conversionLift: number | null; conversionChanceBetter: number | null;
    revenuePerSessionLift: number | null; revenuePerSessionChanceBetter: number | null;
    newSubscriptionChanceBetter: number | null;
  };
}
interface Results { test: Test; from: string; to: string; trackingSince: string | null; variants: VariantResult[]; untaggedOrders: number }

const gbp = (n: number | null, dp = 2) => (n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
const pct = (n: number | null, dp = 2) => (n == null ? "—" : `${(n * 100).toFixed(dp)}%`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const dayCount = (a: string, b: string | Date) => Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));

/** A minimum before any call is made — below this the numbers are noise. */
const MIN_SESSIONS = 500;
const MIN_ORDERS = 30;

function verdict(chance: number | null, enough: boolean): { text: string; tone: "muted" | "good" | "bad" | "lean" } {
  if (!enough || chance == null) return { text: "Too early to call", tone: "muted" };
  if (chance >= 0.95) return { text: `Beating control — ${Math.round(chance * 100)}% sure`, tone: "good" };
  if (chance <= 0.05) return { text: `Losing to control — ${Math.round((1 - chance) * 100)}% sure`, tone: "bad" };
  if (chance >= 0.8) return { text: `Leaning better (${Math.round(chance * 100)}%) — keep it running`, tone: "lean" };
  if (chance <= 0.2) return { text: `Leaning worse (${Math.round((1 - chance) * 100)}%) — keep it running`, tone: "lean" };
  return { text: `No clear difference yet (${Math.round(chance * 100)}%)`, tone: "muted" };
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-primary text-primary-foreground",
  SCHEDULED: "bg-blue-500 text-white",
  PAUSED: "bg-amber-500 text-white",
  CONCLUDED: "bg-muted text-muted-foreground",
  ARCHIVED: "bg-muted text-muted-foreground",
  DRAFT: "bg-muted text-muted-foreground",
};

export default function FounderAbTests() {
  const { ready, canSales, home } = useFounderArea();
  const tests = useQuery({
    queryKey: ["ab-tests"],
    queryFn: () => api<{ tests: Test[]; rollouts: { connected: boolean; message: string | null } }>(""),
    enabled: canSales,
    refetchInterval: 5 * 60_000,
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const list = tests.data?.tests ?? [];
  useEffect(() => {
    if (selected == null && list.length) setSelected((list.find(t => t.status === "ACTIVE") ?? list[0]).id);
  }, [list, selected]);

  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;

  return (
    <div className="space-y-6">
      <FounderNav />
      <PageHeader
        title="Website A/B tests"
        description="Every theme test, with what each side actually took — revenue, revenue per session and new subscriptions — on top of Shopify's split."
        action={
          <button onClick={() => setAdding(true)} className="h-12 px-4 rounded-2xl border-2 border-border font-bold inline-flex items-center gap-2 hover:bg-secondary">
            <Plus className="w-5 h-5" /> Add a test by hand
          </button>
        }
      />

      {tests.data && !tests.data.rollouts.connected && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-5 py-4 flex gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-base font-bold">Rollouts aren't connected yet</p>
            <p className="text-sm text-foreground/80">
              {tests.data.rollouts.message} Add the <strong>read_rollouts</strong> scope to the planner's app in Shopify
              (Settings → Apps → Develop apps → the planner app → Configuration) and your Rollouts tests appear here by
              themselves. Until then, add a test by hand — the numbers work the same.
            </p>
          </div>
        </div>
      )}

      {tests.isLoading && <div className="flex items-center gap-3 text-lg text-muted-foreground py-10 justify-center"><Loader2 className="w-6 h-6 animate-spin" /> Loading tests…</div>}
      {tests.error && <p className="text-red-600">Couldn't load the tests — {(tests.error as Error).message}</p>}

      {list.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {list.map(t => {
            const end = t.concludedAt ?? t.endsAt;
            return (
              <button key={t.id} onClick={() => setSelected(t.id)}
                className={cn("text-left rounded-2xl border-2 bg-card p-4 space-y-2 transition-colors",
                  selected === t.id ? "border-primary ring-4 ring-primary/20" : "border-border hover:border-primary/40")}>
                <div className="flex items-start gap-2">
                  <FlaskConical className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <p className="font-bold text-lg leading-snug flex-1 break-words">{t.name}</p>
                  <span className={cn("text-xs font-bold px-2 py-1 rounded-full flex-shrink-0", STATUS_STYLE[t.status] ?? "bg-muted")}>{t.status.toLowerCase()}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  From {when(t.startedAt)}{end ? ` · ${t.concludedAt ? "ended" : "ends"} ${when(end)}` : ""}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t.variants.map(v => v.themeName ?? `Theme ${v.themeId}`).join(" vs ") || "Waiting for the website to report the control theme"}
                  {t.source === "rollouts" ? " · from Rollouts" : " · added by hand"}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {!tests.isLoading && list.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border p-8 text-center space-y-2">
          <FlaskConical className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-lg font-bold">No tests yet</p>
          <p className="text-muted-foreground">Start one in Shopify Rollouts, or add one by hand.</p>
        </div>
      )}

      {selected != null && <TestResults id={selected} />}
      {adding && <AddTestDialog onClose={() => setAdding(false)} onAdded={id => { setAdding(false); setSelected(id); }} />}
    </div>
  );
}

function TestResults({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["ab-tests", id, "results"],
    queryFn: () => api<Results>(`/${id}/results`),
    refetchInterval: 5 * 60_000,
  });
  const qc = useQueryClient();
  const end = useMutation({
    mutationFn: () => api(`/${id}`, { method: "PATCH", body: JSON.stringify({ status: "CONCLUDED" }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ab-tests"] }); toast({ title: "Test ended — the results stop at now" }); },
    onError: (e: Error) => toast({ title: "Didn't save", description: e.message, variant: "destructive" }),
  });

  if (q.isLoading) return <div className="flex items-center gap-3 text-lg text-muted-foreground py-10 justify-center"><Loader2 className="w-6 h-6 animate-spin" /> Adding up sessions and orders…</div>;
  if (q.error) return <p className="text-red-600">Couldn't load the results — {(q.error as Error).message}</p>;
  const r = q.data!;
  const enough = r.variants.length >= 2 && r.variants.every(v => v.sessions >= MIN_SESSIONS) && r.variants.reduce((s, v) => s + v.orders, 0) >= MIN_ORDERS;
  const lateStart = r.trackingSince && new Date(r.trackingSince).getTime() - new Date(r.test.startedAt).getTime() > 15 * 60_000;
  const days = dayCount(r.test.startedAt, r.to);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-display font-bold flex-1 min-w-0 break-words">{r.test.name}</h2>
        <span className="text-base text-muted-foreground">{days} day{days === 1 ? "" : "s"} of data</span>
        {r.test.source === "manual" && r.test.status !== "CONCLUDED" && (
          <button onClick={() => end.mutate()} disabled={end.isPending} className="h-11 px-4 rounded-xl border-2 border-border font-semibold hover:bg-secondary">End test</button>
        )}
      </div>

      {!r.trackingSince && (
        <Notice tone="amber">The website hasn't reported any visits for this test yet. Once the A/B snippet is on every theme in the test, sessions appear within a minute.</Notice>
      )}
      {lateStart && (
        <Notice tone="amber">
          Revenue tracking started {when(r.trackingSince!)}, after the test began — orders before then can't be credited to a theme.
          {r.untaggedOrders > 0 && ` ${r.untaggedOrders} order${r.untaggedOrders === 1 ? "" : "s"} in this window had no theme stamp.`}
        </Notice>
      )}
      {!enough && r.trackingSince && (
        <Notice tone="muted">
          Too early to call. A fair read needs about {MIN_SESSIONS.toLocaleString()} sessions on each side and {MIN_ORDERS} orders between them
          — so far {r.variants.map(v => v.sessions.toLocaleString()).join(" / ")} sessions and {r.variants.reduce((s, v) => s + v.orders, 0)} orders.
        </Notice>
      )}

      <div className={cn("grid gap-4", r.variants.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {r.variants.map((v, i) => <VariantCard key={v.themeId} v={v} isControl={i === 0} enough={enough} />)}
      </div>

      <p className="text-sm text-muted-foreground max-w-prose">
        Sessions and add-to-carts are counted by the website snippet (bots excluded), so they won't match Shopify's own session count exactly — but
        both sides are counted the same way, which is what a fair test needs. Orders count when they're paid and not a subscription renewal or
        wholesale; revenue is after refunds, like Numbers.
      </p>
    </section>
  );
}

function Notice({ tone, children }: { tone: "amber" | "muted"; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border-2 px-4 py-3 text-base",
      tone === "amber" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-border bg-secondary/40 text-foreground/80")}>
      {children}
    </div>
  );
}

function VariantCard({ v, isControl, enough }: { v: VariantResult; isControl: boolean; enough: boolean }) {
  const c = v.vsControl;
  const rpsVerdict = c ? verdict(c.revenuePerSessionChanceBetter, enough) : null;
  const winner = rpsVerdict?.tone === "good";
  return (
    <div className={cn("rounded-3xl border-2 bg-card p-5 space-y-4", winner ? "border-primary" : "border-border")}>
      <div className="flex items-start gap-2">
        <span className={cn("w-3 h-3 rounded-full mt-2 flex-shrink-0", isControl ? "bg-sky-500" : "bg-violet-500")} />
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold">{v.label}{v.split != null ? ` · ${v.split}%` : ""}</p>
          <p className="text-sm text-muted-foreground break-words">{v.themeName ?? `Theme ${v.themeId}`}</p>
        </div>
        {winner && <Trophy className="w-7 h-7 text-primary flex-shrink-0" />}
      </div>

      <div className="rounded-2xl bg-primary/10 px-4 py-3">
        <p className="text-sm font-semibold text-foreground/70">Revenue per session</p>
        <p className="text-4xl font-display font-bold">{gbp(v.revenuePerSession)}</p>
        {c && <Lift value={c.revenuePerSessionLift} />}
        {rpsVerdict && <VerdictLine {...rpsVerdict} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Revenue" value={gbp(v.revenue)} />
        <Stat label="Sessions" value={v.sessions.toLocaleString()} />
        <Stat label="Conversion" value={pct(v.conversionRate)} sub={c ? <Lift value={c.conversionLift} small /> : null} />
        <Stat label="Orders" value={v.orders.toLocaleString()} />
        <Stat label="Added to cart" value={pct(v.addToCartRate, 1)} />
        <Stat label="Average order" value={gbp(v.averageOrderValue)} />
        <Stat label="New subscriptions" value={v.newSubscriptions.toLocaleString()} sub={<span className="text-xs text-muted-foreground">{pct(v.newSubscriptionRate)} of sessions</span>} />
        <Stat label="New customers" value={v.newCustomers.toLocaleString()} />
      </div>

      {c && (
        <div className="space-y-1 text-sm">
          <p><span className="font-semibold">Conversion:</span> {verdict(c.conversionChanceBetter, enough).text}</p>
          <p><span className="font-semibold">New subscriptions:</span> {verdict(c.newSubscriptionChanceBetter, enough).text}</p>
        </div>
      )}
      {isControl && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> The others are compared with this one.</p>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border px-3 py-2">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub}
    </div>
  );
}

function Lift({ value, small }: { value: number | null; small?: boolean }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <p className={cn(small ? "text-xs" : "text-sm", "font-bold", up ? "text-emerald-700 dark:text-emerald-400" : "text-red-600")}>
      {up ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}% vs control
    </p>
  );
}

function VerdictLine({ text, tone }: { text: string; tone: "muted" | "good" | "bad" | "lean" }) {
  return (
    <p className={cn("text-sm font-semibold mt-1",
      tone === "good" ? "text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "text-red-600" : tone === "lean" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
      {text}
    </p>
  );
}

function AddTestDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: number) => void }) {
  const themes = useQuery({ queryKey: ["ab-tests", "themes"], queryFn: () => api<{ themeId: number; themeName: string | null; sessions: number }[]>("/themes") });
  const [name, setName] = useState("");
  const [start, setStart] = useState(() => new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 16));
  const [picked, setPicked] = useState<number[]>([]);
  const qc = useQueryClient();
  const options = useMemo(() => themes.data ?? [], [themes.data]);
  const add = useMutation({
    mutationFn: () => api<Test>("", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        startedAt: new Date(start).toISOString(),
        variants: picked.map((id, i) => ({
          label: i === 0 ? "Control" : picked.length > 2 ? `Treatment ${i}` : "Treatment",
          themeId: id, themeName: options.find(o => o.themeId === id)?.themeName ?? null,
        })),
      }),
    }),
    onSuccess: t => { void qc.invalidateQueries({ queryKey: ["ab-tests"] }); onAdded(t.id); },
    onError: (e: Error) => toast({ title: "Didn't add the test", description: e.message, variant: "destructive" }),
  });
  const toggle = (id: number) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 4 ? p : [...p, id]));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-xl max-h-[92dvh] bg-background rounded-3xl shadow-xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a test">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h3 className="text-xl font-bold flex-1">Add a test by hand</h3>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl hover:bg-secondary inline-flex items-center justify-center"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Name</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main vs UPF free test" className="w-full h-12 px-3 rounded-xl border-2 border-border bg-card text-base" />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Started</span>
            <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="w-full h-12 px-3 rounded-xl border-2 border-border bg-card text-base" />
          </label>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Themes — tap the control first, then the others</p>
            {themes.isLoading && <p className="text-muted-foreground">Loading themes the website has reported…</p>}
            {!themes.isLoading && options.length === 0 && <p className="text-muted-foreground">No theme has reported a visit yet — the A/B snippet needs to be on the themes first.</p>}
            {options.map(o => {
              const at = picked.indexOf(o.themeId);
              return (
                <button key={o.themeId} type="button" onClick={() => toggle(o.themeId)}
                  className={cn("w-full text-left rounded-2xl border-2 px-4 py-3 flex items-center gap-3", at >= 0 ? "border-primary bg-primary/10" : "border-border hover:bg-secondary")}>
                  <span className="w-8 h-8 rounded-full border-2 inline-flex items-center justify-center font-bold flex-shrink-0">{at >= 0 ? (at === 0 ? "C" : at) : ""}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold break-words">{o.themeName ?? `Theme ${o.themeId}`}</span>
                    <span className="block text-sm text-muted-foreground">{o.sessions.toLocaleString()} sessions in the last 90 days</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end">
          <button onClick={() => add.mutate()} disabled={!name.trim() || picked.length < 2 || add.isPending}
            className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground font-bold text-lg inline-flex items-center gap-2 disabled:opacity-40">
            {add.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />} Add test
          </button>
        </div>
      </div>
    </div>
  );
}
