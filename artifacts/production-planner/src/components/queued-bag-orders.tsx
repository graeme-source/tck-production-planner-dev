/**
 * 8-pack orders queued for a make-day that has no plan yet (Graeme, 22 Nov
 * 2026). They're already tagged for despatch, so they're off the "to
 * process" list; this strip keeps them in sight until their bags are on a
 * plan — amber while waiting, RED once the make-day has come with the bags
 * still not on a plan. Server: GET/POST /api/wholesale-bags/queued.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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
  const qc = useQueryClient();
  const { data } = useQueuedBagOrders();
  const [confirming, setConfirming] = useState<number | null>(null);
  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/wholesale-bags/queued/${id}/cancel`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    },
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ["queued-bag-orders"] });
      toast({ title: "Taken out of the queue", description: "Its tags are off — it's back on the list to process." });
    },
    onError: (e: Error) => toast({ title: "Couldn't take it out", description: e.message, variant: "destructive" }),
  });
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const overdue = rows.filter(r => r.overdue).length;

  return (
    <div className={cn("rounded-xl border-2 overflow-hidden bg-card", overdue ? "border-destructive" : "border-amber-400", className)}>
      <div className={cn("px-4 py-2 flex items-center gap-2 text-sm font-semibold", overdue ? "bg-destructive/10 text-destructive" : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300")}>
        {overdue ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
        {overdue
          ? `${overdue} queued 8-pack order${overdue === 1 ? "" : "s"} NOT on a plan for ${overdue === 1 ? "its" : "their"} make-day — sort it now or they won't be made`
          : `${rows.length} 8-pack order${rows.length === 1 ? "" : "s"} queued — the bags go on the plan as soon as it's made`}
      </div>
      <ul className="divide-y divide-border">
        {rows.map(r => (
          <li key={r.id} className={cn("px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1", r.overdue && "bg-destructive/5")}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {r.orderName}{r.customerName ? <span className="font-normal text-muted-foreground"> · {r.customerName}</span> : null}
              </p>
              <p className="text-sm">{bagsText(r.lines)} · make {fmt(r.productionDate)} · deliver {fmt(r.deliveryDate)}</p>
              {r.problem && <p className={cn("text-xs", r.overdue ? "text-destructive font-semibold" : "text-muted-foreground")}>{r.problem}</p>}
            </div>
            {r.status === "queued" && (confirming === r.id ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Take it out and untag it?</span>
                <button onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}
                  className="h-9 px-3 rounded-lg bg-destructive text-destructive-foreground text-sm font-semibold flex items-center gap-1 disabled:opacity-50">
                  {cancel.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, take out
                </button>
                <button onClick={() => setConfirming(null)} aria-label="Keep it queued" className="h-9 w-9 rounded-lg border border-border flex items-center justify-center"><X className="w-4 h-4" /></button>
              </span>
            ) : (
              <button onClick={() => setConfirming(r.id)} className="h-9 px-3 rounded-lg border-2 border-border text-sm font-semibold hover:bg-secondary">Take out of queue</button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
