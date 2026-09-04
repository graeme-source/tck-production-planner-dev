/**
 * The chicken prep sheet — what to pull and have standing by. (Not
 * "defrost": the run is 75 kg of raw chicken however it arrives, and any
 * frozen stock was simply counted inside that figure — Graeme, 2026-09-04.)
 *
 * Chicken prep happens the day BEFORE the run, so this sheet is read on one
 * day about another. It always names the run it belongs to, because "today's
 * prep" and "today's production" are different plans and mixing them up is
 * how a run ends up short of chicken.
 *
 * Raw chicken leads because it is the biggest thing to have standing by.
 * Oil is not an ingredient — it is what goes in the fryers,
 * most of it ending the day as waste — so it sits apart from the list.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Beef, ClipboardList, Droplets, Loader2, AlertTriangle, Check, ChevronDown, ChevronRight, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  useFriedChickenPrep, useNextFriedChickenRun, setFriedChickenPrepTick,
  type PrepSection, type PrepItem,
} from "./api";
import { prepDayView } from "./prep-day";
import { formatQuantity } from "./format";
import { ArrowRight, CalendarDays } from "lucide-react";

function planDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** One line of a step. A mix that is made in bulk carries its own breakdown,
 *  folded away until someone actually needs to make more of it. */
function PrepLine({ item }: { item: PrepItem }) {
  const [open, setOpen] = useState(false);
  const hasChildren = (item.children?.length ?? 0) > 0;

  return (
    <div>
      <button
        type="button"
        disabled={!hasChildren}
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 text-left",
          hasChildren && "hover:bg-secondary/40",
        )}
      >
        {hasChildren
          ? (open ? <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />)
          : <span className="w-5 shrink-0" />}
        <span className="text-lg flex-1 min-w-0">{item.name}</span>
        <span className="text-xl font-bold tabular-nums whitespace-nowrap">
          {formatQuantity(item.qty, item.unit)}
        </span>
      </button>
      {hasChildren && open && (
        <div className="pl-12 pr-4 pb-3 space-y-1.5">
          <p className="text-sm text-muted-foreground">
            What's in it — mixed in bulk and drawn down on, so you only need this when making more.
          </p>
          {item.children!.map(c => (
            <div key={c.name} className="flex items-center gap-3 text-base">
              <span className="flex-1 min-w-0 text-muted-foreground">{c.name}</span>
              <span className="tabular-nums font-medium">{formatQuantity(c.qty, c.unit)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A step of the job: tick it when it's done, and it drops out of the way. */
function PrepStepCard({ section, planId }: { section: PrepSection; planId: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(!section.done);

  const tick = useMutation({
    mutationFn: (done: boolean) => setFriedChickenPrepTick(planId, section.key, done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fried-chicken", "prep", planId] }),
    onError: (err: Error) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  return (
    <div className={cn(
      "rounded-2xl border-2 overflow-hidden transition-colors",
      section.done ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/10" : "border-border",
    )}>
      <div className="flex items-stretch">
        {/* The tick is its own big target — wet hands, arm's length. */}
        <button
          type="button"
          onClick={() => tick.mutate(!section.done)}
          disabled={tick.isPending}
          aria-label={section.done ? `Mark ${section.title} not done` : `Mark ${section.title} done`}
          className={cn(
            "w-20 shrink-0 flex items-center justify-center border-r-2 transition-colors disabled:opacity-50",
            section.done
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "border-border hover:bg-secondary/60",
          )}
        >
          {tick.isPending
            ? <Loader2 className="w-7 h-7 animate-spin" />
            : <Check className={cn("w-8 h-8", !section.done && "text-muted-foreground/40")} />}
        </button>

        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex-1 min-w-0 flex items-center gap-3 px-4 py-4 text-left hover:bg-secondary/30"
        >
          <div className="flex-1 min-w-0">
            <p className={cn("text-xl font-bold", section.done && "line-through text-muted-foreground")}>
              {section.title}
            </p>
            <p className="text-base text-muted-foreground">
              {section.items.length} {section.items.length === 1 ? "thing" : "things"} to weigh out
            </p>
          </div>
          <span className="text-3xl font-bold tabular-nums whitespace-nowrap">
            {formatQuantity(section.totalQty, section.unit)}
          </span>
          {open ? <ChevronDown className="w-6 h-6 text-muted-foreground shrink-0" />
                : <ChevronRight className="w-6 h-6 text-muted-foreground shrink-0" />}
        </button>
      </div>

      {open && (
        <div className="border-t-2 border-border/60 divide-y divide-border/60">
          {section.items.map(i => <PrepLine key={i.name} item={i} />)}
        </div>
      )}
    </div>
  );
}

export function FriedChickenPrepSheet({ planId }: { planId: number }) {
  const { data, isLoading, error } = useFriedChickenPrep(planId);
  // Hidden by default: a sheet that only shows what's still to do is the
  // whole point of ticking it off.
  const [showDone, setShowDone] = useState(false);

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

  const sections = data.sections ?? [];
  const doneCount = sections.filter(s => s.done).length;
  const visible = showDone ? sections : sections.filter(s => !s.done);

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
            <p className="text-base font-medium text-muted-foreground mt-1">raw chicken for the run</p>
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

      {sections.length === 0 ? (
        <div className="rounded-2xl border-2 border-border px-4 py-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-base">
            These recipes have no ingredients behind them yet, so there's nothing to pull.
            Check the recipes under Recipes.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-base uppercase tracking-widest font-bold text-muted-foreground flex-1">
              In the order it's done
            </p>
            <p className="text-base text-muted-foreground tabular-nums">
              {doneCount} of {sections.length} done
            </p>
          </div>

          {visible.map(s => <PrepStepCard key={s.key} section={s} planId={planId} />)}

          {/* Done steps get out of the way, the same as the reviews list —
              but never disappear, because "did we do the marinade?" is asked
              at four o'clock every single time. */}
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDone(v => !v)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-border text-base font-semibold text-muted-foreground hover:bg-secondary/40"
            >
              {showDone ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              {showDone
                ? `Hide the ${doneCount} done`
                : `Show ${doneCount} done`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function shortDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

/** The Prep tab. Prep lives on the PREP DAY's plan, not the run's (Graeme,
 *  2026-09-04) — same shape as the dough stations reading the next day's
 *  plan. On the prep day this renders the next run's pull list; on the run
 *  day it points back at the prep day rather than repeating the sheet; on
 *  any other day it says when prep happens. Creating a run needs no extra
 *  step to "create" its prep — the prep day finds the run by date. */
export function FriedChickenPrepDay({ planId, planDate }: { planId: number; planDate: string }) {
  const { data, isLoading } = useNextFriedChickenRun(planDate);
  const [, navigate] = useLocation();
  // The planner has no weekend plans — never has — so a Monday run's Sunday
  // prep often has no plan to live on. In that case the run day shows its
  // own sheet behind a button rather than a dead end (Graeme, 2026-09-04).
  // Arriving from the calendar's "Fried Chicken prep day" card skips the
  // button — that person came here FOR the sheet.
  const [showHere, setShowHere] = useState(
    () => new URLSearchParams(window.location.search).get("fcshow") === "1",
  );

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto flex items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Looking for the next run…
      </div>
    );
  }

  const view = prepDayView(planId, planDate, data);

  if (view.kind === "prep-day") {
    return (
      <div className="max-w-3xl mx-auto pb-24">
        <FriedChickenPrepSheet planId={view.runPlanId} />
      </div>
    );
  }

  if (view.kind === "none") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center space-y-2">
        <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground opacity-50" />
        <p className="text-xl font-bold">No upcoming fried chicken run</p>
        <p className="text-base text-muted-foreground">
          Plan one from the Production tab and its prep will appear on the day before.
        </p>
      </div>
    );
  }

  const isRunDay = view.kind === "run-day";
  return (
    <div className="max-w-3xl mx-auto pb-24">
      <div className="rounded-2xl border-2 border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-4">
          <CalendarDays className="w-8 h-8 text-orange-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold">
              {isRunDay ? "No prep today — it's the run day" : "No fried chicken prep today"}
            </p>
            <p className="text-lg text-muted-foreground mt-1">
              {isRunDay
                ? `This run was prepped on ${shortDayLabel(view.prepDate)}.`
                : `The next run is ${shortDayLabel(view.runDate)} (${view.packs} bags) — prep happens on ${shortDayLabel(view.prepDate)}.`}
            </p>
          </div>
        </div>
        {view.prepPlanId != null ? (
          <button
            type="button"
            onClick={() => navigate(`/plans/${view.prepPlanId}/station/fried_chicken?view=prep`)}
            className="flex items-center gap-2.5 px-6 py-4 rounded-2xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
          >
            {isRunDay ? "Go to this run's prep" : `Go to ${shortDayLabel(view.prepDate)}'s prep`}
            <ArrowRight className="w-5 h-5" />
          </button>
        ) : isRunDay && !showHere ? (
          <button
            type="button"
            onClick={() => setShowHere(true)}
            className="flex items-center gap-2.5 px-6 py-4 rounded-2xl bg-primary text-primary-foreground text-lg font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <ClipboardList className="w-5 h-5" />
            Show this run's prep
          </button>
        ) : !isRunDay ? (
          <p className="text-base text-muted-foreground">
            There's no plan on {shortDayLabel(view.prepDate)} yet — once one exists, its Prep
            tab will carry this pull list.
          </p>
        ) : null}
      </div>
      {isRunDay && showHere && view.prepPlanId == null && (
        <div className="mt-4">
          <FriedChickenPrepSheet planId={planId} />
        </div>
      )}
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
