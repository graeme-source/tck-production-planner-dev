import { Package, X as XIcon } from "lucide-react";
import { useModalScrollKeeper } from "@/hooks/use-modal-scroll";
import { StockCheckEntryForm } from "./stock-check-entry";

/** The item being counted — Main Prep rows and Raw Meat ingredients both fit. */
export interface ForceStockCheckItem {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  packWeight?: number | null;
  /** Today's plan need in `unit`, for the count's sanity check. */
  totalQty?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────
// ForceStockCheckModal — shown to the person who just finished prepping an
// ingredient with a stock check due and no count yet. The count itself is
// the shared two-step entry (amount, then a unit they tap — Graeme, 15 Oct
// 2026). Skip (or the X) puts it off; it can still be logged from the Stock
// Check tab. Shared by Main Prep and Raw Meat Prep (issue #360).
// ─────────────────────────────────────────────────────────────────────────
export function ForceStockCheckModal({
  ingredient,
  checkDate,
  isDraft,
  onSaved,
  onSkip,
  remainingCount,
}: {
  ingredient: ForceStockCheckItem;
  checkDate: string;
  isDraft: boolean;
  onSaved: (nativeQty: number) => void;
  onSkip: () => void;
  remainingCount: number;
}) {
  // This component IS the modal: pin the page behind it for its lifetime
  // (the ovens weight-modal bug, same cure — Graeme, 2026-09-07).
  useModalScrollKeeper();
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stock check required: ${ingredient.ingredientName}`}
        className="bg-card border-2 border-blue-500 rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 border-b border-border/60">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-xl">Stock check required</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Prep of <span className="font-semibold text-foreground">{ingredient.ingredientName}</span> is done.
              Record what&rsquo;s left in stock before moving on.
            </p>
            {remainingCount > 1 && (
              <p className="text-xs text-amber-600 mt-1.5 font-medium">
                +{remainingCount - 1} more stock check{remainingCount - 1 === 1 ? "" : "s"} waiting after this one.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip for now"
            title="Skip this stock check for now — you can still log it from the Stock Check tab"
            className="w-11 h-11 -mr-2 -mt-1 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <StockCheckEntryForm
            ingredient={{ id: ingredient.ingredientId, name: ingredient.ingredientName, unit: ingredient.unit, packWeight: ingredient.packWeight }}
            checkDate={checkDate}
            isDraft={isDraft}
            planNeedNative={ingredient.totalQty ?? null}
            onSaved={onSaved}
            onCancel={onSkip}
            cancelLabel="Skip"
          />
          <p className="text-xs text-muted-foreground mt-3">
            Enter <span className="font-semibold">0</span> if there&rsquo;s nothing left — this is still a valid record.
          </p>
        </div>
      </div>
    </div>
  );
}
