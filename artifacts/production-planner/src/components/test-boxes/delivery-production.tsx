/**
 * A test-box delivery's production, queued from SALES (Graeme, 2026-10-08:
 * "as long as we automatically queue the production based on the box's
 * sales — rounding up to the nearest batch, and adding a batch if we need to
 * — prep and dough don't need scheduling"). Objectives A and C.
 *
 *   ProductionPanel  on every live delivery card: what's sold for this date
 *                    so far (open) or what's queued (closed / queued), per
 *                    recipe "50 packs = 100 calzones → 10 batches", the
 *                    "+1 safety batch per recipe" toggle (autosaves), drafts
 *                    blocking with "Put on the menu", and "Recount from
 *                    sales" with one confirm to update the queue.
 *   CloseOrdersModal the "Close orders for <date>" confirmation: a fresh
 *                    count from Shopify, then one confirm closes orders AND
 *                    queues the batches for the production day.
 *
 * The rules live on the server (api-server/src/lib/test-box-production.ts);
 * this file only shows them. API: routes/test-box-production.ts and the
 * close route in routes/test-boxes.ts.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { AlertTriangle, ChefHat, Check, Loader2, Lock, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const day = (iso: string) => format(parseISO(iso), "EEE d MMM");

export interface PreviewLine {
  recipeId: number;
  name: string;
  isDraft: boolean;
  packs: number;
  packSize: number;
  calzones: number;
  portionsPerBatch: number;
  batches: number;
  matchedBy: "mapped" | "title" | "none";
  queuedBatches: number | null;
  queuedStatus: "queued" | "planned" | null;
}
export interface ProductionPreview {
  deliveryId: number;
  deliveryDate: string;
  productionDate: string;
  status: string;
  safetyBatch: boolean;
  orders: number;
  lines: PreviewLine[];
  totalBatches: number;
  blockers: Array<{ recipeId: number; name: string }>;
  changes: boolean;
  planExists: boolean;
  warnings: string[];
  ordersSyncedAt: string | null;
  refreshError: string | null;
  queuedAt: string | null;
  queuedBy: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({})) as { error?: string; details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> } };
  if (!res.ok) {
    const field = body.details?.fieldErrors ? Object.values(body.details.fieldErrors)[0]?.[0] : undefined;
    throw new Error(body.details?.formErrors?.[0] ?? field ?? body.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const previewKey = (boxId: number, deliveryId: number, safety: boolean, refresh: boolean) =>
  ["test-boxes", boxId, "production", deliveryId, safety ? 1 : 0, refresh ? "fresh" : "mirror"];

function usePreview(boxId: number, deliveryId: number, safety: boolean, refresh: boolean, enabled = true) {
  return useQuery({
    queryKey: previewKey(boxId, deliveryId, safety, refresh),
    queryFn: () => request<{ preview: ProductionPreview }>(
      `/test-boxes/${boxId}/deliveries/${deliveryId}/production?safety=${safety ? 1 : 0}&refresh=${refresh ? 1 : 0}`,
    ).then(r => r.preview),
    enabled,
    staleTime: refresh ? Infinity : 30_000,
    refetchOnWindowFocus: !refresh,
  });
}

/** One recipe: "Properoni Carnizone: 50 packs = 100 calzones → 10 batches". */
function Line({ l, showQueued }: { l: PreviewLine; showQueued: boolean }) {
  const differs = showQueued && l.queuedBatches != null && l.queuedBatches !== l.batches;
  return (
    <li className="rounded-xl bg-secondary/40 px-3.5 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="flex-1 min-w-[12rem] text-base">
        <b>{l.name}</b>: {l.packs} pack{l.packs === 1 ? "" : "s"} = {l.calzones} calzone{l.calzones === 1 ? "" : "s"} →{" "}
        <b>{l.batches} batch{l.batches === 1 ? "" : "es"}</b>
      </span>
      {l.isDraft && <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-bold">Draft</span>}
      {showQueued && l.queuedStatus === "planned" && <span className="px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-800 dark:text-sky-300 text-xs font-bold">On the plan · {l.queuedBatches}</span>}
      {showQueued && l.queuedStatus === "queued" && !differs && <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-800 dark:text-violet-300 text-xs font-bold">Queued</span>}
      {differs && <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-bold">Queued {l.queuedBatches} — sales now say {l.batches}</span>}
    </li>
  );
}

function Blockers({ blockers, onPublished }: { blockers: ProductionPreview["blockers"]; onPublished: () => void }) {
  const publish = useMutation({
    mutationFn: (recipeId: number) => request(`/recipes/${recipeId}/publish`, { method: "POST", body: "{}" }),
    onSuccess: onPublished,
  });
  if (blockers.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-3.5 space-y-2">
      <p className="text-base font-semibold flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /> Can't queue yet — a draft can't go on a production plan</p>
      <ul className="space-y-1.5">
        {blockers.map(b => (
          <li key={b.recipeId} className="flex items-center gap-2 flex-wrap">
            <Link href="/recipes?view=drafts" className="text-base font-semibold text-primary underline underline-offset-2">{b.name}</Link>
            <span className="text-sm text-muted-foreground">is a draft</span>
            <button onClick={() => publish.mutate(b.recipeId)} disabled={publish.isPending}
              className="ml-auto px-3.5 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold disabled:opacity-60 flex items-center gap-1.5">
              {publish.isPending && publish.variables === b.recipeId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Put on the menu
            </button>
          </li>
        ))}
      </ul>
      {publish.isError && <p className="text-sm text-destructive">{(publish.error as Error).message}</p>}
    </div>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {list.map((w, i) => (
        <li key={i} className="text-sm rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" /><span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

function SafetyToggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={cn("h-11 px-4 rounded-xl border-2 text-sm font-semibold inline-flex items-center gap-2.5 disabled:opacity-60",
        on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
      <span className={cn("w-9 h-5 rounded-full relative transition-colors", on ? "bg-primary" : "bg-secondary")}>
        <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", on ? "left-[1.1rem]" : "left-0.5")} />
      </span>
      +1 safety batch per recipe
    </button>
  );
}

// ── On the delivery card ───────────────────────────────────────────────────
export function ProductionPanel({ boxId, deliveryId, status, safetyBatch, onSaved }: {
  boxId: number; deliveryId: number; status: string; safetyBatch: boolean;
  /** After a write: refresh the box (status, to-dos). */
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [safety, setSafety] = useState(safetyBatch);
  useEffect(() => setSafety(safetyBatch), [safetyBatch]);
  const [recount, setRecount] = useState(false);
  const isOpen = status === "open";
  const live = usePreview(boxId, deliveryId, safety, false);
  const fresh = usePreview(boxId, deliveryId, safety, true, recount);
  const p = (recount ? fresh.data : undefined) ?? live.data;

  const saveSafety = useMutation({
    mutationFn: (v: boolean) => request(`/test-boxes/${boxId}/deliveries/${deliveryId}`, { method: "PATCH", body: JSON.stringify({ safetyBatch: v }) }),
    onSuccess: () => { onSaved(); },
    onError: () => setSafety(safetyBatch),
  });
  const queue = useMutation({
    mutationFn: () => request<{ preview: ProductionPreview; queued: boolean }>(
      `/test-boxes/${boxId}/deliveries/${deliveryId}/production`, { method: "POST", body: JSON.stringify({ safetyBatch: safety }) }),
    onSuccess: r => {
      setRecount(false);
      qc.setQueryData(previewKey(boxId, deliveryId, safety, false), r.preview);
      void qc.invalidateQueries({ queryKey: ["test-boxes", boxId, "production", deliveryId] });
      onSaved();
    },
  });
  const refetchAll = () => { void qc.invalidateQueries({ queryKey: ["test-boxes", boxId, "production", deliveryId] }); onSaved(); };

  if (live.isLoading) return <div className="rounded-2xl bg-secondary/40 p-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Counting the sales…</div>;
  if (live.error || !p) return <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Couldn't count the sales: {(live.error as Error | null)?.message ?? "no answer"}</p>;

  const queuedState = status === "queued";
  return (
    <section className="rounded-2xl border-2 border-violet-500/30 bg-violet-500/5 p-4 space-y-3" aria-label="Production from sales">
      <div className="flex items-start gap-3 flex-wrap">
        <ChefHat className="w-6 h-6 text-violet-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-[14rem]">
          <p className="text-base font-bold">
            {isOpen ? `Sold so far — would queue ${p.totalBatches} batch${p.totalBatches === 1 ? "" : "es"} for ${day(p.productionDate)}`
              : queuedState ? `Queued for ${day(p.productionDate)} from sales`
              : `Production for ${day(p.productionDate)} — not queued yet`}
          </p>
          <p className="text-sm text-muted-foreground">
            {p.orders} order{p.orders === 1 ? "" : "s"} for {format(parseISO(p.deliveryDate), "d MMM")}
            {p.ordersSyncedAt && <> · orders as of {formatDistanceToNowStrict(parseISO(p.ordersSyncedAt))} ago</>}
            {queuedState && p.queuedAt && <> · queued by {p.queuedBy?.split(/\s+/)[0] ?? "someone"} {formatDistanceToNowStrict(parseISO(p.queuedAt))} ago</>}
          </p>
        </div>
        <SafetyToggle on={safety} disabled={saveSafety.isPending} onChange={v => { setSafety(v); saveSafety.mutate(v); }} />
      </div>

      <ul className="space-y-1.5">{p.lines.map(l => <Line key={l.recipeId} l={l} showQueued={!isOpen} />)}</ul>
      {isOpen && <p className="text-sm text-muted-foreground">Closing orders queues these automatically — rounded up to whole batches{safety ? ", plus one safety batch each" : ""}. Prep and dough follow from the plan.</p>}

      <Blockers blockers={p.blockers} onPublished={refetchAll} />
      <Warnings list={p.warnings} />
      {saveSafety.isError && <p className="text-sm text-destructive">Couldn't save the safety batch: {(saveSafety.error as Error).message}</p>}

      {!isOpen && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {!recount ? (
            <button onClick={() => setRecount(true)}
              className="px-4 py-2.5 rounded-xl border-2 border-border text-base font-semibold flex items-center gap-2 hover:bg-secondary/60">
              <RefreshCw className="w-4 h-4" /> Recount from sales
            </button>
          ) : fresh.isLoading ? (
            <span className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Fetching the newest orders…</span>
          ) : fresh.data && (fresh.data.changes || !queuedState) ? (
            <>
              <button onClick={() => queue.mutate()} disabled={queue.isPending || fresh.data.blockers.length > 0}
                className="px-5 py-2.5 rounded-xl bg-violet-600 text-white text-base font-bold flex items-center gap-2 hover:bg-violet-700 disabled:opacity-50">
                {queue.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {queuedState ? "Update the queue" : "Queue"} — {fresh.data.totalBatches} batch{fresh.data.totalBatches === 1 ? "" : "es"} for {day(fresh.data.productionDate)}
              </button>
              <button onClick={() => setRecount(false)} className="px-4 py-2.5 rounded-xl border-2 border-border text-base font-semibold">Not now</button>
            </>
          ) : (
            <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> Up to date — the queue already matches the sales.
              <button onClick={() => setRecount(false)} className="ml-2 underline text-muted-foreground font-normal">OK</button>
            </span>
          )}
          {queue.isError && <p className="w-full text-sm text-destructive">{(queue.error as Error).message}</p>}
          {fresh.isError && <p className="w-full text-sm text-destructive">{(fresh.error as Error).message}</p>}
        </div>
      )}
    </section>
  );
}

// ── "Close orders for <date>" confirmation ─────────────────────────────────
export function CloseOrdersModal({ boxId, deliveryId, deliveryLabel, safetyBatch, onClose, onConfirm, pending, error }: {
  boxId: number; deliveryId: number; deliveryLabel: string; safetyBatch: boolean;
  onClose: () => void; onConfirm: (safetyBatch: boolean) => void; pending: boolean; error: string | null;
}) {
  const qc = useQueryClient();
  const [safety, setSafety] = useState(safetyBatch);
  const preview = usePreview(boxId, deliveryId, safety, true);
  const p = preview.data;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-black/60 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-card border-2 border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Close orders for ${deliveryLabel}`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <Lock className="w-6 h-6 text-rose-600" />
          <h2 className="flex-1 font-display font-bold text-lg">Close orders for {deliveryLabel}?</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-secondary" aria-label="Close"><X className="w-6 h-6" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {preview.isLoading || !p ? (
            preview.isError
              ? <p className="text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Couldn't count the sales: {(preview.error as Error).message}</p>
              : <p className="text-base text-muted-foreground flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Fetching the newest orders and counting…</p>
          ) : (<>
            <p className="text-base">
              {p.orders} order{p.orders === 1 ? "" : "s"} for {deliveryLabel}. Closing queues this production for <b>{day(p.productionDate)}</b> —
              it lands on that day's plan when the plan is made, and prep and dough follow from it.
            </p>
            <ul className="space-y-1.5">{p.lines.map(l => <Line key={l.recipeId} l={l} showQueued={false} />)}</ul>
            <div className="flex items-center gap-3 flex-wrap">
              <SafetyToggle on={safety} onChange={setSafety} />
              <span className="text-base font-bold">Total {p.totalBatches} batch{p.totalBatches === 1 ? "" : "es"}</span>
            </div>
            <Blockers blockers={p.blockers} onPublished={() => void qc.invalidateQueries({ queryKey: ["test-boxes", boxId, "production", deliveryId] })} />
            {p.blockers.length > 0 && <p className="text-sm text-muted-foreground">You can still close orders now; the production is queued once the recipes are on the menu (“Recount from sales” on the card).</p>}
            <Warnings list={p.warnings} />
          </>)}
          {error && <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-border flex items-center gap-2 flex-wrap">
          <button onClick={() => onConfirm(safety)} disabled={pending || !p}
            className="px-5 py-3 rounded-xl bg-rose-600 text-white text-base font-bold flex items-center gap-2 hover:bg-rose-700 disabled:opacity-50">
            {pending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-5 h-5" />}
            {p && p.blockers.length === 0 && p.totalBatches > 0
              ? `Close orders & queue ${p.totalBatches} batch${p.totalBatches === 1 ? "" : "es"}`
              : "Close orders"}
          </button>
          <button onClick={onClose} className="px-4 py-3 rounded-xl border-2 border-border text-base font-semibold">Keep selling</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
