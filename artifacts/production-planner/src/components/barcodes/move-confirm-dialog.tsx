/**
 * "This barcode belongs to <old product>. Move it to <new product>?" — and,
 * when a CURRENT product would be left with no barcode, a second explicit
 * confirmation naming both (Graeme, 2026-10-10: TCK reuses retired
 * products' GS1 numbers, but must never strand a product it still sells).
 */
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface PendingMove {
  code: string;
  confirm: "move" | "take";
  reason: string;
  holders: string[];
  target: string;
  /** Set when the code came from "Use Shopify's" on this variant. */
  useShopifyVariant?: string;
}

export function MoveConfirmDialog({ pending, busy, onConfirm, onCancel }: {
  pending: PendingMove | null;
  busy: boolean;
  onConfirm: (p: PendingMove) => void;
  onCancel: () => void;
}) {
  const take = pending?.confirm === "take";
  return (
    <Dialog open={!!pending} onOpenChange={o => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {take ? <AlertTriangle className="w-6 h-6 text-destructive" /> : <ArrowRightLeft className="w-6 h-6 text-primary" />}
            {take ? "Take this barcode from a product you still sell?" : "Move this barcode?"}
          </DialogTitle>
          <DialogDescription className="text-base text-foreground pt-2">{pending?.reason}</DialogDescription>
        </DialogHeader>
        {pending && (
          <div className="rounded-xl border-2 border-border bg-muted/40 p-4 space-y-1 text-sm">
            <p><span className="text-muted-foreground">Barcode:</span> <span className="font-mono font-bold">{pending.code}</span></p>
            <p><span className="text-muted-foreground">From:</span> <b>{pending.holders.join(", ")}</b></p>
            <p><span className="text-muted-foreground">To:</span> <b>{pending.target}</b></p>
            {take && <p className="text-destructive font-semibold pt-1">{pending.holders.join(" and ")} will have NO barcode and can't be scanned on the packing screen until it gets one.</p>}
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="h-12 px-5 rounded-xl border-2 border-border font-semibold">Cancel — keep it where it is</button>
          <button
            type="button"
            disabled={busy || !pending}
            onClick={() => pending && onConfirm(pending)}
            className={cn("h-12 px-5 rounded-xl font-bold text-white disabled:opacity-50", take ? "bg-destructive" : "bg-primary")}
          >
            {busy ? "Moving…" : take ? `Yes — move it to ${pending?.target}` : "Move it"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
