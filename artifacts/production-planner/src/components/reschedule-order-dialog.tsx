/**
 * Move one failed order to a later delivery date, and tell the customer.
 *
 * Used when a consignment genuinely can't be booked — a postcode with no
 * Saturday service, or weather closing a route. The order isn't cancelled: it
 * slides to the next date we can deliver, drops out of today's dispatch wave,
 * and the customer gets a personally addressed email.
 *
 * Deliberately one order at a time (Graeme, 2026-08-21). Nothing is written or
 * sent until the operator has seen the exact tag changes, the Zapiet date, and
 * the finished email — because this touches a live customer order and puts a
 * promise in writing.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, AlertTriangle, CalendarClock, Mail, Tag, CheckCircle2, X, ExternalLink, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ReschedulePreview {
  orderId: number;
  orderName: string;
  customerName: string | null;
  fromDate: string;
  toDate: string;
  toDateFriendly: string;
  defaultDate: string;
  tags: { before: string; after: string; removed: string[]; added: string[] };
  deliveryAttribute: { before: string | null; after: string; preserved: string[] };
  email: { to: string | null; subject: string; body: string };
  warnings: string[];
  /** What APC's POSTINFO postcode sheet says this postcode can take —
   *  the manual spreadsheet check, now done by the server. */
  postcodeCheck?: {
    summary: string;
    service: { nextDay: boolean; saturdayDelivery: boolean; transitDays: number | null; matchedOn: string } | null;
  } | null;
}

