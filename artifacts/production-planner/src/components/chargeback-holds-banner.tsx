import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ExternalLink, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type HeldOrder = {
  orderId: number;
  orderName: string;
  customerName: string;
  disputes: string[];
  reason: string;
  adminUrl: string;
};

type ChargebackHolds = {
  tag: string;
  held: HeldOrder[];
  openDisputesAnywhere: number;
  fetchedAt: string | null;
  stale: boolean;
  lastError: string | null;
};

async function fetchHolds(tag: string): Promise<ChargebackHolds> {
  const res = await fetch(`${BASE}/api/fulfilment/chargeback-holds?tag=${encodeURIComponent(tag)}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Couldn't load chargeback holds");
  return data;
}

/**
 * "1 order held — open chargeback" (Graeme, 19 Oct 2026). Objective D.
 *
 * Orders with an open chargeback are filtered out of the pack list by the
 * server, and every despatch route refuses them. This banner is how the
 * bench knows they exist: tap it for the list, each order linking to Shopify.
 * Loading it refreshes the chargeback list from Shopify (read-only).
 */
export function ChargebackHoldsBanner({ tag }: { tag: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const { data, error } = useQuery({
    queryKey: ["fulfilment-chargeback-holds", tag],
    queryFn: () => fetchHolds(tag!),
    enabled: !!tag,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const held = data?.held ?? [];
  const listProblem = error
    ? (error as Error).message
    : data?.stale
      ? `The chargeback list couldn't be refreshed from Shopify${data.lastError ? ` (${data.lastError.slice(0, 120)})` : ""}. Each order is still checked as it's completed.`
      : null;

  if (held.length === 0 && !listProblem) return null;

  return (
    <>
      {held.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left rounded-2xl border-2 border-red-500 bg-red-50 dark:bg-red-950/40 p-4 flex items-center gap-4 hover:bg-red-100 dark:hover:bg-red-950/60 transition-colors"
        >
          <ShieldAlert className="h-8 w-8 text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-red-700 dark:text-red-300">
              {held.length} order{held.length === 1 ? "" : "s"} held — open chargeback
            </p>
            <p className="text-sm text-red-700/80 dark:text-red-300/80">
              Do not send. {held.map(h => h.orderName).join(", ")} {held.length === 1 ? "is" : "are"} hidden from the pack list. Tap to see why.
            </p>
          </div>
        </button>
      )}
      {listProblem && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{listProblem}</span>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-xl max-h-[92dvh] p-0 gap-0 flex flex-col rounded-2xl">
          <DialogHeader className="p-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-300">
              <ShieldAlert className="h-5 w-5" /> Held — open chargeback
            </DialogTitle>
            <DialogDescription>
              The customer's bank is disputing the payment. These orders can't be labelled, booked or completed
              until the dispute is closed. Put them aside and tell Graeme.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto p-5 space-y-3">
            {held.map(h => (
              <div key={h.orderId} className="rounded-xl border-2 border-red-300 dark:border-red-800 p-4">
                <div className="flex items-center justify-between gap-3">
                  <a
                    href={h.adminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xl font-bold text-red-700 dark:text-red-300 underline underline-offset-2 inline-flex items-center gap-1"
                  >
                    {h.orderName} <ExternalLink className="h-4 w-4" />
                  </a>
                  <span className="text-xs font-semibold uppercase tracking-wide bg-red-600 text-white rounded-full px-2 py-0.5">Do not send</span>
                </div>
                {h.customerName && <p className="text-sm mt-1">{h.customerName}</p>}
                <p className="text-sm text-muted-foreground mt-1">{h.reason}</p>
              </div>
            ))}
            {data?.fetchedAt && (
              <p className="text-xs text-muted-foreground">
                Chargeback list last checked {new Date(data.fetchedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
