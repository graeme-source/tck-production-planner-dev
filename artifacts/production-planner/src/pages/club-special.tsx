/**
 * Calzone Club Special changeovers (Graeme, 2026-10-05). Objectives F and I.
 *
 * Pick the next special and the date it starts delivering; the app switches
 * the planner and the website on the switch day (server:
 * lib/club-special-changeover.ts) — menu badge, cart, portal banner,
 * announcement bar, Club Special price. The two Zapiet date steps can't be
 * automated, so they land as dated to-dos on the owner's list.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import { AlertTriangle, ArrowLeft, CalendarClock, Check, Circle, Loader2, Sparkles, X, Zap } from "lucide-react";
import { useFounderArea } from "@/hooks/use-founder-area";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Types (mirror api-server/src/routes/club-special.ts) ───────────────────
interface Changeover {
  id: number;
  recipeId: number;
  recipeName: string;
  deliveringFrom: string;
  switchOn: string;
  clubPricePence: number | null;
  announcement: string | null;
  status: "scheduled" | "switched" | "cancelled";
  switchedAt: string | null;
  shopifyError: string | null;
  owner: { id: number; name: string } | null;
  zapiet: Array<{ key: "end" | "start"; todoId: number | null; done: boolean | null }>;
  createdBy: string | null;
}
interface Data {
  today: string;
  offsetDays: number;
  clubPricePence: number | null;
  current: { recipeId: number; name: string; changeover: Changeover | null } | null;
  scheduled: Changeover[];
  history: Changeover[];
  recipes: Array<{ id: number; name: string; rrpPence: number | null }>;
  people: Array<{ id: number; name: string }>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/club-special${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } };
    const field = err.details?.fieldErrors ? Object.values(err.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(err.details?.formErrors?.[0] ?? field ?? err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const longDay = (iso: string) => format(parseISO(iso), "EEEE d MMMM");
const shortDay = (iso: string) => format(parseISO(iso), "EEE d MMM");
const money = (pence: number | null) => (pence == null ? "—" : `£${(pence / 100).toFixed(2)}`);

export default function ClubSpecialPage() {
  // Same door as Sales & Marketing (and Test boxes).
  const { ready, canSales, home } = useFounderArea();
  if (!ready) return null;
  if (!canSales) return <Redirect to={home ?? "/"} />;
  return <ClubSpecial />;
}

function ClubSpecial() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["club-special"],
    queryFn: () => api<Data>(""),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/founder/sales" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Sales &amp; Marketing
      </Link>
      <PageHeader
        title="Calzone Club Special"
        description="Choose the next special and the day it starts delivering. On the switch day the planner and the website change over by themselves."
      />
      {isLoading && <Skeleton className="h-40 w-full rounded-2xl" />}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {data && (
        <>
          <CurrentCard data={data} />
          {data.scheduled.map(c => <ScheduledCard key={c.id} c={c} />)}
          <ScheduleForm data={data} />
          {data.history.length > 1 && <History rows={data.history.slice(1)} />}
        </>
      )}
    </div>
  );
}

function CurrentCard({ data }: { data: Data }) {
  const cur = data.current;
  const c = cur?.changeover ?? null;
  return (
    <section className="rounded-2xl border-2 border-[#d6c38c] bg-[#231f20] text-[#fffdf0] p-5 space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-[#d6c38c]">Current Club Special</p>
      <p className="text-2xl font-bold">{cur ? cur.name : "None set"}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-[#d6c38c]">Delivering from</dt><dd>{c ? longDay(c.deliveringFrom) : "—"}</dd>
        <dt className="text-[#d6c38c]">Club Special price</dt><dd>{money(data.clubPricePence)}</dd>
        <dt className="text-[#d6c38c]">Announcement</dt><dd>{c?.announcement || "—"}</dd>
      </dl>
      {c?.shopifyError && <ShopifyProblem text={c.shopifyError} />}
    </section>
  );
}

function ShopifyProblem({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 p-3 text-sm">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span><strong>The website hasn't fully updated yet.</strong> {text} It retries every 5 minutes.</span>
    </p>
  );
}

function ScheduledCard({ c }: { c: Changeover }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | "cancel" | "switch">(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["club-special"] });
  const cancel = useMutation({ mutationFn: () => api(`/${c.id}/cancel`, { method: "POST" }), onSuccess: refresh });
  const switchNow = useMutation({ mutationFn: () => api(`/${c.id}/switch-now`, { method: "POST" }), onSuccess: refresh });
  const busy = cancel.isPending || switchNow.isPending;
  const err = (cancel.error ?? switchNow.error) as Error | null;
  const lastOld = format(subDays(parseISO(c.deliveringFrom), 1), "yyyy-MM-dd");
  const steps: Array<{ label: string; due: string; done: boolean | null }> = [
    { label: `Zapiet: Club Special last delivery date ${shortDay(lastOld)}`, due: "now", done: c.zapiet.find(z => z.key === "end")?.done ?? null },
    { label: `Zapiet: open Club Special dates from ${shortDay(c.deliveringFrom)}`, due: shortDay(c.switchOn), done: c.zapiet.find(z => z.key === "start")?.done ?? null },
  ];
  return (
    <section className="rounded-2xl border-2 border-primary/40 bg-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5"><CalendarClock className="w-4 h-4" /> Next special — scheduled</p>
          <p className="text-xl font-bold">{c.recipeName}</p>
        </div>
        {c.owner && <span className="text-xs text-muted-foreground">Owner: {c.owner.name}</span>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Delivering from</dt><dd className="font-semibold">{longDay(c.deliveringFrom)}</dd>
        <dt className="text-muted-foreground">Website switches on</dt><dd className="font-semibold">{longDay(c.switchOn)}</dd>
        <dt className="text-muted-foreground">New Club Special price</dt><dd>{c.clubPricePence != null ? money(c.clubPricePence) : "No change"}</dd>
        <dt className="text-muted-foreground">Announcement</dt><dd>{c.announcement || "None"}</dd>
      </dl>
      <div className="space-y-1">
        <p className="text-sm font-semibold">Your two manual steps (on {c.owner?.name.split(" ")[0] ?? "the owner"}'s to-do list)</p>
        {steps.map(s => (
          <p key={s.label} className={cn("flex items-center gap-2 text-sm", s.done && "text-muted-foreground line-through")}>
            {s.done ? <Check className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-muted-foreground" />}
            {s.label} <span className="text-xs text-muted-foreground no-underline">· due {s.due}</span>
          </p>
        ))}
      </div>
      {c.shopifyError && <ShopifyProblem text={c.shopifyError} />}
      {err && <p className="text-sm text-destructive">{err.message}</p>}
      {confirm ? (
        <div className="rounded-xl bg-muted p-3 space-y-2">
          <p className="text-sm font-semibold">
            {confirm === "cancel"
              ? `Cancel the changeover to ${c.recipeName}? Its two Zapiet to-dos are removed too.`
              : `Switch to ${c.recipeName} now? The menu, cart, portal, announcement${c.clubPricePence != null ? " and Club Special price" : ""} change on the live website within a minute.`}
          </p>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => (confirm === "cancel" ? cancel.mutate() : switchNow.mutate())}
              className={cn("px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50",
                confirm === "cancel" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground")}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {confirm === "cancel" ? "Yes, cancel it" : "Yes, switch now"}
            </button>
            <button disabled={busy} onClick={() => setConfirm(null)} className="px-4 py-2 rounded-xl border-2 border-border text-sm font-semibold">Keep it</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setConfirm("switch")} className="px-4 py-2 rounded-xl border-2 border-primary/50 text-sm font-semibold flex items-center gap-1.5 hover:bg-primary/10">
            <Zap className="w-4 h-4" /> Switch now instead
          </button>
          <button onClick={() => setConfirm("cancel")} className="px-4 py-2 rounded-xl border-2 border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-muted">
            <X className="w-4 h-4" /> Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function ScheduleForm({ data }: { data: Data }) {
  const qc = useQueryClient();
  const { state } = useAuth();
  const meId = state.status === "authenticated" ? state.user.id : null;
  const [recipeId, setRecipeId] = useState<number | "">("");
  const [deliveringFrom, setDeliveringFrom] = useState("");
  const [switchOn, setSwitchOn] = useState("");
  const [switchTouched, setSwitchTouched] = useState(false);
  const [price, setPrice] = useState(data.clubPricePence != null ? (data.clubPricePence / 100).toFixed(2) : "");
  const [announcement, setAnnouncement] = useState("");
  const [announcementTouched, setAnnouncementTouched] = useState(false);
  const [ownerId, setOwnerId] = useState<number | "">(meId ?? "");
  const recipe = data.recipes.find(r => r.id === recipeId);

  // Switch day follows the delivery date (minus the billing offset) until edited.
  useEffect(() => {
    if (switchTouched || !DATE_RE.test(deliveringFrom)) return;
    const s = format(subDays(parseISO(deliveringFrom), data.offsetDays), "yyyy-MM-dd");
    setSwitchOn(s < data.today ? data.today : s);
  }, [deliveringFrom, switchTouched, data.offsetDays, data.today]);
  // Announcement follows the recipe until edited.
  useEffect(() => {
    if (!announcementTouched && recipe) setAnnouncement(`NEW CLUB SPECIAL: ${recipe.name}`);
  }, [recipe, announcementTouched]);

  const pricePence = price.trim() === "" ? null : Math.round(Number(price) * 100);
  const priceChanged = pricePence != null && pricePence !== data.clubPricePence;
  const valid = recipe && DATE_RE.test(deliveringFrom) && deliveringFrom > data.today
    && DATE_RE.test(switchOn) && switchOn >= data.today && switchOn <= deliveringFrom
    && (pricePence == null || (Number.isFinite(pricePence) && pricePence >= 100));

  const create = useMutation({
    mutationFn: () => api("", {
      method: "POST",
      body: JSON.stringify({
        recipeId, deliveringFrom, switchOn,
        clubPricePence: priceChanged ? pricePence : null,
        announcement: announcement.trim() || null,
        ownerId: ownerId === "" ? null : ownerId,
      }),
    }),
    onSuccess: () => {
      setRecipeId(""); setDeliveringFrom(""); setSwitchOn(""); setSwitchTouched(false); setAnnouncementTouched(false); setAnnouncement("");
      void qc.invalidateQueries({ queryKey: ["club-special"] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
    },
  });

  const ownerName = useMemo(() => data.people.find(p => p.id === ownerId)?.name ?? "your", [data.people, ownerId]);

  return (
    <section className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Schedule the next special</h2>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Recipe</span>
        <select value={recipeId} onChange={e => setRecipeId(e.target.value ? Number(e.target.value) : "")}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base">
          <option value="">Choose a recipe…</option>
          {data.recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">Only recipes on the menu and linked to their Shopify product are listed.</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Delivering from <span className="font-normal text-muted-foreground">— the first subscription delivery with this recipe</span></span>
        <input type="date" value={deliveringFrom} min={data.today} onChange={e => setDeliveringFrom(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Website switches on <span className="font-normal text-muted-foreground">— {data.offsetDays} days before, when those renewals are billed</span></span>
        <input type="date" value={switchOn} min={data.today} max={deliveringFrom || undefined}
          onChange={e => { setSwitchOn(e.target.value); setSwitchTouched(true); }}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
      </label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Club Special price (£)</span>
          <input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
          <span className="text-xs text-muted-foreground">
            Now {money(data.clubPricePence)}{recipe?.rrpPence ? ` · ${recipe.name} one-time ${money(recipe.rrpPence)}` : ""}
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">Zapiet to-dos go to</span>
          <select value={ownerId} onChange={e => setOwnerId(e.target.value ? Number(e.target.value) : "")}
            className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base">
            {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">Announcement bar <span className="font-normal text-muted-foreground">— leave empty for none</span></span>
        <input value={announcement} maxLength={140} onChange={e => { setAnnouncement(e.target.value); setAnnouncementTouched(true); }}
          className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background text-base" />
      </label>

      {valid && recipe && (
        <div className="rounded-xl bg-muted p-4 text-sm space-y-1">
          <p><strong>Now:</strong> two Zapiet to-dos are added to {ownerName === "your" ? "your" : `${ownerName.split(" ")[0]}'s`} list.</p>
          <p><strong>{longDay(switchOn)}:</strong> the planner and website switch to {recipe.name} — menu badge, cart, portal (“Delivering from {longDay(deliveringFrom)}”), announcement bar{priceChanged ? `, and the Club Special price to ${money(pricePence)}` : ""}.</p>
          <p><strong>{longDay(deliveringFrom)}:</strong> first deliveries of {recipe.name} as the Club Special.</p>
        </div>
      )}
      {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
      <button onClick={() => create.mutate()} disabled={!valid || create.isPending}
        className="w-full px-5 py-3 rounded-xl bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {create.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <CalendarClock className="w-5 h-5" />} Schedule changeover
      </button>
    </section>
  );
}

function History({ rows }: { rows: Changeover[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Earlier specials</h2>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {rows.map(r => (
          <li key={r.id} className="px-4 py-2.5 flex justify-between text-sm">
            <span className="font-semibold">{r.recipeName}</span>
            <span className="text-muted-foreground">from {shortDay(r.deliveringFrom)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
