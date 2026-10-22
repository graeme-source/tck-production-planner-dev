/**
 * "Split with another supplier" on an Orders line (fix-queue #248 + #328,
 * Jane Miles; Graeme approved 22 Oct 2026). Objective C.
 *
 * Pick the supplier (the ingredient's second supplier first), choose how
 * many packs go (half by default), see the day it lands on, confirm. The
 * split is saved on the server; today's supplier keeps the rest and the
 * moved part appears on the other supplier's order that day as a fixed
 * amount, cancellable until it's placed. Also: the "Splits waiting" panel.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Scissors, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { defaultSplitPacks, splitDateLabel, splitPacksProblem } from "@workspace/business-days";
import { packNoun } from "@workspace/units";
import { toast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** A saved split, as the API returns it (api lib/order-splits.ts SplitView). */
export type OrderSplit = {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  packs: number;
  fromSupplierId: number;
  fromSupplierName: string | null;
  fromPlanId: number | null;
  fromOrderDate: string;
  targetSupplierId: number;
  targetSupplierName: string | null;
  targetOrderDate: string;
  status: string;
  purchaseOrderId: number | null;
  /** "Split from Express Food Service, Mon" */
  label: string;
};

export const ORDER_SPLITS_KEY = ["order-splits", "pending"] as const;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error ? String(body.error) : fallback;
  } catch {
    return fallback;
  }
}

