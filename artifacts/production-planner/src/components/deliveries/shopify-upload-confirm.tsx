/**
 * The second confirmation before goods-in puts stock on Shopify (Graeme,
 * 28 Oct 2026): received bought-in brownies — any ingredient linked to a
 * Shopify variant — go straight on sale, so the receiver reads what's about
 * to upload and types each quantity again before "Upload" unlocks.
 *
 * Rendered INSIDE the receive dialog's card (the dialog is modal, so a portal
 * outside it wouldn't take taps): covers the card, X / "Back" close it, and
 * it scrolls inside if there are several items.
 */
import { useState } from "react";
import { Loader2, ShoppingBag, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SHOPIFY_UPLOAD_CONFIRM, SHOPIFY_UPLOAD_WARNING, shopifyQuantityConfirmed, type ShopifyUpload,
} from "@workspace/goods-in";

export function ShopifyUploadConfirm({ uploads, saving, onConfirm, onClose }: {
  uploads: ShopifyUpload[];
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState<Record<number, string>>({});
  const allMatch = uploads.every(u => shopifyQuantityConfirmed(typed[u.lineId] ?? "", u.units));

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

          {uploads.map(u => {
            const value = typed[u.lineId] ?? "";
            const ok = shopifyQuantityConfirmed(value, u.units);
            const wrong = value.trim() !== "" && !ok;
            return (
              <div key={u.lineId} className="rounded-2xl border-2 border-border p-4 space-y-3">
                <div>
                  <p className="text-xl font-bold leading-tight">{u.product}</p>
                  <p className="text-base text-muted-foreground mt-1">
                    {u.units > 0
                      ? <>Adds <span className="font-bold text-foreground tabular-nums">{u.units}</span> to Shopify</>
                      : <>Takes <span className="font-bold text-foreground tabular-nums">{Math.abs(u.units)}</span> off Shopify</>}
                    {u.name !== u.product && <> · received as {u.name}</>}
                  </p>
                </div>
                <label className="block">
                  <span className="text-sm font-semibold">Type the quantity again</span>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    value={value}
                    onChange={e => setTyped(t => ({ ...t, [u.lineId]: e.target.value }))}
                    className={cn(
                      "mt-1 w-full h-14 rounded-xl border-2 bg-card px-4 text-2xl font-bold tabular-nums outline-none",
                      ok ? "border-emerald-500" : wrong ? "border-red-500" : "border-border focus:border-primary",
                    )}
                  />
                  {wrong && <span className="block mt-1 text-sm text-red-600">That doesn't match — count them again.</span>}
                </label>
              </div>
            );
          })}
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
            disabled={!allMatch || saving}
            className="sm:col-span-2 min-h-[56px] px-3 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:bg-primary/90 inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : <><Upload className="w-5 h-5 shrink-0" /> {SHOPIFY_UPLOAD_CONFIRM}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
