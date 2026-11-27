/**
 * 8-pack orders queued for a make-day that has no plan yet (Graeme, 22 Nov
 * 2026). They're already tagged for despatch, so they're off the "to
 * process" list; this strip keeps them in sight until their bags are on a
 * plan — amber while waiting, RED once the make-day has come with the bags
 * still not on a plan. Server: GET/POST /api/wholesale-bags/queued.
 *
 * No one-tap "Take out of queue" on the strip (Graeme, 27 Nov 2026: "it's
 * very rare that we would take it out of the queue … that could accidentally
 * be clicked"). Tap an order to open it; taking it out lives in there, behind
 * its own confirm.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { showQueuedOrder } from "@/lib/queued-bags-show";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface QueuedBagOrder {
  id: number;
  orderName: string;
  customerName: string | null;
  deliveryDate: string;
  productionDate: string;
  lines: Array<{ recipeId: number; recipeName: string; bags: number }>;
  status: "queued" | "applied" | "cancelled";
  problem: string | null;
  overdue: boolean;
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Queued orders still waiting — for one make-day when `date` is given. */
export function useQueuedBagOrders(date?: string, enabled = true) {
  return useQuery<QueuedBagOrder[]>({
    queryKey: ["queued-bag-orders", date ?? "all"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/wholesale-bags/queued${date ? `?date=${date}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { queued: QueuedBagOrder[] }).queued;
    },
  });
}

export function bagsText(lines: QueuedBagOrder["lines"]): string {
  return lines.map(l => `${l.bags} × ${l.recipeName}`).join(", ");
}

export function QueuedBagOrdersStrip({ className }: { className?: string }) {
  const { data } = useQueuedBagOrders();
  const [openId, setOpenId] = useState<number | null>(null);
  // Out of the way until the morning its plan is normally made (and gone
  // once its bags are on a plan — the server stops returning it).
  const rows = (data ?? []).filter(r => showQueuedOrder(r));
  if (rows.length === 0) return null;
  const overdue = rows.filter(r => r.overdue).length;
  const open = rows.find(r => r.id === openId) ?? null;

  return (
    <div className={cn("rounded-xl border-2 overflow-hidden bg-card", overdue ? "border-destructive" : "border-amber-400", className)}>
      <div className={cn("px-4 py-2 flex items-center gap-2 text-sm font-semibold", overdue ? "bg-destructive/10 text-destructive" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300")}>
        {overdue ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
        {overdue
          ? `${overdue} queued 8-pack order${overdue === 1 ? "" : "s"} NOT on a plan for ${overdue === 1 ? "its" : "their"} make-day — sort it now or they won't be made`
          : `Queued 8-pack bag order${rows.length === 1 ? "" : "s"} due to go on today's production plan — ${rows.length === 1 ? "it goes" : "they go"} on when the plan is saved, and this disappears once ${rows.length === 1 ? "it has" : "they have"}`}
      </div>
      <ul className="divide-y divide-border">
        {rows.map(r => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => setOpenId(r.id)}
              className={cn("w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-secondary/50 transition-colors", r.overdue && "bg-destructive/5")}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {r.orderName}{r.customerName ? <span className="font-normal text-muted-foreground"> · {r.customerName}</span> : null}
                </span>
                <span className="block text-sm">{bagsText(r.lines)} · make {fmt(r.productionDate)} · deliver {fmt(r.deliveryDate)}</span>
                {r.problem && <span className={cn("block text-xs", r.overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>{r.problem}</span>}
              </span>
              <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <QueuedBagOrderDialog order={open} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** One queued order, opened from the strip: what it is and when, and the
 *  rarely-needed "take it out of the queue" behind its own confirm. */
function QueuedBagOrderDialog({ order, onClose }: { order: QueuedBagOrder | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/wholesale-bags/queued/${id}/cancel`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["queued-bag-orders"] });
      toast({ title: "Taken out of the queue", description: "Its tags are off — it's back on the list to process." });
      close();
    },
    onError: (e: Error) => toast({ title: "Couldn't take it out", description: e.message, variant: "destructive" }),
  });
  const close = () => { setConfirming(false); onClose(); };

  return (
    <Dialog open={order != null} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl">
        {order && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">
                {order.orderName}{order.customerName ? <span className="font-normal text-muted-foreground"> · {order.customerName}</span> : null}
              </DialogTitle>
              <DialogDescription>Queued 8-pack bag order — its bags go on the plan for its make day when that plan is saved.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <ul className="rounded-xl border border-border divide-y divide-border">
                {order.lines.map(l => (
                  <li key={l.recipeId} className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="font-medium">{l.recipeName}</span>
                    <span className="tabular-nums font-semibold">{l.bags} {l.bags === 1 ? "bag" : "bags"}</span>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-secondary/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Make</p>
                  <p className="font-semibold">{fmt(order.productionDate)}</p>
                </div>
                <div className="rounded-xl bg-secondary/50 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Deliver</p>
                  <p className="font-semibold">{fmt(order.deliveryDate)}</p>
                </div>
              </div>
              {order.problem && (
                <p className={cn("text-sm", order.overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>{order.problem}</p>
              )}

              {order.status === "queued" && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-sm font-semibold">Wrong dates, or shouldn&rsquo;t be made?</p>
                  <p className="text-sm text-muted-foreground">
                    Take it out of the queue: its date tags come off and it goes back on the 8-pack list to process, where you can pick new dates. Rarely needed.
                  </p>
                  {confirming ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">Take {order.orderName} out and untag it?</span>
                      <button
                        type="button"
                        onClick={() => cancel.mutate(order.id)}
                        disabled={cancel.isPending}
                        className="min-h-11 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {cancel.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Yes, take it out
                      </button>
                      <button type="button" onClick={() => setConfirming(false)} className="min-h-11 px-4 rounded-lg border-2 border-border text-sm font-semibold">
                        Keep it queued
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirming(true)} className="min-h-11 px-4 rounded-lg border-2 border-border text-sm font-semibold hover:bg-secondary">
                      Take out of queue…
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button type="button" onClick={close} className="min-h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Done</button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
