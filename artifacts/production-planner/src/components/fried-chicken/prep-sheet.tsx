/**
 * The chicken prep sheet — what to pull, defrost and have standing by.
 *
 * Chicken prep happens the day BEFORE the run, so this sheet is read on one
 * day about another. It always names the run it belongs to, because "today's
 * prep" and "today's production" are different plans and mixing them up is
 * how a run ends up short of chicken.
 *
 * Raw chicken leads because it is the thing that has to come out of the
 * freezer in time. Oil is not an ingredient — it is what goes in the fryers,
 * most of it ending the day as waste — so it sits apart from the list.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Beef, ClipboardList, Droplets, Loader2, AlertTriangle } from "lucide-react";
import { useFriedChickenPrep } from "./api";
import { formatQuantity } from "./format";

function planDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function FriedChickenPrepSheet({ planId }: { planId: number }) {
  const { data, isLoading, error } = useFriedChickenPrep(planId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Working out the prep…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 text-base">
        Couldn't work out the prep: {(error as Error).message}
      </div>
    );
  }

  if (!data || data.packs === 0) {
    return (
      <div className="py-12 text-center space-y-2">
        <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
        <p className="text-xl font-bold">No fried chicken on this plan</p>
        <p className="text-base text-muted-foreground">Plan the run first, then the prep follows from it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-border bg-secondary/20 p-4">
        <p className="text-sm uppercase tracking-widest font-bold text-muted-foreground">Prep for</p>
        <p className="text-xl font-bold">{data.planName}</p>
        <p className="text-base text-muted-foreground">
          {planDateLabel(data.planDate)} — {data.packs} bags
        </p>
      </div>

      {/* The number that has to come out of the freezer in time. */}
      <div className="rounded-2xl border-2 border-orange-300 dark:border-orange-800 bg-orange-50/60 dark:bg-orange-950/20 p-5">
        <div className="flex items-center gap-3">
          <Beef className="w-8 h-8 text-orange-600 shrink-0" />
          <div>
            <p className="text-4xl font-bold tabular-nums leading-none">{data.rawMeatKg} kg</p>
            <p className="text-base font-medium text-muted-foreground mt-1">raw chicken to defrost</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border-2 border-border p-5">
        <div className="flex items-center gap-3">
          <Droplets className="w-8 h-8 text-muted-foreground shrink-0" />
          <div>
            <p className="text-4xl font-bold tabular-nums leading-none">{data.oilOnSiteKg} kg</p>
            <p className="text-base font-medium text-muted-foreground mt-1">
              oil on site to fry with ({data.oilKgPerKgChicken} kg a kilo)
            </p>
          </div>
        </div>
        {/* Said plainly because it has caused double-counting before: the oil
            that ends up in the food is already in the recipe below. */}
        <p className="text-sm text-muted-foreground mt-3">
          This is what goes in the fryers, not an ingredient — most of it ends the day as waste.
          Whatever oil is in the food is already in the list below.
        </p>
      </div>

      <div className="rounded-2xl border-2 border-border overflow-hidden">
        <p className="px-4 py-3 text-base font-bold border-b-2 border-border bg-secondary/20">
          Bags this prep is for
        </p>
        <div className="divide-y divide-border/60">
          {data.bags.map(b => (
            <div key={b.recipeName} className="flex items-center gap-3 px-4 py-3">
              <span className="text-lg flex-1 min-w-0">{b.recipeName}</span>
              <span className="text-2xl font-bold tabular-nums">{b.packs}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border-2 border-border overflow-hidden">
        <p className="px-4 py-3 text-base font-bold border-b-2 border-border bg-secondary/20">
          Everything the run needs
        </p>
        {data.ingredients.length === 0 ? (
          <div className="px-4 py-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-base">
              These recipes have no ingredients behind them yet, so there's nothing to pull.
              Check the recipes under Recipes.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {data.ingredients.map(i => (
              <div key={i.name} className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg flex-1 min-w-0">{i.name}</span>
                <span className="text-xl font-bold tabular-nums whitespace-nowrap">
                  {formatQuantity(i.qty, i.unit)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function FriedChickenPrepSheetDialog({ planId, open, onClose }: {
  planId: number;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ClipboardList className="w-6 h-6 text-orange-600" /> Chicken prep sheet
          </DialogTitle>
          <DialogDescription className="text-base">
            Pulled the day before the run.
          </DialogDescription>
        </DialogHeader>
        {open && <FriedChickenPrepSheet planId={planId} />}
      </DialogContent>
    </Dialog>
  );
}