export function RescheduleOrderDialog({ orderId, orderName, fromDate, adminUrl, onClose, onDone }: {
  orderId: number;
  orderName: string;
  /** The dispatch date the order is currently on — what we're moving it off. */
  fromDate: string;
  adminUrl?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  // null = "use the server's next-available default"; a string = operator pick.
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const [sendCustomerEmail, setSendCustomerEmail] = useState(true);
  const [done, setDone] = useState<{ toDate: string; emailed: boolean } | null>(null);

  const params = new URLSearchParams({ from: fromDate });
  if (chosenDate) params.set("date", chosenDate);

  const { data: preview, isLoading, error } = useQuery<ReschedulePreview>({
    queryKey: ["reschedule-preview", orderId, fromDate, chosenDate],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/fulfilment/orders/${orderId}/reschedule-preview?${params}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not build the preview");
      return body;
    },
    // The preview reads live Shopify state; don't serve a stale one.
    staleTime: 0,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("No preview loaded");
      const res = await fetch(`${BASE}/api/fulfilment/orders/${orderId}/reschedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: preview.toDate, fromDate, sendCustomerEmail }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Reschedule failed");
      return body as { toDate: string; emailed: boolean; emailError?: string; emailSkipped?: string };
    },
    onSuccess: (r) => {
      setDone({ toDate: r.toDate, emailed: r.emailed });
      // The order moved even if the email didn't — say which happened rather
      // than a blanket success.
      toast({
        title: `${orderName} moved to ${r.toDate}`,
        description: r.emailed ? "Customer emailed." : r.emailError ?? r.emailSkipped ?? "No email sent.",
        variant: r.emailError ? "destructive" : undefined,
      });
      onDone?.();
    },
    onError: (e: Error) => toast({ title: "Reschedule failed", description: e.message, variant: "destructive" }),
  });

  // Portalled to <body>. This opens on top of the APC booking dialog, whose
  // Radix content is itself portalled to the end of <body> — so rendering
  // here in the page tree left it painting UNDERNEATH the dialog that opened
  // it, whatever z-index it carried: an ancestor on the packing page makes
  // its own stacking context, and z-[120] only ranks inside that. As a body
  // sibling mounted after the Radix portal, z-[120] beats the dialog's z-50
  // for real (Graeme, 2026-09-04).
  return createPortal(
    // pointer-events-auto is load-bearing: this renders over a MODAL Radix
    // dialog, and Radix puts pointer-events:none on the whole body while one
    // is open (its own content wins them back inside its portal). Without
    // this, every click here fell through to Radix's overlay — first closing
    // the parent (fixed 2026-08-21 morning), then, with that close guarded,
    // doing nothing at all: a perfectly rendered dialog nobody could press
    // (#133128, same afternoon). It also made the email preview unscrollable.
    <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4 pointer-events-auto">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <CalendarClock className="w-5 h-5 text-amber-600" />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Move {orderName} to a later delivery date</h2>
            <p className="text-xs text-muted-foreground">
              Currently {fromDate}
              {preview?.customerName ? ` · ${preview.customerName}` : ""}
            </p>
          </div>
          {adminUrl && (
            <a href={adminUrl} target="_blank" rel="noopener noreferrer"
               className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Shopify <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Reading the order from Shopify…
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {(error as Error).message}
            </div>
          )}

          {done && (
            <div className="rounded-xl border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
              <p className="font-semibold text-green-800 dark:text-green-300 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" /> Moved to {done.toDate}
              </p>
              <p className="text-sm text-green-800/80 dark:text-green-300/80 mt-1">
                {done.emailed ? "The customer has been emailed." : "No customer email was sent."}
              </p>
            </div>
          )}

          {preview && !done && (
            <>
              {preview.warnings.map((w, i) => (
                <div key={i} className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span className="text-amber-900 dark:text-amber-200">{w}</span>
                </div>
              ))}

              {/* What APC's own postcode sheet says this address can take —
                  the manual spreadsheet check that used to precede every
                  reschedule decision, shown even when the news is good.
                  Blue when the sheet was found and read; amber when the
                  postcode isn't in it at all. */}
              {preview.postcodeCheck && (
                <div className={cn(
                  "rounded-lg border px-3 py-2 text-sm flex items-start gap-2",
                  preview.postcodeCheck.service
                    ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200"
                    : "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200",
                )}>
                  <Truck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{preview.postcodeCheck.summary}</span>
                </div>
              )}

              {/* New date. Defaults to the next deliverable day; the operator
                  can override for a customer who has asked for something else. */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New delivery date</label>
                <div className="flex items-center gap-3 mt-1.5">
                  <input
                    type="date"
                    value={preview.toDate}
                    min={preview.fromDate}
                    onChange={e => setChosenDate(e.target.value || null)}
                    className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
                  />
                  <span className="text-sm font-medium">{preview.toDateFriendly}</span>
                  {chosenDate && chosenDate !== preview.defaultDate && (
                    <button onClick={() => setChosenDate(null)} className="text-xs text-primary hover:underline">
                      reset to next available ({preview.defaultDate})
                    </button>
                  )}
                </div>
              </div>

              {/* Exactly what changes on the order — shown because this writes
                  to a live order and the operator is the last check. */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> What changes on the Shopify order
                </p>
                <div className="text-sm space-y-1">
                  {preview.tags.removed.length > 0 && (
                    <p><span className="text-muted-foreground">Tags removed:</span>{" "}
                      {preview.tags.removed.map(t => (
                        <span key={t} className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300 line-through">{t}</span>
                      ))}
                    </p>
                  )}
                  {preview.tags.added.length > 0 && (
                    <p><span className="text-muted-foreground">Tags added:</span>{" "}
                      {preview.tags.added.map(t => (
                        <span key={t} className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300">{t}</span>
                      ))}
                    </p>
                  )}
                  <p><span className="text-muted-foreground">Zapiet Delivery-Date:</span>{" "}
                    <span className="font-mono line-through opacity-60">{preview.deliveryAttribute.before ?? "(none)"}</span>
                    {" → "}
                    <span className="font-mono font-semibold">{preview.deliveryAttribute.after}</span>
                  </p>
                  {preview.deliveryAttribute.preserved.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Untouched: {preview.deliveryAttribute.preserved.join(", ")}
                    </p>
                  )}
                </div>
              </div>

              {/* The email, verbatim. Nobody should have to guess what the
                  customer will receive. */}
              <div className="rounded-xl border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email to {preview.email.to ?? "(no address on this order)"}
                  </p>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={sendCustomerEmail && !!preview.email.to}
                      disabled={!preview.email.to}
                      onChange={e => setSendCustomerEmail(e.target.checked)}
                    />
                    Send it
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">{preview.email.subject}</p>
                {/* No height cap and no scroller of its own. It had both, and
                    a scroll region nested inside the dialog's own scroll
                    region is unreliable to drive — on the iPad the packing
                    screen runs on, the inner box swallowed the gesture and the
                    end of the email was unreachable. One scroller for the
                    whole dialog; the email just renders at its full height. */}
                <pre className="text-xs whitespace-pre-wrap font-sans bg-secondary/30 rounded-lg p-3">
                  {preview.email.body}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium border border-border hover:bg-secondary/50">
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              onClick={() => apply.mutate()}
              disabled={!preview || apply.isPending}
              className={cn(
                "px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40",
                "bg-amber-600 hover:bg-amber-700",
              )}
            >
              {apply.isPending
                ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Moving…</span>
                : sendCustomerEmail && preview?.email.to
                  ? `Move to ${preview?.toDate} and email the customer`
                  : `Move to ${preview?.toDate ?? "…"}`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
