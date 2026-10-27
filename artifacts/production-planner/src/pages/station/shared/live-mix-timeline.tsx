/**
 * The Mixing prep person's screen, made dead simple (Graeme, 2026-10-27:
 * "the primary objective of making it as easy to understand and use in the
 * frontend as possible"):
 *
 *   NEXT UP   one huge card — the very next thing to do and when:
 *             "Put BEEF MINCE in the oven at 08:15 · in 12 min", turning into
 *             "Put it in now" when due and red when late, with the one-tap
 *             "All N trays in now" button.
 *   THE DAY   one line per recipe in the order the builders will build them:
 *             when the builders need it, and for hot meat "in at / out at";
 *             cold and veg mixes "mix any time before"; done ones ticked and
 *             greyed; the flavour being built shows its batches left. A small
 *             "moved 10 min earlier — builders are ahead" note only on rows
 *             whose time moved.
 *
 * No jargon here (no "buffer", "lead"): the details live on the managers'
 * card. Times: @workspace/production-schedule live-replan.ts + next-action.ts.
 */
import { Beef, CheckCircle2, Flame, Snowflake, Clock, AlertTriangle } from "lucide-react";
import { formatClock, countdownText, type LiveRecipe, type LiveMeat, type NextAction, type TrustSignal } from "@workspace/production-schedule";
import { cn } from "@/lib/utils";
import type { LiveScheduleData } from "@/hooks/use-live-schedule";

/** "✓ reliable" — only once the times have been right day after day. */
export function ReliableChip({ trust }: { trust: TrustSignal | undefined }) {
  if (!trust?.trusted) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 whitespace-nowrap">
      <CheckCircle2 className="w-4 h-4" /> reliable
    </span>
  );
}

/** "moved 10 min earlier — builders are ahead"; empty within a few minutes. */
export function movedNote(r: Pick<LiveRecipe, "drift" | "driftMinutes">): string {
  if (r.drift === "on_time") return "";
  const m = Math.abs(Math.round(r.driftMinutes));
  return r.drift === "ahead" ? `moved ${m} min earlier — builders are ahead` : `moved ${m} min later — builders are behind`;
}

/** One hot meat: "Beef Mince in at 08:15 · out at 08:45". */
export function MeatInOutLine({ m, trust, large = false }: { m: LiveMeat; trust?: TrustSignal; large?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", large ? "text-lg" : "text-base")}>
      <Beef className="w-5 h-5 text-rose-500 flex-shrink-0" />
      <span className="font-semibold">{m.rawMeatName}</span>
      {m.started ? (
        <span className="inline-flex items-center gap-1 font-semibold text-orange-600 dark:text-orange-400">
          {/* No planned "out at" once it's in: the trays and the probe say when it's cooked. */}
          <Flame className="w-4 h-4" /> in the oven
        </span>
      ) : (
        <span className={cn("tabular-nums", m.overdue && "text-rose-600 dark:text-rose-400 font-semibold")}>
          in at <b>{formatClock(m.liveCookStartMinutes)}</b>
          {m.outMinutes != null && <> · out at <b>{formatClock(m.outMinutes)}</b></>}
        </span>
      )}
      <ReliableChip trust={trust} />
    </div>
  );
}

