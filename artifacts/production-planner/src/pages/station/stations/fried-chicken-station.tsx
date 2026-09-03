/**
 * The fried chicken station.
 *
 * Fried chicken runs separately from the calzone line, on its own days, off a
 * paper count sheet. This is that sheet (Graeme, 2026-09-03).
 *
 * The plan is a TARGET, not an instruction. The sauce runs out where it runs
 * out, so the team makes Korean first and lets the rest fall to buttermilk,
 * and what actually gets made is whatever the count sheet says. That number,
 * not the target, is what goes to Shopify at the end of the day — same shape
 * as the building station, where a target is set and the real count is
 * recorded against it.
 *
 * Korean sorts first because that is the order it is made in: the sauce is
 * made first thing and used until it is gone.
 *
 * Big cards throughout — this is read at arm's length by someone with wet
 * hands, standing at a fryer.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProductionPlanDetail } from "@workspace/api-client-react";
import { getGetProductionPlanQueryKey } from "@workspace/api-client-react";
import { Drumstick, Loader2, Minus, Plus, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { isFriedChicken, type StationPlanItem } from "../shared/constants";

const STATION = "fried_chicken";

/** Korean is made first — the sauce is made first thing and used until gone,
 *  and whatever is left over becomes buttermilk. The sheet is read in that
 *  order, so the screen is too. */
function productionOrder(a: StationPlanItem, b: StationPlanItem): number {
  const rank = (n: string) => (/korean|yangnyeom/i.test(n) ? 0 : 1);
  const ra = rank(a.recipeName ?? ""), rb = rank(b.recipeName ?? "");
  if (ra !== rb) return ra - rb;
  // Smaller bags first within a flavour: they're the bulk of the run.
  return (a.recipeName ?? "").localeCompare(b.recipeName ?? "");
}

function BagRow({ item, planId, disabled }: {
  item: StationPlanItem; planId: number; disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const target = Number(item.batchesTarget) || 0;
  const made = Number(item.batchesComplete) || 0;
  const short = made < target;
  const over = made > target;

  async function change(by: 1 | -1) {
    if (busy || disabled) return;
    if (by === -1 && made === 0) return;
    setBusy(true);
    try {
      const url = by === 1
        ? `/api/production-plans/${planId}/batch-completions`
        : `/api/production-plans/${planId}/batch-completions/last`;
      const res = await fetch(url, {
        method: by === 1 ? "POST" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          by === 1
            ? { planItemId: item.id, stationType: STATION, partialPacks: 1, completedAt: new Date().toISOString() }
            : { planItemId: item.id, stationType: STATION },
        ),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't record that bag");
      }
      await queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(planId) });
    } catch (e) {
      toast({ title: "Not counted", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(
      "rounded-2xl border-2 bg-card p-4 space-y-3",
      over ? "border-emerald-400" : short ? "border-border" : "border-emerald-400",
    )}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-2xl font-bold leading-snug flex-1 min-w-0">{item.recipeName}</span>
        <span className="text-base text-muted-foreground">target {target}</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => change(-1)}
          disabled={disabled || busy || made === 0}
          aria-label={`One fewer ${item.recipeName}`}
          className="w-16 h-16 rounded-2xl border-2 border-border flex items-center justify-center hover:bg-secondary/50 disabled:opacity-40 transition-colors"
        >
          <Minus className="w-7 h-7" />
        </button>

        <div className="flex-1 text-center">
          <div className="text-5xl font-bold tabular-nums leading-none">{made}</div>
          <div className="text-base text-muted-foreground mt-1">
            {made === target ? "on target" : short ? `${target - made} to go` : `${made - target} over`}
          </div>
        </div>

        <button
          onClick={() => change(1)}
          disabled={disabled || busy}
          aria-label={`One more ${item.recipeName}`}
          className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 active:scale-95 disabled:opacity-40 transition-all"
        >
          {busy ? <Loader2 className="w-7 h-7 animate-spin" /> : <Plus className="w-7 h-7" />}
        </button>
      </div>
    </div>
  );
}

export function FriedChickenStation({ plan, isOnBreak = false }: {
  plan: ProductionPlanDetail; isOnBreak?: boolean;
}) {
  const items = useMemo(
    () => ((plan.items ?? []) as StationPlanItem[])
      .filter(it => isFriedChicken(it as { recipeCategory?: string | null }))
      .sort(productionOrder),
    [plan.items],
  );

  const target = items.reduce((n, it) => n + (Number(it.batchesTarget) || 0), 0);
  const made = items.reduce((n, it) => n + (Number(it.batchesComplete) || 0), 0);

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-3">
        <Drumstick className="w-14 h-14 mx-auto text-muted-foreground opacity-50" />
        <p className="text-2xl font-bold">No fried chicken on this plan</p>
        <p className="text-lg text-muted-foreground">
          Add it from the production plan, the same way mac cheese gets added.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-5">
      <div className="rounded-2xl border-2 border-border bg-card p-5">
        <p className="text-base uppercase tracking-widest font-bold text-muted-foreground">Counted so far</p>
        <p className="text-5xl font-bold tabular-nums mt-1">
          {made} <span className="text-2xl font-medium text-muted-foreground">of {target} bags</span>
        </p>
        <p className="text-base text-muted-foreground mt-2">
          The target is a guide. Count what you actually make — that's what goes to Shopify tonight.
        </p>
      </div>

      {/* Korean first: the sauce is made first thing and used until it's gone,
          and whatever chicken is left becomes buttermilk. */}
      <div className="space-y-3">
        {items.map(it => (
          <BagRow key={it.id} item={it} planId={plan.id} disabled={isOnBreak} />
        ))}
      </div>

      <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-base">
          Stock only reaches Shopify when you complete the closing check
          <span className="font-bold"> “Submit today's counted bags to Shopify stock”</span>.
          It sends the {made} counted above — not the target.
        </p>
      </div>

      {made > 0 && made === target && (
        <div className="rounded-2xl bg-emerald-500/10 p-5 text-center">
          <Check className="w-9 h-9 mx-auto text-emerald-500 mb-2" />
          <p className="text-xl font-bold">Every bag on target</p>
        </div>
      )}
    </div>
  );
}
