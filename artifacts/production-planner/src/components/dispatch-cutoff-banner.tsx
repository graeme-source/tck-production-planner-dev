/**
 * The 2:16 order check's alert on the packing and wrapping screens (Graeme,
 * 5 Nov 2026): orders placed before 2:00 that aren't on tomorrow's run yet.
 * Check again looks at Shopify and clears it for the day once they're sorted;
 * Dismiss clears it regardless. Shared between screens, so either does it for
 * everyone. Rules: api-server lib/dispatch-cutoff-rules.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KEY = ["dispatch-cutoff"] as const;

interface MissingOrder { id: number; name: string; customer: string | null; placedAt: string; reason: string }
interface CutoffAlert { orders: MissingOrder[]; failed: boolean }

const placedTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

async function post(path: string): Promise<{ alert?: CutoffAlert | null }> {
  const res = await fetch(`${BASE}/api/dispatch-cutoff/${path}`, { method: "POST", credentials: "include" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as { alert?: CutoffAlert | null };
}

export function DispatchCutoffBanner() {
  const qc = useQueryClient();
  const { data } = useQuery<{ alert: CutoffAlert | null }>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/dispatch-cutoff`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const fail = (e: Error) => toast({ title: "Not done", description: e.message, variant: "destructive" });
  const checkAgain = useMutation({
    mutationFn: () => post("check-again"),
    onSuccess: ({ alert }) => {
      qc.setQueryData(KEY, { alert: alert ?? null });
      toast(alert
        ? { title: `Still ${alert.orders.length} to sort`, description: "The list has been updated." }
        : { title: "All clear", description: "Every order is on tomorrow's run." });
    },
    onError: fail,
  });
  const dismiss = useMutation({
    mutationFn: () => post("dismiss"),
    onSuccess: () => qc.setQueryData(KEY, { alert: null }),
    onError: fail,
  });

  const alert = data?.alert;
  if (!alert) return null;
  const count = alert.orders.length;
  const busy = checkAgain.isPending || dismiss.isPending;
  return (
    <div role="alert" className="mb-3 rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
      <p className="flex items-center gap-2 text-lg font-display font-bold text-red-800 dark:text-red-200">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        {alert.failed
          ? "The 2:16 order check couldn't run. Check tomorrow's orders by hand."
          : `${count} order${count === 1 ? "" : "s"} placed before 2:00 ${count === 1 ? "isn't" : "aren't"} on tomorrow's run`}
      </p>
      {count > 0 && (
        <ul className="space-y-1">
          {alert.orders.map(o => (
            <li key={o.id} className="text-base">
              <b>{o.name}</b>{o.customer ? ` · ${o.customer}` : ""} · placed {placedTime(o.placedAt)} · {o.reason}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => checkAgain.mutate()} disabled={busy}
          className="h-11 px-4 rounded-xl bg-red-600 text-white font-bold flex items-center gap-2 disabled:opacity-50">
          {checkAgain.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check again
        </button>
        <button type="button" onClick={() => dismiss.mutate()} disabled={busy}
          className="h-11 px-4 rounded-xl border-2 border-border bg-card font-bold flex items-center gap-2 disabled:opacity-50">
          <X className="w-4 h-4" /> Dismiss
        </button>
      </div>
    </div>
  );
}
