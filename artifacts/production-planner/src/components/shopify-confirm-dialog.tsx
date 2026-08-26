import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2 } from "lucide-react";

interface ShopifyProduct {
  name: string;
  quantity?: number;
  quantityLabel?: string;
  noPlus?: boolean;
}

interface ShopifyConfirmDialogProps {
  title: string;
  description: string;
  products?: ShopifyProduct[];
  /** Optional controls shown above the list — e.g. the scope of a bulk action. */
  extra?: ReactNode;
  confirmLabel?: string;
  skipLabel?: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onSkip?: () => void;
  onCancel: () => void;
}

export function ShopifyConfirmDialog({
  title,
  description,
  products,
  extra,
  confirmLabel = "Confirm & sync",
  skipLabel = "Skip sync",
  confirmDisabled = false,
  onConfirm,
  onSkip,
  onCancel,
}: ShopifyConfirmDialogProps) {
  // Rendered into <body>, NOT where it is written. Every caller sits inside a
  // .glass-panel, and backdrop-blur creates a stacking context — which trapped
  // this z-50 overlay inside its own panel, so the panel BELOW painted over
  // the confirm button and the packer had to collapse the panel to reach it
  // (Graeme, 2026-08-26). A portal takes the dialog out of that context for
  // good, wherever it is used.
  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      {/* Capped to the viewport with the buttons pinned outside the scroll
          area, so the confirm is always reachable however long the list is. */}
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] flex flex-col">
        <div className="p-6 pb-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-base">{title}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          {extra}
          {products && products.length > 0 && (
            <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5 text-sm max-h-40 overflow-y-auto">
              {products.map((p, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <p className="font-medium text-foreground truncate">{p.name}</p>
                  {p.quantity !== undefined && (
                    <p className="text-muted-foreground whitespace-nowrap flex-shrink-0">
                      {!p.noPlus && "+"}<strong className="text-foreground tabular-nums">{p.quantity}</strong>
                      {p.quantityLabel ? ` ${p.quantityLabel}` : " packs"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-6 pb-6 pt-0 flex-shrink-0">
          {onSkip ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2.5 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSkip}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                {skipLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirmDisabled}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {confirmLabel}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 py-2.5 border border-border rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirmDisabled}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
