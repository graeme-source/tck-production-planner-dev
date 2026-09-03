/**
 * Planning a fried chicken run.
 *
 * You tell it how many kilos of raw chicken the run is, and it tells you how
 * many bags of each variant to make — driven by what Shopify has on the shelf
 * and what has been selling, so a variant that has fallen behind gets the
 * chicken and one sitting on a month's cover gets none.
 *
 * The numbers are a suggestion, not an instruction. Every row is editable and
 * the totals follow, because the person planning knows things the maths does
 * not (a wholesale order, a sauce that is out of stock). Re-opening shows the
 * plan as it stands rather than a fresh suggestion over the top of it.
 *
 * Big cards, big numbers — this gets used on an iPad on the factory floor,
 * not at a desk.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Drumstick, Loader2, Minus, Plus, AlertTriangle, RotateCcw, Check, Droplets,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useFriedChickenSuggestion, saveFriedChickenItems } from "./api";
import { useFriedChickenSettings, settingNumber, FriedChickenRunSettings } from "./run-settings";
import {
  mergeSuggestionWithPlan, runTotals, daysCoverAfter,
  type PlanRow, type PlannedBag,
} from "./plan-rows";

/** How a day's cover reads at a glance. Thresholds are deliberately loose:
 *  this is a nudge, not a gate — the planner decides. */
function coverTone(days: number | null): string {
  if (days == null) return "text-muted-foreground";
  if (days < 7) return "text-destructive";
  if (days > 21) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function coverLabel(days: number | null): string {
  return days == null ? "no sales yet" : `${days} days`;
}

function BagCard({ row, windowDays, onChange, onReset }: {
  row: PlanRow;
  windowDays: number;
  onChange: (packs: number) => void;
  onReset: () => void;
}) {
  const after = daysCoverAfter(row, windowDays);
  const changed = row.planned !== row.suggested;
  const atFloor = row.planned <= row.made;

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-xl font-bold leading-snug flex-1 min-w-0">{row.name}</span>
        {row.kgPerPack > 0 ? (
          <span className="text-sm text-muted-foreground tabular-nums">{row.kgPerPack} kg a bag</span>
        ) : (
          <span className="text-sm font-semibold text-amber-600">no raw meat in the recipe</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(row.planned - 1)}
          disabled={atFloor}
          aria-label={`One fewer ${row.name}`}
          className="w-14 h-14 rounded-2xl border-2 border-border flex items-center justify-center hover:bg-secondary/50 disabled:opacity-40 transition-colors"
        >
          <Minus className="w-6 h-6" />
        </button>

        <div className="flex-1 text-center">
          <input
            type="number"
            min={row.made}
            value={row.planned}
            onChange={e => onChange(Number(e.target.value))}
            onFocus={e => e.currentTarget.select()}
            aria-label={`Bags of ${row.name}`}
            className="w-full text-4xl font-bold tabular-nums text-center bg-transparent border-0 focus:outline-none focus:ring-2 focus:ring-primary rounded-xl"
          />
          <p className="text-sm text-muted-foreground">bags</p>
        </div>

        <button
          type="button"
          onClick={() => onChange(row.planned + 1)}
          aria-label={`One more ${row.name}`}
          className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
        >
          <Plus className="w-6 h-6" />
        </button>
      </div>

      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap text-sm">
        <span className="text-muted-foreground">
          On the shelf <span className="font-semibold text-foreground tabular-nums">{row.stockPacks}</span>
        </span>
        <span className="text-muted-foreground">
          Sold <span className="font-semibold text-foreground tabular-nums">{row.soldLast30}</span> in {windowDays} days
        </span>
        <span className="text-muted-foreground">
          Cover <span className={cn("font-semibold tabular-nums", coverTone(row.daysCoverNow))}>{coverLabel(row.daysCoverNow)}</span>
          {" → "}
          <span className={cn("font-semibold tabular-nums", coverTone(after))}>{coverLabel(after)}</span>
        </span>
        {changed && (
          <button
            type="button"
            onClick={onReset}
            className="ml-auto flex items-center gap-1.5 text-primary font-medium hover:underline"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Back to {row.suggested}
          </button>
        )}
      </div>

      {row.made > 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
          {row.made} already fried and counted — this can't go below that.
        </p>
      )}
    </div>
  );
}

