import { CheckCircle2 } from "lucide-react";

interface ShopifyProduct {
  name: string;
  quantity?: number;
  quantityLabel?: string;
}

interface ShopifyConfirmDialogProps {
  title: string;
  description: string;
  products?: ShopifyProduct[];
  confirmLabel?: string;
  skipLabel?: string;
  onConfirm: () => void;
  onSkip?: () => void;
  onCancel: () => void;
}

export function ShopifyConfirmDialog({
  title,
  description,
  products,
  confirmLabel = "Confirm & sync",
  skipLabel = "Skip sync",
  onConfirm,
  onSkip,
  onCancel,
}: ShopifyConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-base">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {products && products.length > 0 && (
          <div className="bg-secondary/40 rounded-xl p-3 space-y-1.5 text-sm max-h-40 overflow-y-auto">
            {products.map((p, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <p className="font-medium text-foreground truncate">{p.name}</p>
                {p.quantity !== undefined && (
                  <p className="text-muted-foreground whitespace-nowrap flex-shrink-0">
                    +<strong className="text-foreground tabular-nums">{p.quantity}</strong>
                    {p.quantityLabel ? ` ${p.quantityLabel}` : " packs"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
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
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition-colors"
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
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors"
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
