/**
 * "Old APC booking 2026… is still live — Cancel it in APC?"
 *
 * Shown when the app has retired an order's consignment (rescheduled, or a
 * booking for another day) but APC may still collect against it. Nothing is
 * sent to APC unless a manager presses "Yes, cancel it in APC". If APC won't
 * cancel it (e.g. already manifested), the waybill is shown to cancel by hand
 * in Hypaship, and "I'll cancel it in Hypaship" records that a person was told.
 */
import { useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCancelInApc, useCancelDecision, friendlyDay } from "./api";

export function OldBookingPrompt({ waybill, orderName, collectionDate, reason, apcStatus, liveInApc }: {
  waybill: string;
  orderName?: string | null;
  collectionDate: string | null;
  reason: string | null;
  apcStatus: string | null;
  /** true = APC shows it live now; null = couldn't tell. */
  liveInApc: boolean | null;
}) {
  const cancel = useCancelInApc();
  const decide = useCancelDecision();
  const [byHand, setByHand] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded-xl border-2 border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4 flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-green-700 dark:text-green-300 shrink-0" />
        <p className="text-base text-green-900 dark:text-green-200">{done}</p>
      </div>
    );
  }

  const busy = cancel.isPending || decide.isPending;
  return (
    <div className="rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-lg font-bold text-amber-950 dark:text-amber-100 break-words">
            Old APC booking <span className="font-mono">{waybill}</span>
            {liveInApc === false ? " is no longer live" : liveInApc ? " is still live" : " may still be live"}
            {orderName ? ` (${orderName})` : ""} — Cancel it in APC?
          </p>
          <p className="text-sm text-amber-900/80 dark:text-amber-200/80 mt-1">
            Collection {friendlyDay(collectionDate)}
            {apcStatus ? ` · APC says: ${apcStatus}` : liveInApc === null ? " · couldn't reach APC to check" : ""}
            {reason ? ` · ${reason}` : ""}
          </p>
        </div>
      </div>

      {byHand && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-900 dark:text-red-200">
          {byHand}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!byHand && (
          <button
            disabled={busy}
            onClick={() => cancel.mutate(waybill, {
              onSuccess: () => {
                setDone(`Cancelled ${waybill} in APC.`);
                toast({ title: "Cancelled in APC", description: waybill });
              },
              onError: (e: Error & { cancelByHand?: boolean }) => {
                if (e.cancelByHand) setByHand(e.message);
                else toast({ title: "Not cancelled", description: e.message, variant: "destructive" });
              },
            })}
            className="min-h-12 px-5 rounded-xl bg-red-600 text-white font-bold text-base hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {cancel.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Ban className="w-5 h-5" />}
            Yes, cancel it in APC
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => decide.mutate({ waybill, decision: "cancel_by_hand" }, {
            onSuccess: () => setDone(`Noted — you'll cancel ${waybill} by hand in Hypaship.`),
            onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
          })}
          className="min-h-12 px-5 rounded-xl border-2 border-border bg-card font-semibold text-base hover:bg-secondary/60 disabled:opacity-50"
        >
          I'll cancel it in Hypaship
        </button>
        <button
          disabled={busy}
          onClick={() => decide.mutate({ waybill, decision: "keep" }, {
            onSuccess: () => setDone(`Noted — ${waybill} left as it is in APC.`),
            onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
          })}
          className="min-h-12 px-5 rounded-xl border-2 border-border bg-card font-semibold text-base hover:bg-secondary/60 disabled:opacity-50"
        >
          Leave it
        </button>
      </div>
    </div>
  );
}
