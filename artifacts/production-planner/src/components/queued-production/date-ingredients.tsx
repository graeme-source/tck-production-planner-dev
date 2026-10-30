/**
 * A queued day's order list (Graeme, 30 Oct 2026): just what to order, with
 * a box to put each on today's order; the rest stays on the list — and on
 * the Orders page — every day until it's ordered or ticked off. Ticks are
 * saved (queued_ingredient_marks), so leaving the page loses nothing.
 * Orders are placed for delivery the day before prep. What doesn't need
 * ordering, and what's done, fold away. Rules: server,
 * lib/queued-production-rules.ts.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, ChevronDown, ChevronUp, Loader2, ShoppingCart, Undo2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  OUTSTANDING_KEY, batchSaveKey, createOrders, ingredientsKey, isOutstanding, placeOrder,
  useBatchesSaving, useMarkIngredient, useQueueIngredients, type QueueIngredient,
} from "./api";

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const day = (iso: string) => format(parseISO(iso), "EEE d MMM");
const todayIso = () => format(new Date(), "yyyy-MM-dd");

function waitForSaves(qc: ReturnType<typeof useQueryClient>, date: string): Promise<void> {
  return new Promise(resolve => {
    const tick = () => (qc.isMutating({ mutationKey: batchSaveKey(date) }) > 0 ? setTimeout(tick, 100) : resolve());
    tick();
  });
}

export function DateIngredients({ date, onOrdersCreated }: { date: string; onOrdersCreated: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQueueIngredients(date);
  const saving = useBatchesSaving(date);
  const markIt = useMarkIngredient(date);
  const [placing, setPlacing] = useState(false);
  // Left out of today's order — still on the list tomorrow.
  const [leftOut, setLeftOut] = useState<Set<number>>(new Set());

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" /> Working out what to order…</div>;
  }
  const ingredients = data.ingredients;
  const toOrder = ingredients.filter(isOutstanding).sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.name.localeCompare(b.name));
  const done = ingredients.filter(i => i.mark != null);
  const notNeeded = ingredients.filter(i => i.mark == null && !isOutstanding(i));
  const today = toOrder.filter(i => !leftOut.has(i.ingredientId) && i.supplierId != null);
  // A background refresh never blocks ordering — create() re-reads first.
  const busy = placing || saving;

  const create = async () => {
    setPlacing(true);
    try {
      await waitForSaves(qc, date);
      await qc.refetchQueries({ queryKey: ingredientsKey(date) });
      const body = await createOrders(date, today.map(i => i.ingredientId));
      const deliverBy = data.deliverBy >= todayIso() ? data.deliverBy : null;
      const placed: string[] = [];
      for (const po of body.created) {
        try {
          const p = await placeOrder(po.poId, deliverBy);
          placed.push(`${po.supplierName}${p.expectedDeliveryDate ? ` — ${day(p.expectedDeliveryDate)}` : ""}`);
        } catch {
          placed.push(`${po.supplierName} (draft — place it in Orders)`);
        }
      }
      toast({ title: `Ordered from ${placed.length} supplier${placed.length === 1 ? "" : "s"}`, description: placed.join("; ") });
      qc.invalidateQueries({ queryKey: ingredientsKey(date) });
      qc.invalidateQueries({ queryKey: OUTSTANDING_KEY });
      onOrdersCreated();
    } catch (err) {
      toast({ title: "Couldn't create orders", description: err instanceof Error ? err.message : "Try again", variant: "destructive" });
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-base font-semibold">To order <span className="text-muted-foreground font-normal">· delivered by {day(data.deliverBy)}</span></h3>
        {isFetching && !placing && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> updating</span>}
      </div>

      {toOrder.length === 0 ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5"><Check className="w-4 h-4" /> Nothing left to order.</p>
      ) : (
        <div className="space-y-1.5">
          {toOrder.map(i => (
            <OrderLine key={i.ingredientId} i={i} included={!leftOut.has(i.ingredientId)}
              onInclude={v => setLeftOut(prev => { const n = new Set(prev); if (v) n.delete(i.ingredientId); else n.add(i.ingredientId); return n; })}
              onMark={mark => markIt.mutate({ ingredientId: i.ingredientId, mark })} />
          ))}
        </div>
      )}

      {today.length > 0 && (
        <button onClick={() => void create()} disabled={busy}
          className="min-h-12 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
          {saving ? "Saving batches…" : `Order ${today.length} now`}
        </button>
      )}

      <Fold title={`Ordered or not needed (${done.length})`} hidden={done.length === 0}>
        {done.map(i => (
          <div key={i.ingredientId} className="flex items-center justify-between gap-3 text-sm py-1">
            <span>{i.name} <span className="text-muted-foreground">· {i.mark === "ordered" ? "ordered" : "not needed"}{i.markedBy ? ` by ${i.markedBy.split(" ")[0]}` : ""}{i.markedAt ? ` ${day(i.markedAt.slice(0, 10))}` : ""}</span></span>
            <button onClick={() => markIt.mutate({ ingredientId: i.ingredientId, mark: null })} className="px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          </div>
        ))}
      </Fold>

      <Fold title={`Doesn't need ordering (${notNeeded.length})`} hidden={notNeeded.length === 0}>
        {notNeeded.map(i => (
          <div key={i.ingredientId} className="flex items-center justify-between gap-3 text-sm text-muted-foreground py-0.5">
            <span>{i.name}</span>
            <span className="tabular-nums">{fmt(i.required)} {i.unit}</span>
          </div>
        ))}
      </Fold>
    </div>
  );
}

function OrderLine({ i, included, onInclude, onMark }: {
  i: QueueIngredient; included: boolean; onInclude: (v: boolean) => void; onMark: (m: "ordered" | "not_needed") => void;
}) {
  const late = i.orderBy < todayIso();
  const noSupplier = i.supplierId == null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
      <input type="checkbox" className="w-5 h-5 rounded border-border flex-shrink-0" checked={included && !noSupplier} disabled={noSupplier}
        onChange={e => onInclude(e.target.checked)} aria-label={`Put ${i.name} on today's order`} />
      <span className="flex-1 min-w-0">
        <span className="block text-base font-medium">{i.name}</span>
        <span className="block text-xs text-muted-foreground">
          {noSupplier ? <span className="text-red-600 dark:text-red-400">no supplier</span> : i.supplierName}
          {" · "}<span className={cn(late && "text-red-600 dark:text-red-400 font-semibold")}>order by {day(i.orderBy)}</span>
        </span>
      </span>
      <span className="text-base font-semibold tabular-nums flex-shrink-0">{fmt(i.remainingToOrder)} {i.unit}</span>
      <button onClick={() => onMark("ordered")} title="Already ordered" aria-label={`${i.name} already ordered`}
        className="h-10 px-2.5 rounded-lg border border-border text-xs font-semibold flex items-center gap-1 hover:bg-secondary flex-shrink-0">
        <Check className="w-4 h-4" /> Ordered
      </button>
      <button onClick={() => onMark("not_needed")} title="Not needed" aria-label={`${i.name} not needed`}
        className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary flex-shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function Fold({ title, hidden, children }: { title: string; hidden: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} {title}
      </button>
      {open && <div className="mt-1 pl-5">{children}</div>}
    </div>
  );
}