export function OrderSplitDialog({
  open,
  onClose,
  line,
  fromSupplier,
  planId,
  suppliers,
  secondarySupplierId,
  onSplit,
}: {
  open: boolean;
  onClose: () => void;
  line: { ingredientId: number; ingredientName: string; packs: number; unit: string };
  fromSupplier: { id: number; name: string };
  planId: number | null;
  suppliers: Array<{ id: number; name: string }>;
  /** The ingredient's other supplier — listed first and picked by default. */
  secondarySupplierId: number | null;
  onSplit: (split: OrderSplit) => void;
}) {
  const queryClient = useQueryClient();
  const options = useMemo(() => {
    const others = suppliers.filter(s => s.id !== fromSupplier.id).sort((a, b) => a.name.localeCompare(b.name));
    const second = others.find(s => s.id === secondarySupplierId);
    return second ? [second, ...others.filter(s => s.id !== second.id)] : others;
  }, [suppliers, fromSupplier.id, secondarySupplierId]);

  const [targetId, setTargetId] = useState<number | null>(null);
  const [packsText, setPacksText] = useState("");
  useEffect(() => {
    if (!open) return;
    setTargetId(options[0]?.id ?? null);
    setPacksText(String(defaultSplitPacks(line.packs)));
  }, [open, line.ingredientId, line.packs, options]);

  const packs = Number(packsText);
  const problem = packsText.trim() === "" ? "Enter how many packs go." : splitPacksProblem(packs, line.packs);

  const preview = useQuery<{ targetSupplierName: string; targetOrderDate: string | null }>({
    queryKey: ["order-splits", "preview", targetId],
    enabled: open && targetId != null,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/order-splits/preview?targetSupplierId=${targetId}`, { credentials: "include" });
      if (!res.ok) throw new Error(await readError(res, "Couldn't work out the order day"));
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/order-splits`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: line.ingredientId,
          packs,
          fromSupplierId: fromSupplier.id,
          fromPlanId: planId,
          targetSupplierId: targetId,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't save the split"));
      return (await res.json()) as OrderSplit;
    },
    onSuccess: split => {
      queryClient.invalidateQueries({ queryKey: ORDER_SPLITS_KEY });
      onSplit(split);
      toast({
        title: "Split saved",
        description: `${split.packs} ${packNoun(line.unit, split.packs)} will be on ${split.targetSupplierName}'s order on ${splitDateLabel(split.targetOrderDate)}.`,
      });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Split not saved", description: err.message, variant: "destructive" }),
  });

  const target = options.find(o => o.id === targetId) ?? null;
  const date = preview.data?.targetOrderDate ?? null;
  const keeps = Number.isFinite(packs) ? Math.max(0, line.packs - packs) : line.packs;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Scissors className="w-5 h-5" /> Split with another supplier
          </DialogTitle>
        </DialogHeader>

        <p className="text-base">
          <span className="font-semibold">{line.ingredientName}</span> — {line.packs} {packNoun(line.unit, line.packs)} on {fromSupplier.name}&apos;s order.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Split with</span>
          <select
            value={targetId ?? ""}
            onChange={e => setTargetId(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 w-full h-12 rounded-xl border border-border bg-background px-3 text-base"
          >
            {options.map(o => (
              <option key={o.id} value={o.id}>
                {o.name}{o.id === secondarySupplierId ? " (second supplier)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">How many go to {target?.name ?? "them"}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={line.packs}
            value={packsText}
            onChange={e => setPacksText(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            className="mt-1 w-full h-14 rounded-xl border border-border bg-background px-3 text-2xl font-bold tabular-nums"
          />
          <span className="block text-sm text-muted-foreground mt-1">
            {fromSupplier.name} keeps {keeps} {packNoun(line.unit, keeps)}.
          </span>
        </label>

        <div className="rounded-xl bg-secondary/40 px-4 py-3 text-base min-h-[3.5rem]">
          {targetId == null ? "Pick a supplier." :
            preview.isLoading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Working out the day…</span> :
            preview.isError ? <span className="text-destructive">{(preview.error as Error).message}</span> :
            date ? <>This will appear on <b>{target?.name}</b>&apos;s order on <b>{splitDateLabel(date)}</b>, marked &ldquo;Split from {fromSupplier.name}&rdquo;. You can cancel it until that order is placed.</> :
            <span className="text-destructive">{target?.name} has no order day in the next three weeks — check its order days on the supplier record.</span>}
        </div>

        {problem && packsText.trim() !== "" && <p className="text-sm text-destructive">{problem}</p>}

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" onClick={onClose} className="h-12 px-5 rounded-xl border border-border text-base font-medium">
            Cancel
          </button>
          <button
            type="button"
            disabled={!!problem || !date || save.isPending}
            onClick={() => save.mutate()}
            className="h-12 px-5 rounded-xl bg-primary text-primary-foreground text-base font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {save.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Split {Number.isFinite(packs) && packs > 0 ? packs : ""} to {target?.name ?? "supplier"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pending splits, soonest first — the "Splits waiting" panel on Orders. */
export function useOrderSplits() {
  return useQuery<OrderSplit[]>({
    queryKey: ORDER_SPLITS_KEY,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/order-splits?status=pending`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load splits");
      return res.json();
    },
  });
}

export function useCancelOrderSplit(onDone?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/order-splits/${id}/cancel`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't cancel the split"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDER_SPLITS_KEY });
      onDone?.();
      toast({ title: "Split cancelled" });
    },
    onError: (err: Error) => toast({ title: "Split not cancelled", description: err.message, variant: "destructive" }),
  });
}

/** Big-card list of splits still waiting for their order day. */
export function OrderSplitsWaiting({ onChanged }: { onChanged?: () => void }) {
  const { data: splits = [] } = useOrderSplits();
  const cancel = useCancelOrderSplit(onChanged);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  if (splits.length === 0) return null;
  return (
    <section className="rounded-2xl border-2 border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 p-4">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
        <Scissors className="w-5 h-5" /> Splits waiting for their order day
      </h2>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {splits.map(s => (
          <div key={s.id} className="rounded-xl bg-background border border-border p-4 flex flex-col gap-2">
            <div className="text-base font-semibold">{s.packs} × {s.ingredientName ?? `Ingredient #${s.ingredientId}`}</div>
            <div className="text-sm">
              On <b>{s.targetSupplierName}</b>&apos;s order, {splitDateLabel(s.targetOrderDate)}
            </div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
            {confirmId === s.id ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(s.id, { onSettled: () => setConfirmId(null) })}
                  className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground font-semibold inline-flex items-center justify-center gap-2"
                >
                  {cancel.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Yes, cancel it
                </button>
                <button type="button" onClick={() => setConfirmId(null)} className="h-11 px-4 rounded-xl border border-border">
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(s.id)}
                className="self-start h-11 px-4 rounded-xl border border-border text-sm font-medium inline-flex items-center gap-1.5 hover:bg-secondary"
              >
                <X className="w-4 h-4" /> Cancel split
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
