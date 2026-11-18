/**
 * The second confirmation before goods-in puts stock on Shopify (Graeme,
 * 28 Oct 2026): received bought-in items linked to a Shopify variant go
 * straight on sale, so the receiver sees what's about to upload — with the
 * working, packs × units per pack — and confirms with one button. Typing the
 * number again was dropped on 18 Nov 2026 ("there are enough checks").
 *
 * Rendered INSIDE the receive dialog's card (the dialog is modal, so a portal
 * outside it wouldn't take taps): covers the card, X / "Back" close it, and
 * it scrolls inside if there are several items.
 */
import { Loader2, ShoppingBag, Upload, X } from "lucide-react";
import { SHOPIFY_UPLOAD_CONFIRM, SHOPIFY_UPLOAD_WARNING, type ShopifyUpload } from "@workspace/goods-in";

export function ShopifyUploadConfirm({ uploads, saving, onConfirm, onClose }: {
  uploads: ShopifyUpload[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {

  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-2 sm:p-4" onClick={saving ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload to Shopify"
        onClick={e => e.stopPropagation()}
        className="bg-background border-2 border-amber-500 rounded-2xl shadow-2xl w-full max-w-xl max-h-full flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <ShoppingBag className="w-6 h-6 text-amber-600 shrink-0" />
          <h2 className="flex-1 font-display font-bold text-xl">Upload to Shopify</h2>
          <button onClick={onClose} disabled={saving} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-secondary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4">
          <p className="text-base font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-xl px-4 py-3">
            {SHOPIFY_UPLOAD_WARNING}
          </p>

          {uploads.map(u => (
            <div key={u.lineId} className="rounded-2xl border-2 border-border p-4 space-y-1">
              <p className="text-xl font-bold leading-tight">{u.product}</p>
              <p className="text-2xl font-bold tabular-nums">
                {u.units > 0 ? "Adds " : "Takes "}{Math.abs(u.units)} {u.units > 0 ? "to" : "off"} Shopify
              </p>
              <p className="text-base text-muted-foreground tabular-nums">
                {Math.abs(u.packs)} {Math.abs(u.packs) === 1 ? "pack" : "packs"} × {u.perPack} each
                {u.name !== u.product && <> · received as {u.name}</>}
              </p>
            </div>
          ))}
        </div>

        <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[56px] rounded-xl border-2 border-border font-semibold text-base hover:bg-secondary/50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="sm:col-span-2 min-h-[56px] px-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : <><Upload className="w-5 h-5 shrink-0" /> {SHOPIFY_UPLOAD_CONFIRM}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