export function NextUpCard({ action, traysLeft, onPutAllIn, onOpenTrays, busy }: {
  action: NextAction | null;
  /** Trays of this meat not yet in the oven (null = not known). */
  traysLeft: number | null;
  onPutAllIn: () => void;
  onOpenTrays: () => void;
  busy: boolean;
}) {
  if (!action) {
    return (
      <section className="rounded-2xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-5">
        <p className="text-2xl font-bold flex items-center gap-2"><CheckCircle2 className="w-7 h-7 text-emerald-600" /> Nothing left to put in or mix</p>
      </section>
    );
  }
  const late = action.status === "overdue";
  const due = action.status === "due";
  const tone = late
    ? "border-rose-500 bg-rose-50 dark:bg-rose-900/25"
    : due ? "border-orange-500 bg-orange-50 dark:bg-orange-900/25" : "border-primary/40 bg-card";
  return (
    <section className={cn("rounded-2xl border-4 p-5 space-y-3", tone)} aria-live="polite">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Next up</p>
      {action.kind === "put_in" ? (
        <>
          <p className="text-3xl md:text-4xl font-extrabold leading-tight">
            Put {action.ingredientName?.toUpperCase()} in the oven
            <span className="tabular-nums"> at {formatClock(action.atMinutes)}</span>
          </p>
          <p className={cn("text-2xl font-bold tabular-nums", late ? "text-rose-600 dark:text-rose-400" : due ? "text-orange-600 dark:text-orange-400" : "text-foreground")}>
            {late ? <><AlertTriangle className="inline w-6 h-6 -mt-1 mr-1" />{countdownText(action.minutesUntil)} — put it in now</> : due ? "Put it in now" : countdownText(action.minutesUntil)}
          </p>
          <p className="text-lg text-muted-foreground">
            For {action.recipeName}{action.outMinutes != null ? ` · out at ${formatClock(action.outMinutes)}` : ""}
          </p>
          {traysLeft != null && traysLeft > 0 ? (
            <button
              onClick={onPutAllIn}
              disabled={busy}
              className={cn(
                "w-full min-h-[72px] rounded-2xl text-2xl font-extrabold text-white disabled:opacity-50 active:scale-[0.99] transition",
                late ? "bg-rose-600 hover:bg-rose-700" : "bg-orange-500 hover:bg-orange-600",
              )}
            >
              All {traysLeft} tray{traysLeft === 1 ? "" : "s"} in now
            </button>
          ) : (
            <button onClick={onOpenTrays} className="w-full min-h-[64px] rounded-2xl border-2 border-border bg-background text-xl font-bold">
              Go to the trays
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-3xl md:text-4xl font-extrabold leading-tight">Mix {action.recipeName.toUpperCase()}</p>
          <p className={cn("text-2xl font-bold tabular-nums", late && "text-rose-600 dark:text-rose-400")}>
            {action.anyTimeBefore ? `any time before ${formatClock(action.atMinutes)}` : `builders need it ~${formatClock(action.atMinutes)}`}
            {!action.anyTimeBefore && <span className="text-muted-foreground font-semibold"> · {countdownText(action.minutesUntil)}</span>}
          </p>
        </>
      )}
    </section>
  );
}

export function DayTimeline({ live, mixedPlanItemIds }: { live: LiveScheduleData; mixedPlanItemIds: Set<number> }) {
  if (live.recipes.length === 0) return null;
  return (
    <section className="bg-card border border-border rounded-2xl p-4 space-y-1">
      <h2 className="text-xl font-bold flex items-center gap-2 pb-1"><Clock className="w-5 h-5 text-primary" /> Today, in build order</h2>
      <ol className="divide-y divide-border">
        {live.recipes.map(r => {
          const done = r.state === "done";
          const mixed = mixedPlanItemIds.has(r.planItemId);
          const note = r.state === "waiting" ? movedNote(r) : "";
          return (
            <li key={r.planItemId} className={cn("py-3 flex flex-col gap-1", done && "opacity-50")}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <p className={cn("text-xl font-bold flex items-center gap-2", done && "line-through")}>
                  {done && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                  {r.kind === "cold" && !done && <Snowflake className="w-5 h-5 text-sky-500" />}
                  {r.name}
                </p>
                <p className="text-lg tabular-nums">
                  {done ? "done"
                    : r.state === "building" ? <b className="text-blue-700 dark:text-blue-300">Building now</b>
                    : r.kind === "cold" ? <>{mixed ? "✓ mixed · " : ""}mix any time before <b>{formatClock(r.mixByMinutes)}</b></>
                    : <>builders need it <b>~{formatClock(r.liveStartMinutes)}</b></>}
                </p>
              </div>
              {r.state === "building" && (
                <p className="text-lg font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
                  {r.remaining} batch{r.remaining === 1 ? "" : "es"} left
                  {r.nextFlavour ? ` · next: ${r.nextFlavour.name} ~${formatClock(r.nextFlavour.atMinutes)}` : ""}
                </p>
              )}
              {!done && r.state !== "building" && r.kind === "hot" && r.meats.map(m => (
                <MeatInOutLine key={m.rawMeatIngredientId} m={m} trust={live.trust[m.rawMeatIngredientId]} />
              ))}
              {note && <p className={cn("text-sm font-medium", r.drift === "ahead" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{note}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
