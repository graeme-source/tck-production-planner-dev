/**
 * One queued recipe: batches (saved as you type), what they make in packs
 * and units, and what Friday's sales suggest (Graeme, 30 Oct 2026).
 * Saving refreshes the ingredient list, so the quantities to order follow
 * the batch number before Create orders is pressed.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { RecipeSwatch, useRecipeColourLookup } from "@/components/recipe-swatch";
import { makesLabel, useSaveBatches, type QueueRow, type SalesLine } from "./api";

const SAVE_AFTER_MS = 600;

export function QueueRowItem({ row, sale, deliveryLabel, onRemove }: {
  row: QueueRow;
  /** Sales for the delivery (undefined = none sold / still loading). */
  sale: SalesLine | undefined;
  deliveryLabel: string | null;
  onRemove: () => void;
}) {
  const colourStyle = useRecipeColourLookup();
  const save = useSaveBatches(row.productionDate);
  const [text, setText] = useState(String(row.batches));
  const [state, setState] = useState<"idle" | "pending" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planned = row.status === "planned";

  // A save elsewhere (or the server) changed it — show the stored number.
  useEffect(() => { if (state !== "pending") setText(String(row.batches)); }, [row.batches]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const batches = Math.max(0, parseInt(text) || 0);
  const commit = (n: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (n < 1) return;
    if (n === row.batches) { setState(s => (s === "pending" ? "idle" : s)); return; }
    setState("pending");
    save.mutate({ id: row.id, batches: n }, {
      onSuccess: () => setState("saved"),
      onError: () => setState("error"),
    });
  };
  const change = (value: string) => {
    setText(value);
    const n = parseInt(value) || 0;
    if (timer.current) clearTimeout(timer.current);
    if (n >= 1 && n !== row.batches) {
      setState("pending");
      timer.current = setTimeout(() => commit(n), SAVE_AFTER_MS);
    }
  };

  return (
    <div className="rounded-xl border border-border p-3 space-y-1.5">
      <div className="flex items-center gap-3">
        <RecipeSwatch recipeId={row.recipeId} color={row.recipeColor} fallback="transparent" className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-border" />
        <span className="text-base font-semibold flex-1 min-w-0" style={row.recipeColor ? colourStyle(row.recipeId, row.recipeColor, "text") : undefined}>{row.recipeName}</span>
        <span className={cn("text-[11px] px-1.5 py-0.5 rounded font-medium flex-shrink-0",
          planned ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-violet-500/15 text-violet-700 dark:text-violet-400")}>
          {planned ? "on plan" : "queued"}
        </span>
        <input
          type="number" inputMode="numeric" min={1} value={text} disabled={planned}
          onChange={e => change(e.target.value)}
          onBlur={() => commit(batches)}
          aria-label={`Batches of ${row.recipeName}`}
          className="w-20 h-11 px-2 border border-border rounded-lg text-base text-center tabular-nums bg-background disabled:opacity-60 flex-shrink-0"
        />
        <span className="text-sm text-muted-foreground flex-shrink-0">batches</span>
        {!planned && (
          <button onClick={onRemove} className="p-2 text-muted-foreground hover:text-destructive transition-colors flex-shrink-0" title="Remove from queue" aria-label="Remove from queue">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-sm">
        <span className="font-medium tabular-nums">Makes {makesLabel(batches, row.portionsPerBatch, row.packSize)}</span>
        <span className="text-xs text-muted-foreground">({row.portionsPerBatch} a batch)</span>
        {state === "pending" && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving…</span>}
        {state === "saved" && <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> Saved</span>}
        {state === "error" && <span className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Not saved — try again</span>}
      </div>
      {sale && deliveryLabel && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-sm">
          <span className="text-muted-foreground"><span className="font-semibold text-foreground">{sale.packsSold}</span> sold for {deliveryLabel} → {sale.batches} batches</span>
          {!planned && sale.batches !== batches && (
            <button type="button" onClick={() => { setText(String(sale.batches)); commit(sale.batches); }}
              className="px-2.5 py-1 rounded-lg border border-primary text-primary text-xs font-semibold hover:bg-primary/10">
              Use {sale.batches}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
