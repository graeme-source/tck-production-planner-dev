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
import { Drumstick, Loader2, Minus, Plus, Check, AlertTriangle, ClipboardList, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { isFriedChicken, type StationPlanItem } from "../shared/constants";
import { useAuth } from "@/contexts/auth-context";
import { FriedChickenPrepSheet } from "@/components/fried-chicken/prep-sheet";
import { FriedChickenSubmitStock } from "@/components/fried-chicken/submit-stock";
import { AddFriedChickenDialog } from "@/components/fried-chicken/add-fried-chicken-dialog";
import { useNextFriedChickenRun, friedChickenFetch } from "@/components/fried-chicken/api";

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
      // The station's own counter, not the calzone line's. A bag off the
      // fryer is made; a calzone isn't made until it's wrapped, which is the
      // rule /production-plans/:id/batch-completions enforces.
      await friedChickenFetch(`/plans/${planId}/count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planItemId: item.id, delta: by }),
      });
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

function runDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** Plan this day's run, from the station.
 *
 *  The station is where somebody stands when they wonder about fried chicken,
 *  so it is where the run gets planned. Telling them to go and find a button
 *  on another screen was a dead end (Graeme, 2026-09-04) — he was standing
 *  here asking exactly this and the screen sent him away. */
function PlanTheRunButton({ plan, label }: { plan: ProductionPlanDetail; label: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { state } = useAuth();
  const role = state.status === "authenticated" ? state.user.role : undefined;
  if (role !== "admin" && role !== "manager") return null;

  const existing = (plan.items ?? [])
    .filter(it => isFriedChicken(it as { recipeCategory?: string | null }))
    .map(it => ({
      recipeId: it.recipeId,
      packs: it.batchesTarget ?? 0,
      made: it.batchesComplete ?? 0,
    }));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2.5 px-6 py-4 rounded-2xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
      >
        <Plus className="w-6 h-6" />
        {label}
      </button>
      <AddFriedChickenDialog
        planId={plan.id}
        open={open}
        onClose={() => setOpen(false)}
        existing={existing}
        // Without this the count sheet keeps showing the empty state until
        // the plan's own poll comes round — you'd save a run and appear to
        // have done nothing.
        onSaved={() => queryClient.invalidateQueries({ queryKey: getGetProductionPlanQueryKey(plan.id) })}
      />
    </>
  );
}

/** What this station shows when there is no chicken to fry today.
 *
 *  Prep runs the day BEFORE the run, so an empty station is usually not an
 *  empty day — it is a prep day. Rather than a dead end, it points at the
 *  next run and shows its pull list. Either way there is a way to plan this
 *  day's run without leaving the station. */
function NoRunToday({ plan }: { plan: ProductionPlanDetail }) {
  const { data, isLoading } = useNextFriedChickenRun(plan.planDate);

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Looking for the next run…
      </div>
    );
  }

  if (!data?.found) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-4">
        <Drumstick className="w-14 h-14 mx-auto text-muted-foreground opacity-50" />
        <p className="text-2xl font-bold">No fried chicken planned</p>
        <p className="text-lg text-muted-foreground">
          Say how many kilos of raw chicken the run is and it'll work out the bags.
        </p>
        <PlanTheRunButton plan={plan} label="Plan this day's run" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-5">
      <div className="rounded-2xl border-2 border-border bg-card p-5 flex items-start gap-4 flex-wrap">
        <CalendarDays className="w-8 h-8 text-orange-600 shrink-0" />
        <div className="flex-1 min-w-[16rem]">
          <p className="text-2xl font-bold">
            {data.isPrepDay ? "Today is prep day" : "Nothing to fry today"}
          </p>
          <p className="text-lg text-muted-foreground mt-1">
            The next run is {runDateLabel(data.planDate)} — {data.packs} bags.
            {data.isPrepDay ? " Here's what to pull for it." : ""}
          </p>
        </div>
        {/* A run is still plannable for TODAY even though another one is
            coming — chicken days move. */}
        <PlanTheRunButton plan={plan} label="Plan a run for today" />
      </div>
      <FriedChickenPrepSheet planId={data.planId} />
    </div>
  );
}

type StationTab = "count" | "prep";

export function FriedChickenStation({ plan, isOnBreak = false }: {
  plan: ProductionPlanDetail; isOnBreak?: boolean;
}) {
  const [tab, setTab] = useState<StationTab>("count");

  const items = useMemo(
    () => ((plan.items ?? []) as StationPlanItem[])
      .filter(it => isFriedChicken(it as { recipeCategory?: string | null }))
      .sort(productionOrder),
    [plan.items],
  );

  const target = items.reduce((n, it) => n + (Number(it.batchesTarget) || 0), 0);
  const made = items.reduce((n, it) => n + (Number(it.batchesComplete) || 0), 0);

  if (items.length === 0) return <NoRunToday plan={plan} />;

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-5">
      {/* Count and prep are both read at this station: the count sheet on the
          run day, the pull list the day before. Same screen, two tabs, so
          nobody has to know which plan holds which. */}
      <div className="flex items-center gap-1 p-1 bg-secondary/40 rounded-2xl w-fit">
        {([["count", "Count sheet", Drumstick], ["prep", "Prep", ClipboardList]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-semibold transition-colors",
              tab === key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "prep" ? (
        <FriedChickenPrepSheet planId={plan.id} />
      ) : (
        <>
          <div className="rounded-2xl border-2 border-border bg-card p-5 flex items-start gap-4 flex-wrap">
            <div className="flex-1 min-w-[16rem]">
              <p className="text-base uppercase tracking-widest font-bold text-muted-foreground">Counted so far</p>
              <p className="text-5xl font-bold tabular-nums mt-1">
                {made} <span className="text-2xl font-medium text-muted-foreground">of {target} bags</span>
              </p>
              <p className="text-base text-muted-foreground mt-2">
                The target is a guide. Count what you actually make — that's what goes to Shopify tonight.
              </p>
            </div>
            {/* Changing the run mid-morning is normal — a sauce is out, or an
                order lands. It shouldn't mean going back to the plan page. */}
            <PlanTheRunButton plan={plan} label="Change the run" />
          </div>

          {/* Korean first: the sauce is made first thing and used until it's gone,
              and whatever chicken is left becomes buttermilk. */}
          <div className="space-y-3">
            {items.map(it => (
              <BagRow key={it.id} item={it} planId={plan.id} disabled={isOnBreak} />
            ))}
          </div>

          {made > 0 && made === target && (
            <div className="rounded-2xl bg-emerald-500/10 p-5 text-center">
              <Check className="w-9 h-9 mx-auto text-emerald-500 mb-2" />
              <p className="text-xl font-bold">Every bag on target</p>
            </div>
          )}

          <div className="pt-2 space-y-3">
            <div className="rounded-2xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-base">
                Stock moves on the count, not the target. Sending puts the
                <span className="font-bold"> {made} </span>
                counted above onto the shelf — then tick the closing check
                <span className="font-bold"> “Submit today's counted bags to Shopify stock”</span>.
              </p>
            </div>
            <FriedChickenSubmitStock planId={plan.id} countedBags={made} />
          </div>
        </>
      )}
    </div>
  );
}
