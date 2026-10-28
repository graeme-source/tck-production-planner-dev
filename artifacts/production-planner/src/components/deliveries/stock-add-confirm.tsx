/**
 * "Check what's going into stock" — shown when goods-in is saved (Graeme,
 * 28 Oct 2026): every item and what it adds to stock, so a delivery isn't
 * marked received at the ordered quantities without anyone checking (the
 * 300 g of basil that may never have arrived). One confirm button, plus
 * Back to change a line. Rendered INSIDE the receive dialog's card, like the
 * Shopify upload confirm (the dialog is modal), and scrolls inside.
 */
import { AlertTriangle, ArrowLeft, Check, Loader2, PackageCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STOCK_CONFIRM_BUTTON, STOCK_CONFIRM_TITLE, STOCK_CONFIRM_WARNING, type StockConfirmLine,
} from "@workspace/goods-in";

export function StockAddConfirm({ lines, saving, onConfirm, onClose }: {
  lines: StockConfirmLine[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={saving ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={STOCK_CONFIRM_TITLE}
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-primary rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <PackageCheck className="w-6 h-6 text-primary shrink-0" />
          <h2 className="flex-1 font-display font-bold text-xl">{STOCK_CONFIRM_TITLE}</h2>
          <button onClick={onClose} disabled={saving} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3">
          <p className="text-base font-semibold bg-secondary/50 border border-border rounded-xl px-4 py-3">{STOCK_CONFIRM_WARNING}</p>
          <ul className="space-y-2">
            {lines.map(l => (
              <li key={l.lineId} className={cn(
                "rounded-xl border-2 px-4 py-3 flex items-center gap-3",
                l.kind === "none" ? "border-border bg-secondary/30" : l.short ? "border-amber-400" : "border-border",
              )}>
                <span className="flex-1 min-w-0">
                  <span className="block text-lg font-bold leading-tight">{l.name}</span>
                  <span className={cn("block text-sm", l.short ? "text-amber-800 dark:text-amber-300 font-semibold" : "text-muted-foreground")}>
                    {l.short && <AlertTriangle className="inline w-4 h-4 mr-1 -mt-0.5" />}{l.detail}
                  </span>
                </span>
                <span className={cn(
                  "shrink-0 text-xl font-bold tabular-nums",
                  l.kind === "add" ? "text-emerald-700 dark:text-emerald-400" : l.kind === "remove" ? "text-red-600" : "text-muted-foreground",
                )}>
                  {l.changeText}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[56px] rounded-xl border-2 border-border font-semibold text-base hover:bg-secondary/50 inline-flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" /> Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="sm:col-span-2 min-h-[56px] px-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : <><Check className="w-5 h-5 shrink-0" strokeWidth={3} /> {STOCK_CONFIRM_BUTTON}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
