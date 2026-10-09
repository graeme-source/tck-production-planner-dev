/**
 * The "are you sure?" step for anything that reaches a customer or APC from
 * the booking-issues report. It names the order number and the customer in
 * big type at the top, so the wrong card can't be actioned by mistake, and
 * sits OVER the report — nothing in the report moves while it's open.
 * Closable by its X, Cancel, the backdrop or Escape; the card is capped at
 * 92dvh and scrolls inside, so its buttons are always reachable.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConfirmSheet({ title, orderName, customerName, children, confirmLabel, onConfirm, onClose, busy, tone = "primary", confirmDisabled }: {
  title: string;
  orderName: string;
  customerName: string | null;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  tone?: "primary" | "danger" | "warn";
  confirmDisabled?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-3 sm:p-6 pointer-events-auto"
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-card rounded-3xl border-2 border-border shadow-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="text-3xl font-black tabular-nums leading-tight mt-1">{orderName}</p>
            {customerName && <p className="text-lg font-semibold text-muted-foreground">{customerName}</p>}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="h-12 w-12 shrink-0 rounded-xl border-2 border-border flex items-center justify-center hover:bg-secondary/60 disabled:opacity-40">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={busy} className="h-12 px-5 rounded-xl border-2 border-border text-base font-semibold hover:bg-secondary/50 disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
            className={cn(
              "h-12 px-6 rounded-xl text-base font-bold text-white inline-flex items-center gap-2 disabled:opacity-40",
              tone === "danger" ? "bg-red-600 hover:bg-red-700" : tone === "warn" ? "bg-amber-600 hover:bg-amber-700" : "bg-primary hover:bg-primary/90",
            )}
          >
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
