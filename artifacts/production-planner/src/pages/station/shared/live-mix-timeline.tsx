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

/**
 * One hot meat's times: in the oven by, out by (= builders need it − learned
 * processing − learned buffer), and — inside the 4-hour rule — the waves when
 * one cook can't cover the whole build. Red when a breach is coming.
 */
export function MeatTimeLine({ m, trust, large = false, trays }: { m: LiveMeat; trust?: TrustSignal; large?: boolean; trays?: number | null }) {
  const moved = Math.round(m.liveCookStartMinutes) !== Math.round(m.plannedCookStartMinutes);
  const multi = m.waves.length > 1;
  const totalBatches = m.waves.reduce((s, w) => s + w.batches, 0);
  const traysFor = (b: number) => (trays && totalBatches > 0 ? Math.max(1, Math.round((trays * b) / totalBatches)) : null);
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
            {m.outMinutes != null && (
              <span className="text-muted-foreground tabular-nums">· out by {formatClock(m.outMinutes)}</span>
            )}
            {moved && <span className="text-xs text-muted-foreground tabular-nums">(was {formatClock(m.plannedCookStartMinutes)})</span>}
            {m.overdue && <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">put it in now</span>}
          </>
        )}
        <TrustedChip trust={trust} />
      </div>
      {multi && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/15 px-3 py-2 text-sm space-y-0.5">
          <p className="font-semibold">Cook in {m.waves.length} waves — the 4-hour rule (cooked → built, baked and chilled to 8 °C)</p>
          {m.waves.map(w => {
            const t = traysFor(w.batches);
            return (
              <p key={w.wave} className="tabular-nums">
                Wave {w.wave}: in {formatClock(w.putInMinutes)}, out {formatClock(w.outMinutes)} — {w.batches} batch{w.batches === 1 ? "" : "es"}{t ? ` (~${t} tray${t === 1 ? "" : "s"})` : ""}
              </p>
            );
          })}
        </div>
      )}
      {m.safetyImpossible && (
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          Processing alone uses up the 4-hour limit for this build — split the recipe or speak to a manager.
        </p>
      )}
      {m.safetyBreachComing && m.safetyOverMinutes != null && (
        <p className="text-base font-bold text-rose-700 dark:text-rose-300 flex items-start gap-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 px-3 py-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          4-hour rule: at this pace the last batch will be built {m.safetyOverMinutes} min too late for this {m.rawMeatName}. Cook a fresh batch for the rest, or build it sooner.
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
                  Builders ~{formatClock(r.liveStartMinutes)}{note ? ` (${note})` : ""}
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
