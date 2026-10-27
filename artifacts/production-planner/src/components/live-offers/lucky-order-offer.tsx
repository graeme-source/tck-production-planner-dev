/**
 * Lucky Order Number (Graeme, 27 Oct 2026) — Sales & Marketing → Live offers.
 * Order numbers ending 0 win a free gift, 00 a free gift + full refund, 000 a
 * free subscription year. Switch, schedule, gift and refund limit autosave;
 * winners and refund approvals below. Server: api-server routes/live-offers.ts
 * and lib/lucky-order. Objective I.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Gift, Loader2, Mail, RefreshCw, Search, AlertTriangle, PartyPopper } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["live-offers"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/live-offers${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type Tier = "gift" | "gift_refund" | "subscription";
const TIER_LABEL: Record<Tier, string> = { gift: "Free gift", gift_refund: "Gift + full refund", subscription: "Free subscription year" };

interface Offer {
  enabled: boolean;
  practiceMode: boolean;
  startsAt: string | null;
  endsAt: string | null;
  activatedAt: string | null;
  liveNow: boolean;
  settings: { giftVariantId?: string | null; giftTitle?: string | null; refundAutoLimit: number; subscriptionAmount: number; subscriptionCycles: number };
  updatedBy: string | null;
  updatedAt: string;
}

interface Winner {
  orderId: string; orderName: string; tier: Tier; practice: boolean; sourceName: string | null;
  customerEmail: string | null; customerName: string | null; orderTotal: number | null; orderCreatedAt: string;
  giftStatus: string; giftTitle: string | null; refundStatus: string; refundAmount: number | null; refundDecidedBy: string | null;
  codeStatus: string; discountCode: string | null; emailStatus: string; attempts: number; lastError: string | null;
}

interface Data {
  offer: Offer | null;
  writesBlocked: boolean;
  klaviyoConnected: boolean;
  klaviyoMetric: string;
  founderEmail: string;
  winners: Winner[];
}

type Patch = Partial<{ enabled: boolean; practiceMode: boolean; startsAt: string | null; endsAt: string | null; giftVariantId: string | null; giftTitle: string | null; refundAutoLimit: number }>;

/** ISO -> value for <input type="datetime-local"> in the viewer's time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const gbp = (n: number | null) => (n == null ? "—" : `£${n.toFixed(2)}`);

function statusOf(o: Offer): { label: string; tone: string } {
  if (!o.enabled) return { label: "Off", tone: "bg-muted text-muted-foreground" };
  if (o.endsAt && Date.parse(o.endsAt) <= Date.now()) return { label: "Ended", tone: "bg-muted text-muted-foreground" };
  if (!o.liveNow) return { label: "Scheduled", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" };
  if (o.practiceMode) return { label: "Running — practice mode", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label: "Live", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" };
}

const STEP_LABEL: Record<string, string> = {
  "n/a": "—", practice: "would do", pending: "to do", awaiting_approval: "needs your approval",
  approved: "approved — processing", done: "done", declined: "declined", failed: "failed",
};
function Step({ status, children }: { status: string; children?: React.ReactNode }) {
  const tone = status === "done" ? "text-green-700 dark:text-green-400"
    : status === "awaiting_approval" ? "text-amber-700 dark:text-amber-300 font-semibold"
    : status === "practice" ? "text-muted-foreground italic"
    : status === "declined" || status === "failed" ? "text-red-700 dark:text-red-400" : "";
  return <span className={cn("text-sm", tone)}>{children ?? STEP_LABEL[status] ?? status}</span>;
}

export function LuckyOrderOffer({ isFounder }: { isFounder: boolean }) {
  const qc = useQueryClient();
  const q = useQuery<Data>({ queryKey: KEY, queryFn: () => api("/"), refetchInterval: 60_000 });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Patch) => api<{ offer: Offer }>("/lucky-order", { method: "PATCH", body: JSON.stringify(patch) }),
    onMutate: () => { setSaveState("saving"); setSaveError(null); },
    onSuccess: () => { setSaveState("saved"); qc.invalidateQueries({ queryKey: KEY }); },
    onError: (e: Error) => { setSaveState("error"); setSaveError(e.message); },
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api<{ ok: boolean; sentTo?: string }>(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">Loading…</div>;
  if (q.error || !q.data?.offer) return <div className="rounded-2xl border border-border bg-card p-5 text-sm text-red-700">{(q.error as Error)?.message ?? "The offer isn't set up yet."}</div>;
  const { offer, winners } = q.data;
  const st = statusOf(offer);
  const awaiting = winners.filter(w => w.refundStatus === "awaiting_approval");
  const stuck = winners.filter(w => w.lastError && w.attempts >= 5);
  const real = winners.filter(w => !w.practice);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2"><PartyPopper className="w-5 h-5 text-primary" /> Lucky Order Number</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              Website orders and subscription renewals whose order number ends in <strong>0</strong> get a free gift added;
              <strong> 00</strong> also get a full refund; <strong>000</strong> instead win a free subscription year
              (up to £{offer.settings.subscriptionAmount} off each of {offer.settings.subscriptionCycles} subscription orders). Wholesale never.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("px-3 py-1 rounded-full text-sm font-semibold", st.tone)}>{st.label}</span>
            <span className="text-xs text-muted-foreground min-w-[4.5rem]" aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3" />Saved</span> : saveState === "error" ? <span className="text-red-700">Not saved</span> : null}
            </span>
          </div>
        </div>
        {saveError && <p className="text-sm text-red-700">{saveError}</p>}
        {q.data.writesBlocked && <p className="text-sm text-amber-700">Shopify writes are off on this server — it can only practise here.</p>}
        {!isFounder && <p className="text-sm text-muted-foreground">Only Graeme can change this offer or approve refunds.</p>}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 min-h-11">
            <span className="text-sm font-medium">Offer on</span>
            <Switch checked={offer.enabled} disabled={!isFounder || save.isPending} onCheckedChange={v => save.mutate({ enabled: v })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 min-h-11">
            <span className="text-sm font-medium">Practice mode <span className="block text-xs text-muted-foreground font-normal">Logs winners; touches no orders, sends no emails</span></span>
            <Switch checked={offer.practiceMode} disabled={!isFounder || save.isPending} onCheckedChange={v => save.mutate({ practiceMode: v })} />
          </label>
          <label className="rounded-xl border border-border p-3 space-y-1">
            <span className="text-sm font-medium">Starts</span>
            <input type="datetime-local" className="w-full bg-transparent text-sm min-h-9" disabled={!isFounder}
              defaultValue={toLocalInput(offer.startsAt)} key={`s-${offer.updatedAt}`}
              onBlur={e => { const v = fromLocalInput(e.target.value); if (v !== offer.startsAt) save.mutate({ startsAt: v }); }} />
            <span className="block text-xs text-muted-foreground">Blank = from when it's switched on</span>
          </label>
          <label className="rounded-xl border border-border p-3 space-y-1">
            <span className="text-sm font-medium">Ends</span>
            <input type="datetime-local" className="w-full bg-transparent text-sm min-h-9" disabled={!isFounder}
              defaultValue={toLocalInput(offer.endsAt)} key={`e-${offer.updatedAt}`}
              onBlur={e => { const v = fromLocalInput(e.target.value); if (v !== offer.endsAt) save.mutate({ endsAt: v }); }} />
            <span className="block text-xs text-muted-foreground">Blank = until switched off</span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <GiftPicker
            current={offer.settings.giftTitle ?? null}
            disabled={!isFounder}
            onPick={(variantId, title) => save.mutate({ giftVariantId: variantId, giftTitle: title })}
          />
          <label className="rounded-xl border border-border p-3 space-y-1">
            <span className="text-sm font-medium">Refunds over this need your approval</span>
            <div className="flex items-center gap-1 text-sm">£
              <input type="number" min={0} max={1000} step={1} className="w-24 bg-transparent min-h-9" disabled={!isFounder}
                defaultValue={offer.settings.refundAutoLimit} key={`l-${offer.updatedAt}`}
                onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== offer.settings.refundAutoLimit) save.mutate({ refundAutoLimit: v }); }} />
            </div>
          </label>
        </div>

        <KlaviyoBox data={q.data} isFounder={isFounder} />

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Checks for winners every minute{offer.activatedAt ? ` · switched on ${when(offer.activatedAt)}` : ""} · last changed by {offer.updatedBy ?? "—"} {when(offer.updatedAt)}</span>
          {isFounder && (
            <button type="button" onClick={() => action.mutate({ path: "/lucky-order/run", body: {} })} disabled={action.isPending}
              className="inline-flex items-center gap-1.5 px-3 min-h-9 rounded-lg border border-border text-sm hover:bg-muted">
              {action.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check now
            </button>
          )}
        </div>
        {action.error && <p className="text-sm text-red-700">{(action.error as Error).message}</p>}
      </section>

      {(awaiting.length > 0 || stuck.length > 0) && (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" /> Waiting for you</h3>
          {awaiting.map(w => (
            <div key={w.orderId} className="flex flex-wrap items-center gap-3 text-sm">
              <span><strong>{w.orderName}</strong> · {w.customerName ?? w.customerEmail} · full refund of <strong>{gbp(w.refundAmount)}</strong></span>
              {isFounder && (
                <span className="flex gap-2">
                  <button type="button" className="px-3 min-h-9 rounded-lg bg-primary text-primary-foreground font-medium" disabled={action.isPending}
                    onClick={() => action.mutate({ path: "/lucky-order/refund-decision", body: { orderId: w.orderId, approve: true } })}>Approve refund</button>
                  <button type="button" className="px-3 min-h-9 rounded-lg border border-border" disabled={action.isPending}
                    onClick={() => { if (window.confirm(`Decline the refund for ${w.orderName}? The gift still goes.`)) action.mutate({ path: "/lucky-order/refund-decision", body: { orderId: w.orderId, approve: false } }); }}>Decline</button>
                </span>
              )}
            </div>
          ))}
          {stuck.map(w => (
            <div key={w.orderId} className="flex flex-wrap items-center gap-3 text-sm">
              <span><strong>{w.orderName}</strong> got stuck: {w.lastError}</span>
              {isFounder && (
                <button type="button" className="px-3 min-h-9 rounded-lg border border-border" onClick={() => action.mutate({ path: "/lucky-order/retry", body: { orderId: w.orderId } })}>Try again</button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Winners</h3>
          <span className="text-xs text-muted-foreground">
            {real.filter(w => w.tier !== "subscription").length} gifts · {real.filter(w => w.tier === "gift_refund").length} refunds · {real.filter(w => w.tier === "subscription").length} subscription years
            {winners.length !== real.length ? ` · ${winners.length - real.length} practice` : ""}
          </span>
        </div>
        {winners.length === 0 ? (
          <p className="text-sm text-muted-foreground">No winners yet. They appear here within a minute of the order.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">Order</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Prize</th>
                  <th className="py-2 pr-3 font-medium">Gift</th>
                  <th className="py-2 pr-3 font-medium">Refund</th>
                  <th className="py-2 pr-3 font-medium">Subscription code</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                </tr>
              </thead>
              <tbody>
                {winners.map(w => (
                  <tr key={w.orderId} className="border-t border-border/60 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="font-medium">{w.orderName}</span>
                      {w.practice && <span className="ml-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">practice</span>}
                      <span className="block text-xs text-muted-foreground">{when(w.orderCreatedAt)} · {w.sourceName?.startsWith("subscription") ? "renewal" : "website"} · {gbp(w.orderTotal)}</span>
                    </td>
                    <td className="py-2 pr-3">{w.customerName ?? "—"}<span className="block text-xs text-muted-foreground">{w.customerEmail}</span></td>
                    <td className="py-2 pr-3 whitespace-nowrap">{TIER_LABEL[w.tier]}</td>
                    <td className="py-2 pr-3"><Step status={w.giftStatus} /></td>
                    <td className="py-2 pr-3">
                      <Step status={w.refundStatus}>{w.refundStatus === "done" ? `${gbp(w.refundAmount)} refunded` : undefined}</Step>
                      {w.refundDecidedBy && <span className="block text-xs text-muted-foreground">by {w.refundDecidedBy}</span>}
                    </td>
                    <td className="py-2 pr-3"><Step status={w.codeStatus}>{w.codeStatus === "done" ? <code className="text-xs">{w.discountCode}</code> : undefined}</Step></td>
                    <td className="py-2 pr-3">
                      <Step status={w.emailStatus}>{w.emailStatus === "done" ? "sent" : undefined}</Step>
                      {w.lastError && <span className="block text-xs text-red-700">{w.lastError}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function GiftPicker({ current, disabled, onPick }: { current: string | null; disabled: boolean; onPick: (variantId: string, title: string) => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(t); }, [search]);
  const opts = useQuery<{ options: Array<{ variantId: string; title: string }> }>({
    queryKey: ["live-offers", "gift-options", debounced],
    queryFn: () => api(`/gift-options?q=${encodeURIComponent(debounced)}`),
    enabled: !disabled && debounced.length >= 2,
  });
  const list = useMemo(() => opts.data?.options ?? [], [opts.data]);
  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-2"><Gift className="w-4 h-4 text-primary" /> Free gift</div>
      <p className="text-sm">{current ? <strong>{current}</strong> : <span className="text-amber-700">None chosen — needed before going live</span>}</p>
      {!disabled && (
        <>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input className="w-full bg-transparent text-sm min-h-9" placeholder="Search products to change it, e.g. cinnamon" value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          {debounced.length >= 2 && (
            <ul className="max-h-48 overflow-y-auto divide-y divide-border/60 text-sm">
              {opts.isLoading && <li className="py-2 text-muted-foreground">Searching…</li>}
              {!opts.isLoading && list.length === 0 && <li className="py-2 text-muted-foreground">Nothing found.</li>}
              {list.map(o => (
                <li key={o.variantId}>
                  <button type="button" className="w-full text-left py-2 hover:bg-muted rounded px-1" onClick={() => { onPick(o.variantId, o.title); setSearch(""); }}>{o.title}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function KlaviyoBox({ data, isFounder }: { data: Data; isFounder: boolean }) {
  const qc = useQueryClient();
  const send = useMutation({
    mutationFn: (tier: Tier) => api<{ sentTo: string }>("/lucky-order/test-email", { method: "POST", body: JSON.stringify({ tier }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-2"><Mail className="w-4 h-4 text-primary" /> Winner emails (Klaviyo)</div>
      <p className="text-sm text-muted-foreground max-w-prose">
        Each winner sends a <strong>“{data.klaviyoMetric}”</strong> event to Klaviyo, with <code>tier</code> (gift / gift_refund / subscription),
        the gift, refund amount and subscription code. Build one Klaviyo flow on that event and split it by <code>tier</code> for the three emails.
        {!data.klaviyoConnected && <span className="block text-red-700 mt-1">Klaviyo isn't connected — connect it in the email cadence card on the Overview tab.</span>}
      </p>
      {isFounder && data.klaviyoConnected && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Send a test event to {data.founderEmail}:</span>
          {(["gift", "gift_refund", "subscription"] as Tier[]).map(t => (
            <button key={t} type="button" disabled={send.isPending} onClick={() => send.mutate(t)}
              className="px-3 min-h-9 rounded-lg border border-border hover:bg-muted">{TIER_LABEL[t]}</button>
          ))}
          {send.isSuccess && <span className="text-green-700">Sent — the event is in Klaviyo.</span>}
          {send.error && <span className="text-red-700">{(send.error as Error).message}</span>}
        </div>
      )}
    </div>
  );
}