export function AddFriedChickenDialog({
  planId, open, onClose, existing, onSaved,
}: {
  planId: number;
  open: boolean;
  onClose: () => void;
  /** Fried chicken already on this plan, so re-opening edits rather than
   *  re-suggests. */
  existing: readonly PlannedBag[];
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: settings } = useFriedChickenSettings();
  const defaultKg = settingNumber(settings, "fried_chicken_default_raw_kg", 75);
  const oilPerKg = settingNumber(settings, "fried_chicken_oil_kg_per_kg", 0.457);
  const windowDays = settingNumber(settings, "fried_chicken_sales_window_days", 30);

  const [rawKgInput, setRawKgInput] = useState("");
  const rawKg = Number(rawKgInput) > 0 ? Number(rawKgInput) : defaultKg;
  const debouncedKg = useDebouncedValue(rawKg, 400);

  const { data: suggestion, isLoading, error, isFetching } =
    useFriedChickenSuggestion(debouncedKg, open);

  // Edits are held against the suggestion they were made on, so changing the
  // run size re-suggests (which is the point of changing it) without losing
  // the identity of what the planner touched by hand.
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [editBasis, setEditBasis] = useState<number | null>(null);
  if (editBasis !== null && editBasis !== debouncedKg) {
    setEditBasis(null);
    setEdits({});
  }

  const rows: PlanRow[] = useMemo(() => {
    const base = mergeSuggestionWithPlan(suggestion?.variants ?? [], existing);
    return base.map(r => {
      const edited = edits[r.recipeId];
      return edited === undefined ? r : { ...r, planned: Math.max(r.made, edited) };
    });
  }, [suggestion, existing, edits]);

  const totals = runTotals(rows, rawKg, oilPerKg);

  const setPacks = (recipeId: number, packs: number) => {
    const floor = rows.find(r => r.recipeId === recipeId)?.made ?? 0;
    const next = Number.isFinite(packs) ? Math.max(floor, Math.round(packs)) : floor;
    setEditBasis(debouncedKg);
    setEdits(prev => ({ ...prev, [recipeId]: next }));
  };

  const resetRow = (recipeId: number) => {
    setEdits(prev => {
      const next = { ...prev };
      delete next[recipeId];
      return next;
    });
  };

  const save = useMutation({
    mutationFn: () => saveFriedChickenItems(
      planId,
      rawKg,
      rows.map(r => ({ recipeId: r.recipeId, packs: Math.max(0, r.planned) })),
    ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["fried-chicken"] });
      const stuck = result.notRemoved?.length ?? 0;
      toast({
        title: `${totals.packs} bags on the plan`,
        description: stuck > 0
          ? `${stuck} line${stuck === 1 ? "" : "s"} stayed because bags have already been fried against ${stuck === 1 ? "it" : "them"}.`
          : `${totals.kgUsed} kg of chicken, ${totals.oilKg} kg of oil to have on site.`,
      });
      onSaved?.();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    },
  });

  const nothingToSave = rows.length === 0 || (totals.packs === 0 && existing.length === 0);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Drumstick className="w-6 h-6 text-orange-600" /> Fried chicken for this plan
          </DialogTitle>
          <DialogDescription className="text-base">
            Say how much raw chicken the run is. The bags follow from what's on the
            shelf and what's been selling — change any of them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* The one number that drives everything else. */}
          <div className="rounded-2xl border-2 border-border bg-secondary/20 p-4 flex items-end gap-4 flex-wrap">
            <div>
              <label htmlFor="fc-raw-kg" className="text-base font-semibold">Raw chicken</label>
              <div className="relative mt-1.5 w-40">
                <input
                  id="fc-raw-kg"
                  type="number"
                  min="0"
                  step="any"
                  value={rawKgInput}
                  placeholder={String(defaultKg)}
                  onChange={e => setRawKgInput(e.target.value)}
                  onFocus={e => e.currentTarget.select()}
                  className="w-full pl-4 pr-12 py-3 rounded-xl border-2 border-border bg-background text-2xl text-right tabular-nums font-bold"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground pointer-events-none">kg</span>
              </div>
            </div>
            <div className="flex-1 min-w-[12rem] space-y-1">
              <p className="text-3xl font-bold tabular-nums leading-none">
                {totals.packs} <span className="text-lg font-medium text-muted-foreground">bags</span>
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {totals.kgUsed} kg used
                {totals.kgOver > 0
                  ? <span className="font-semibold text-destructive"> · {totals.kgOver} kg over the run</span>
                  : totals.kgSpare > 0.05
                    ? <span> · {totals.kgSpare} kg spare</span>
                    : null}
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Droplets className="w-4 h-4" /> {totals.oilKg} kg of oil on site
              </p>
            </div>
            {isFetching && !isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-2" />}
          </div>

          {totals.kgOver > 0 && (
            <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-base">
                These bags need <span className="font-bold">{totals.kgUsed} kg</span> of chicken but the run
                is <span className="font-bold">{rawKg} kg</span>. Either raise the run or take bags off — the
                chicken was ordered against the run size.
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Working out the run…
            </div>
          ) : error ? (
            <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 text-base">
              Couldn't work out a suggestion: {(error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-lg text-muted-foreground">
              No recipes in the Fried Chicken category yet. Add them under Recipes first.
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map(row => (
                <BagCard
                  key={row.recipeId}
                  row={row}
                  windowDays={windowDays}
                  onChange={packs => setPacks(row.recipeId, packs)}
                  onReset={() => resetRow(row.recipeId)}
                />
              ))}
            </div>
          )}

          {/* Anything the maths couldn't see, said out loud. A recipe with no
              Shopify link has no stock and no sales behind it, so its share of
              the run is a guess. */}
          {(suggestion?.unmapped.length ?? 0) > 0 && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-base">
                No Shopify product linked to <span className="font-semibold">{suggestion!.unmapped.join(", ")}</span>,
                so there's no stock or sales behind {suggestion!.unmapped.length === 1 ? "its" : "their"} share of the run —
                and counted bags won't reach Shopify either. Link {suggestion!.unmapped.length === 1 ? "it" : "them"} under
                Recipes.
              </p>
            </div>
          )}
          {(suggestion?.noMeat.length ?? 0) > 0 && (
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-base">
                <span className="font-semibold">{suggestion!.noMeat.join(", ")}</span> resolves to no raw meat,
                so the run size can't price {suggestion!.noMeat.length === 1 ? "it" : "them"}. Check the recipe's
                ingredients are in the raw meat category.
              </p>
            </div>
          )}

          <FriedChickenRunSettings settings={settings} />

          {/* Stuck to the bottom of the dialog. With four variants and the
              settings open, the save button otherwise sits below the fold on
              an iPad and the run looks unsaveable. */}
          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-card border-t border-border flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-3 text-lg border-2 border-border rounded-xl hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || nothingToSave}
              className="px-6 py-3 text-lg bg-primary text-primary-foreground rounded-xl font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {save.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
              Put {totals.packs} bags on the plan
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
