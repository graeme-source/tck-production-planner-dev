/**
 * What the deliveries page says about a received line and order (Graeme,
 * 2026-10-15: missing items showed a green "received" tick). Green only when
 * the line was ticked and everything ordered arrived; amber when short; red
 * when nothing came. Rules: lib/goods-in lineStatus / orderShortage.
 */
import { AlertTriangle, Check, X } from "lucide-react";
import type { LineStatus, OrderShortage } from "@workspace/goods-in";

export function LineReceiptStatus({ status, receivedLabel, orderedLabel }: {
  status: LineStatus;
  /** "6 bottles" */
  receivedLabel: string;
  /** "8 bottles" */
  orderedLabel: string;
}) {
  switch (status) {
    case "received":
      return (
        <span className="text-green-700 dark:text-green-400 font-semibold inline-flex items-center gap-1">
          <Check className="w-4 h-4" strokeWidth={3} /> {receivedLabel} received
        </span>
      );
    case "short":
      return (
        <span className="text-amber-700 dark:text-amber-400 font-semibold inline-flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> Short — {receivedLabel} of {orderedLabel} received
        </span>
      );
    case "not_received":
      return (
        <span className="text-red-700 dark:text-red-400 font-semibold inline-flex items-center gap-1">
          <X className="w-4 h-4" strokeWidth={3} /> Not received
        </span>
      );
    case "unconfirmed":
      return (
        <span className="text-amber-700 dark:text-amber-400 font-semibold inline-flex items-center gap-1" title="Booked in before 15 Oct without being ticked — check it really arrived">
          <AlertTriangle className="w-4 h-4" /> Not ticked — {receivedLabel} booked in, check it arrived
        </span>
      );
    default:
      return null;
  }
}

/** "Received — 2 items short" in place of a plain green "Received". */
export function OrderShortBadge({ shortage }: { shortage: OrderShortage }) {
  if (!shortage.label && shortage.unconfirmed === 0) return null;
  return (
    <>
      {shortage.label && (
        <span className={
          "text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 " +
          (shortage.notReceived > 0
            ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
            : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200")
        }>
          <AlertTriangle className="w-3 h-3" /> Received — {shortage.label}
        </span>
      )}
      {shortage.unconfirmed > 0 && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          {shortage.unconfirmed} not ticked
        </span>
      )}
    </>
  );
}
