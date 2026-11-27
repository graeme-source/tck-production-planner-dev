/**
 * "Not in Shopify" — a quiet tool on the Order Packing Live menu bar (Graeme,
 * 27 Nov 2026 — #140447). Lists orders we tried to fulfil that Shopify still
 * shows open (GET /api/fulfilment/fulfil-attempts/stuck), each with a
 * "Fulfil with tracking" that sends the live APC booking through the normal
 * Complete (so every gate still applies, and the customer gets the usual
 * dispatch email). Nothing is sent without a second tap. Objective C.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PackageX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { attemptWords, useNow, type AttemptRow } from "./fulfil-attempt-flag";
import { labelEnding, shouldHaveGoneWords, whenWords } from "@/lib/fulfil-flag-words";
import { forgetOrder } from "@/lib/fulfil-queue";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["fulfil-attempts-stuck"] as const;

interface StuckOrder {
  orderId: number;
  orderName: string;
  customerName: string | null;
  shopifyUnreadable: boolean;
  attempts: number;
  firstAttempt: { at: string; by: string | null } | null;
  ordersSince: number | null;
  lastAttempt: { at: string; by: string | null; outcome: AttemptRow["outcome"]; error: string | null } | null;
  booking: { waybill: string; trackingUrl: string | null } | null;
  noCourier: boolean;
}

function useStuck() {
  return useQuery<{ orders: StuckOrder[]; adminBase: string }>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/fulfilment/fulfil-attempts/stuck`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 3 * 60_000,
  });
}

export function NotInShopifyButton({ canFulfil }: { canFulfil: boolean }) {
  const [open, setOpen] = useState(false);
  const { data } = useStuck();
  const n = data?.orders.length ?? 0;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2.5 rounded-xl text-base font-bold border-2 border-border bg-card text-foreground hover:border-primary/50 transition-colors flex items-center gap-2"
        title="Orders we tried to fulfil that Shopify still shows open"
      >
        <PackageX className="w-5 h-5" /> Not in Shopify
        {n > 0 && <span className="text-sm px-2 py-0.5 rounded-full tabular-nums bg-red-600 text-white">{n}</span>}
      </button>
      {open && <NotInShopifyModal canFulfil={canFulfil} onClose={() => setOpen(false)} />}
    </>
  );
}

function Row({ o, adminBase, canFulfil }: { o: StuckOrder; adminBase: string; canFulfil: boolean }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // The physical check: nothing is fulfilled until someone has the box.
  const [found, setFound] = useState(false);
  const now = useNow();
  const ending = labelEnding(o.booking?.waybill);
  const fulfil = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/fulfilment/orders/${o.orderId}/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(o.booking ? { consignmentNumber: o.booking.waybill, trackingUrl: o.booking.trackingUrl ?? undefined } : {}),
          clientAttemptId: `manual-${o.orderId}-${Date.now()}`,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
      return body;
    },
    onSuccess: () => {
      forgetOrder(o.orderId);
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ["fulfil-attempts", o.orderId] });
    },
  });
  // Managers only here — the team uses the checklist on the order itself.
  const canSend = canFulfil && (o.noCourier || !!o.booking);
  return (
    <li className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <a href={`${adminBase}${o.orderId}`} target="_blank" rel="noreferrer" className="font-bold text-base underline underline-offset-2">{o.orderName}</a>
          {o.customerName && <span className="text-muted-foreground"> · {o.customerName}</span>}
          {o.firstAttempt && (
            <p className="text-sm">
              Should have gone at <strong>{shouldHaveGoneWords(o.firstAttempt.at, o.ordersSince, now)}</strong>
              {o.firstAttempt.by && <> — pressed by {o.firstAttempt.by}</>}
            </p>
          )}
          {o.lastAttempt && (
            <p className="text-sm text-muted-foreground">
              Last try {whenWords(o.lastAttempt.at, now)}: {attemptWords(o.lastAttempt)}
              {o.attempts > 1 && ` (${o.attempts} tries)`}
            </p>
          )}
          {o.shopifyUnreadable && <p className="text-sm text-amber-700 dark:text-amber-400">Couldn't read it from Shopify just now — check it there before fulfilling.</p>}
          <p className="text-sm">
            {o.noCourier ? "Local delivery / collection — no tracking number"
              : o.booking ? <>Tracking: <span className="font-mono">{o.booking.waybill}</span></>
              : <span className="text-destructive">No live APC booking — open it on the packing screen to get a label first</span>}
          </p>
        </div>
        {!canFulfil ? (
          <span className="text-sm text-muted-foreground max-w-48">Open it on the packing screen and follow the checklist, or ask a manager.</span>
        ) : fulfil.isSuccess ? (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400"><CheckCircle2 className="w-4 h-4" /> Fulfilled</span>
        ) : confirming ? (
          <div className="flex items-center gap-2">
            <button onClick={() => setConfirming(false)} disabled={fulfil.isPending} className="px-3 py-2 rounded-lg border border-border text-sm font-medium">Cancel</button>
            <button
              onClick={() => fulfil.mutate()}
              disabled={fulfil.isPending}
              className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-60"
            >
              {fulfil.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Yes — fulfil and email the customer
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            disabled={!canSend || !found}
            title={!found ? "Tick that you've found the box first" : undefined}
            className={cn("px-3 py-2 rounded-lg border-2 text-sm font-bold", canSend && found ? "border-primary text-primary hover:bg-primary/5" : "border-border text-muted-foreground opacity-50")}
          >
            {o.noCourier ? "Fulfil" : "Fulfil with tracking"}
          </button>
        )}
      </div>
      {!fulfil.isSuccess && canSend && (
        <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg bg-secondary/40 px-3 py-2">
          <input type="checkbox" className="mt-0.5 w-4 h-4" checked={found} onChange={e => { setFound(e.target.checked); if (!e.target.checked) setConfirming(false); }} />
          <span>
            I've found this box packed{o.customerName ? ` — ${o.customerName}` : ""}{ending ? <>, APC label ending <span className="font-mono">{ending}</span></> : ""}.
            <span className="block text-xs text-muted-foreground">Not there? It was never packed — pack it on the packing screen instead of fulfilling it here.</span>
          </span>
        </label>
      )}
      {fulfil.isError && <p className="text-sm text-destructive">{(fulfil.error as Error).message}</p>}
    </li>
  );
}

function NotInShopifyModal({ onClose, canFulfil }: { onClose: () => void; canFulfil: boolean }) {
  const { data, isLoading, error, refetch, isFetching } = useStuck();
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Not in Shopify"
        className="bg-card rounded-2xl shadow-xl w-full max-w-3xl max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <h2 className="text-lg font-display font-bold">Not in Shopify</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} disabled={isFetching} className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium flex items-center gap-1.5">
              {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Check again
            </button>
            <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {isLoading ? (
            <p className="py-8 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /> Checking Shopify…</p>
          ) : error ? (
            <p className="text-destructive">Couldn't load the list — {(error as Error).message}</p>
          ) : (data?.orders.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nothing stuck — every order we tried to fulfil in the last 7 days is fulfilled in Shopify.</p>
          ) : (
            <ul className="space-y-2">
              {data!.orders.map(o => <Row key={o.orderId} o={o} adminBase={data!.adminBase} canFulfil={canFulfil} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
