/**
 * The Mixing station's live timeline (Graeme, 2026-10-27): every recipe the
 * builders still have to do, with the time they'll reach it and when its
 * meat must go in — re-planned every minute from batches built and the pace
 * the builders are actually going. "Godfather mix needed ~10:40 (was 10:55 —
 * builders are ahead)". Big cards, iPad-first, full width.
 *
 * Hot-meat recipes (a prep-oven raw meat in them — from data) get exact
 * times. Cold and veg mixes are made early and chilled, so they sit in one
 * "mix early — any time before HH:MM" block, never tight times.
 *
 * Display only. Times: @workspace/production-schedule live-replan.ts.
 */
import { Beef, CheckCircle2, AlertTriangle, Flame, Clock, Snowflake } from "lucide-react";
import { formatClock, type LiveRecipe, type LiveMeat, type TrustSignal } from "@workspace/production-schedule";
import { cn } from "@/lib/utils";
import type { LiveScheduleData } from "@/hooks/use-live-schedule";

/** "(was 10:55 — builders are ahead)" — empty when within a few minutes. */
export function driftNote(r: { drift: LiveRecipe["drift"]; plannedStartMinutes: number; liveStartMinutes: number }, wasMinutes = r.plannedStartMinutes): string {
  if (r.drift === "on_time") return "";
  return `was ${formatClock(wasMinutes)} — builders are ${r.drift === "ahead" ? "ahead" : "behind"}`;
}

export function TrustedChip({ trust }: { trust: TrustSignal | undefined }) {
  if (!trust?.trusted) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 whitespace-nowrap"
      title={`Ready on time and not too early on ${Math.round((trust.score ?? 0) * 100)}% of the last ${trust.days} days`}
    >
      <CheckCircle2 className="w-3.5 h-3.5" /> Trusted
    </span>
  );
}

export function MeatTimeLine({ m, trust, large = false }: { m: LiveMeat; trust?: TrustSignal; large?: boolean }) {
  const moved = Math.round(m.liveCookStartMinutes) !== Math.round(m.plannedCookStartMinutes);
  return (
    <div className="space-y-1">
      <div className={cn("flex items-center gap-2 flex-wrap", large ? "text-base" : "text-sm")}>
        <Beef className="w-4 h-4 text-rose-500 flex-shrink-0" />
        <span className="font-medium">{m.rawMeatName}</span>
        {m.started ? (
          <span className="inline-flex items-center gap-1 font-semibold text-orange-600 dark:text-orange-400">
            <Flame className="w-4 h-4" /> in the oven
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">in the oven by</span>
            <span className={cn("font-bold tabular-nums", m.overdue ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
              {formatClock(m.liveCookStartMinutes)}
            </span>
            {moved && <span className="text-xs text-muted-foreground tabular-nums">(was {formatClock(m.plannedCookStartMinutes)})</span>}
            {m.overdue && <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">put it in now</span>}
          </>
        )}
        <TrustedChip trust={trust} />
      </div>
      {m.holdBreach && m.holdMinutes != null && (
        <p className="text-sm text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Cooked meat would be out {Math.floor(m.holdMinutes / 60)}h {m.holdMinutes % 60}m before the last batch — over the limit.
            Cook in two waves{m.secondWaveNotBeforeMinutes != null ? `: second wave in the oven no earlier than ${formatClock(m.secondWaveNotBeforeMinutes)}` : ""}.
          </span>
        </p>
      )}
    </div>
  );
}

function paceLine(live: LiveScheduleData): string | null {
  if (!live.isToday || !live.started || !live.pace) return null;
  const pct = Math.round((live.pace.factor - 1) * 100);
  if (Math.abs(pct) < 3) return "Builders are on plan pace";
  return pct < 0 ? `Builders are going ${-pct}% faster than plan` : `Builders are going ${pct}% slower than plan`;
}

export function LiveMixTimeline({ live }: { live: LiveScheduleData }) {
  const all = live.recipes.filter(r => r.state !== "done");
  if (all.length === 0) return null;
  // Hot recipes get the exact-time cards; the one being built always shows.
  const open = all.filter(r => r.kind === "hot" || r.state === "building");
  const cold = all.filter(r => r.kind === "cold" && r.state !== "building");
  const pace = paceLine(live);
  const endMoved = Math.abs(live.liveEndMinutes - live.plannedEndMinutes) >= 3;
  return (
    <section className="bg-card border-2 border-primary/30 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" /> When the builders need each mix
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {pace ? `${pace} · ` : ""}finish ~{formatClock(live.liveEndMinutes)}
          {endMoved ? ` (was ${formatClock(live.plannedEndMinutes)})` : ""}
        </p>
      </div>
      {cold.length > 0 && (
        <div className="rounded-xl border-2 border-sky-300 dark:border-sky-700 bg-sky-50/50 dark:bg-sky-900/15 p-4 space-y-2">
          <p className="text-lg font-bold flex items-center gap-2">
            <Snowflake className="w-5 h-5 text-sky-500" /> Mix early — chilled, ready whenever the builders want them
          </p>
          <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {cold.map(r => (
              <li key={r.planItemId} className="flex items-baseline justify-between gap-2 rounded-lg bg-card border border-border px-3 py-2">
                <span className="text-base font-semibold">{r.name}</span>
                <span className="text-base tabular-nums whitespace-nowrap">any time before <b>{formatClock(r.mixByMinutes)}</b></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {open.map((r, i) => {
          const note = r.state === "building" ? "" : driftNote(r);
          return (
            <div
              key={r.planItemId}
              className={cn(
                "rounded-xl border-2 p-4 space-y-2",
                r.state === "building" ? "border-blue-400 bg-blue-50/50 dark:bg-blue-900/15"
                  : i === 1 || (i === 0 && r.state === "waiting") ? "border-amber-400 bg-amber-50/40 dark:bg-amber-900/10"
                  : "border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xl font-bold leading-tight">{r.name}</p>
                <p className="text-2xl font-extrabold tabular-nums whitespace-nowrap">
                  {r.state === "building" ? "now" : `~${formatClock(r.liveStartMinutes)}`}
                </p>
              </div>
              {r.state === "building" ? (
                <p className="text-base font-medium text-blue-700 dark:text-blue-300">
                  Building now · {r.remaining} batch{r.remaining === 1 ? "" : "es"} left · done ~{formatClock(r.liveFinishMinutes)}
                </p>
              ) : (
                <p className={cn("text-sm", r.drift === "ahead" ? "text-emerald-700 dark:text-emerald-300 font-medium" : r.drift === "behind" ? "text-amber-700 dark:text-amber-300 font-medium" : "text-muted-foreground")}>
                  Builders ~{formatClock(r.liveStartMinutes)}{note ? ` (${note})` : ""} · mix ready by {formatClock(r.mixByMinutes)}
                  {r.buildTimeGuessed ? " · build time is a guess" : ""}
                </p>
              )}
              {r.meats.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {r.meats.map(m => <MeatTimeLine key={m.rawMeatIngredientId} m={m} trust={live.trust[m.rawMeatIngredientId]} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
