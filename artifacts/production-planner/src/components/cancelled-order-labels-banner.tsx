import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ExternalLink, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type CancelledOrderLabel = {
  waybill: string;
  orderId: number;
  orderName: string;
  cancelledAt: string;
  message: string;
  adminUrl: string;
};

async function fetchLabels(tag: string): Promise<{ tag: string; labels: CancelledOrderLabel[] }> {
  const res = await fetch(`${BASE}/api/fulfilment/cancelled-order-labels?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't check for cancelled orders");
  return data;
}

async function cancelLabel(waybill: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fulfilment/shipments/${encodeURIComponent(waybill)}/cancel`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't cancel the label");
}

/**
 * "Cancelled in Shopify — cancel this label" (Graeme, 21 Oct 2026).
 * Objective F.
 *
 * Cancelled orders are never tagged, listed or booked any more, but an order
 * cancelled AFTER its APC label was booked (#137271) still has a label APC
 * may collect against. This card names each one and lets a person cancel the
 * label — never automatic, because an APC write needs a human.
 */
export function CancelledOrderLabelsBanner({ tag }: { tag: string | null | undefined }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const queryKey = ["fulfilment-cancelled-order-labels", tag];
  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchLabels(tag!),
    enabled: !!tag,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const cancel = useMutation({
    mutationFn: cancelLabel,
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey });
    },
  });

  const labels = data?.labels ?? [];
  if (labels.length === 0) return null;

  return (
    <div className="rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Ban className="h-8 w-8 text-red-600 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-bold text-red-700 dark:text-red-300">
            Cancelled in Shopify — cancel {labels.length === 1 ? "this label" : `these ${labels.length} labels`}
          </p>
          <p className="text-sm text-red-700/80 dark:text-red-300/80">
            Do not send. The order was cancelled after its APC label was booked.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {labels.map(l => (
          <div key={l.waybill} className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-background p-4 space-y-2">
            <a
              href={l.adminUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xl font-bold text-red-700 dark:text-red-300 underline underline-offset-2 inline-flex items-center gap-1"
            >
              {l.orderName} <ExternalLink className="h-4 w-4" />
            </a>
            <p className="text-sm">{l.message}</p>
            <p className="text-xs text-muted-foreground break-all">Label {l.waybill}</p>
            {confirming === l.waybill ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(l.waybill)}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Yes, cancel at APC
                </button>
                <button
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => setConfirming(null)}
                  className="px-4 py-2 rounded-lg border font-semibold"
                >
                  Keep it
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { cancel.reset(); setConfirming(l.waybill); }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold"
              >
                Cancel this label
              </button>
            )}
            {cancel.isError && confirming === l.waybill && (
              <p className="text-sm text-red-700 dark:text-red-300">{(cancel.error as Error).message}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
