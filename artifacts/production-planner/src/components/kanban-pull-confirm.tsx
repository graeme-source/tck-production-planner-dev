// The confirmation between scanning a kanban card and actually ordering
// something (Graeme, 2026-08-28: "warns the user and says, this will place
// this item on order as per the kanban rules. Are you sure?").
//
// Pulling a kanban spends money, so the scan alone must never do it. Shared
// by both routes in — the dock scanner and the deep link a phone camera
// lands on — so the warning reads identically however someone got here.
//
// Big text, big buttons: this gets used mid-shift, at arm's length, often
// with gloves on.

import { CheckCircle2, Loader2, X, AlertTriangle } from "lucide-react";

export interface KanbanPreview {
  ingredientId: number;
  ingredientName: string;
  orderQty: number;
  unitLabel: string;
  supplierName: string | null;
  alreadyQueued: boolean;
}

export function KanbanPullConfirm({ preview, busy, onConfirm, onCancel }: {
  preview: KanbanPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-5 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <p className="text-3xl font-bold leading-snug">{preview.ingredientName}</p>
        <p className="text-2xl font-bold mt-2">
          {preview.orderQty} {preview.unitLabel}
        </p>
        {preview.supplierName && (
          <p className="text-lg text-muted-foreground mt-1">from {preview.supplierName}</p>
        )}
        <p className="text-lg mt-4">
          This asks for it to be <strong>ordered today</strong>, at the kanban
          quantity. The planner checks the order before it goes out.
        </p>
        {preview.alreadyQueued && (
          <p className="text-lg font-bold text-amber-700 dark:text-amber-400 mt-3">
            Careful — this is already on today's order.
          </p>
        )}
      </div>

      {/* The rule people most often get wrong: the card is pulled when you
          START USING the stock behind it, not when you notice the card. A
          card sitting in front of untouched safety stock is doing its job —
          pulling it then orders something we don't need yet. Teaching this
          at the moment of the decision is worth more than teaching it in a
          meeting (Graeme, 2026-08-28). */}
      <div className="rounded-2xl border-2 border-border bg-secondary/40 p-4">
        <p className="text-lg font-bold mb-1">Before you say yes</p>
        <p className="text-lg leading-relaxed">
          Have you actually <strong>started using the stock behind this card</strong>?
        </p>
        <p className="text-base text-muted-foreground mt-2 leading-relaxed">
          If the safety stock behind it is still untouched, the card is doing its
          job — leave it, and pull it when you break into that stock.
        </p>
      </div>

      <button
        onClick={onConfirm}
        disabled={busy}
        className="w-full h-20 rounded-2xl bg-primary text-primary-foreground text-2xl font-bold flex items-center justify-center gap-3 disabled:opacity-50 active:scale-[0.99] transition-all shadow-lg shadow-primary/20"
      >
        {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <CheckCircle2 className="w-7 h-7" />}
        Yes — add it to today's order
      </button>

      <button
        onClick={onCancel}
        disabled={busy}
        className="w-full h-16 rounded-2xl border-2 border-border text-xl font-bold flex items-center justify-center gap-3 hover:bg-secondary/50 transition-colors disabled:opacity-50"
      >
        <X className="w-6 h-6" /> No — not used it yet
      </button>
    </div>
  );
}
