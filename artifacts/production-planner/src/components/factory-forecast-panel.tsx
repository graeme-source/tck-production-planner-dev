/**
 * Predicted factory number after this plan — the UPPER limit on the Create /
 * Edit Plan screens (Graeme, 15 Oct 2026). Objective C. Sits beside the
 * safety-margin tile (the lower limit).
 *
 *   usePlanFactoryForecast  the forecast for the screen's live rows, with
 *                           "time to pull back" from the last plan days
 *   FactoryForecastTile     compact check tile (16 Oct 2026): "~1,058
 *                           predicted · likely 642–1,340 · Above target",
 *                           one short suggestion line + Apply changes, and
 *                           Change levels (managers)
 *   FactoryForecastDetails  opened by tapping the tile: the working in one
 *                           line, the suggested per-recipe changes, the last
 *                           plan days, per-despatch and per-recipe detail, and
 *                           the levels + fewest batches a day, autosaved
 *   FactoryFreezeGuard      saving a plan predicted at/over the freezing line
 *                           takes a deliberate second tap
 *
 * When to suggest more / fewer: factoryAdvice() in
 * @workspace/stock-prediction (batch-advice.ts). Maths:
 * @workspace/stock-prediction (tested); rows: lib/factory-forecast-rows.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Gauge, Minus, Plus, Settings2, Snowflake } from "lucide-react";
import type { PlanMarginSettings } from "@workspace/plan-margin";
import {
  describeFactoryForecast, factoryAdvice, pullBackAdvice, thresholdsInOrder,
  type FactoryBand, type FactoryRecommendation, type FactoryThresholds, type PullBackAdvice,
} from "@workspace/stock-prediction";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { CheckTile, TileButton, type CheckTone } from "@/components/check-tile";
import { useFactoryForecast, saveFactoryThresholds, type FactoryForecastResponse } from "@/hooks/use-factory-forecast";
import { planFactoryForecast, type ForecastPlanRow, type PlanFactoryForecast } from "@/lib/factory-forecast-rows";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

/** "Mon 2pm" in London time. */
function londonWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(":00", "").replace(" ", "");
  return `${day} ${time}`;
}
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export interface PlanFactoryForecastState extends PlanFactoryForecast {
  data: FactoryForecastResponse | null;
  thresholds: FactoryThresholds;
  /** Stock above the target top for several plan days and rising. */
  pullBack: PullBackAdvice | null;
  loading: boolean;
  loadError: boolean;
  /** Same check for any set of rows (e.g. after the margin fix is applied). */
  needsConfirmFor: (rows: readonly ForecastPlanRow[]) => boolean;
}

export function usePlanFactoryForecast({ planDate, rows, categoryOf, inFridge, margin, maxTotalBatches, enabled = true }: {
  planDate: string | null | undefined;
  rows: readonly ForecastPlanRow[];
  categoryOf: (recipeId: number) => string | null | undefined;
  /** False for freezer-stored recipes (route flag) — out of the factory number. */
  inFridge?: (recipeId: number) => boolean;
  margin: PlanMarginSettings;
  /** The day's capacity (the rota cap, or the total batches box). */
  maxTotalBatches?: number;
  enabled?: boolean;
}): PlanFactoryForecastState {
  const q = useFactoryForecast(planDate, enabled);
  const shares = q.data?.recipeShares;
  const history = q.data?.history;
  const ctx = useMemo(() => ({ categoryOf, inFridge, shares: shares ?? {}, margin }), [categoryOf, inFridge, shares, margin]);
  const pullBack = useMemo(() => (history ? pullBackAdvice(history, q.thresholds) : null), [history, q.thresholds]);
  const result = useMemo(
    () => planFactoryForecast(rows, ctx, q.late, q.thresholds, {
      maxTotalBatches, minTotalBatches: q.thresholds.minBatchesPerDay, pullBack,
    }),
    [rows, ctx, q.late, q.thresholds, maxTotalBatches, pullBack],
  );
  return {
    ...result,
    data: q.data,
    thresholds: q.thresholds,
    pullBack,
    loading: q.loading,
    loadError: q.loadError,
    // Only ask for the second tap once the forecast has actually loaded.
    needsConfirmFor: r => !!q.data && planFactoryForecast(r, ctx, q.late, q.thresholds).needsConfirm,
  };
}

const BAND: Record<FactoryBand, { tone: CheckTone; short: (t: FactoryThresholds) => string }> = {
  "too-low": { tone: "red", short: t => `Too low — under ${fmt(t.lowRed)}` },
  low: { tone: "amber", short: t => `Running low — under ${fmt(t.lowAmber)}` },
  under: { tone: "info", short: t => `A little under the ${fmt(t.targetLow)}–${fmt(t.targetHigh)} target` },
  target: { tone: "ok", short: t => `On target (${fmt(t.targetLow)}–${fmt(t.targetHigh)})` },
  above: { tone: "amber", short: () => "Above target" },
  warning: { tone: "orange", short: t => `Warning — over ${fmt(t.warnAt)}` },
  freeze: { tone: "red", short: t => `Over ${fmt(t.maxAt)} — you'd be freezing` },
};

/** "Make 12 fewer batches to land near 1,000" — one short line. */
export function recommendationText(r: FactoryRecommendation): string {
  const n = plural(r.batches, "batch", "batches").replace(/^(\S+) /, `$1 ${r.direction === "fewer" ? "fewer" : "more"} `);
  if (r.limited) return `Make ${n} — lands on ~${fmt(r.landsOn)}`;
  return r.direction === "fewer" ? `Make ${n} to land near ${fmt(r.aim)}` : `Make ${n} to reach ${fmt(r.aim)}`;
}

function pullBackText(p: PullBackAdvice, t: FactoryThresholds): string {
  return `Stock has been above ${fmt(t.targetHigh)} for ${p.days} plan days and rising — time to pull back`;
}

export function FactoryForecastTile({ state, canEdit, expanded, onToggle, onEdit, onApply }: {
  state: PlanFactoryForecastState;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onApply: (rec: FactoryRecommendation) => void;
}) {
  const { forecast: f, recommendation: rec, data, thresholds: t } = state;
  const ready = !!data;
  const band = BAND[f.band];
  const tone: CheckTone = !ready ? "neutral" : rec?.reason === "pull-back" ? "orange" : band.tone;
  // The levels want a change the limits won't allow — say why, not nothing.
  const blocked = !rec ? factoryAdvice(f.predictedEnd, t, state.pullBack).direction : null;
  return (
    <CheckTile
      tone={tone} expanded={expanded} onToggle={onToggle} label="Predicted factory number"
      icon={<Gauge className={cn("w-6 h-6", ready ? "text-foreground" : "text-muted-foreground")} />}
      headline={
        <span className="tabular-nums">
          ~{fmt(f.predictedEnd)} predicted
          {ready && f.high > f.low && <span className="font-semibold text-muted-foreground"> · likely {fmt(f.low)}–{fmt(f.high)}</span>}
        </span>
      }
      sub={state.loading
        ? "Working out late orders…"
        : !ready
          ? "Known orders only — couldn't load late orders"
          : band.short(t)}
      footer={ready && rec ? (
        <div className="rounded-xl border bg-background px-3 py-2 space-y-2" onClick={e => e.stopPropagation()}>
          {rec.reason === "pull-back" && state.pullBack && (
            <div className="text-sm font-semibold text-orange-800 dark:text-orange-200">{pullBackText(state.pullBack, t)}</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold flex-1 min-w-[10rem]">{recommendationText(rec)}</span>
            <TileButton primary onClick={() => onApply(rec)}>
              {rec.direction === "fewer" ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Apply changes
            </TileButton>
          </div>
        </div>
      ) : ready && blocked ? (
        <div className="text-sm font-semibold">
          {blocked === "fewer"
            ? `Can't take more off: at the fewest batches a day (${fmt(t.minBatchesPerDay)}) or every recipe's orders + margin`
            : "Can't add more: the day is at capacity"}
        </div>
      ) : undefined}
      actions={canEdit ? <TileButton onClick={onEdit}><Settings2 className="w-4 h-4" /> Change levels</TileButton> : undefined}
    />
  );
}

export function FactoryForecastDetails({ state, canEdit, editing }: {
  state: PlanFactoryForecastState;
  canEdit: boolean;
  editing: boolean;
}) {
  const { forecast: f, recommendation: rec, data, thresholds: t } = state;
  const emails = data?.emails.length ?? 0;
  const byWhen = data ? londonWhen(data.lastCutoffAt) : undefined;
  const history = data?.history ?? null;
  return (
    <div className="space-y-3 text-sm">
      <div className="text-base">
        {state.loading
          ? "Working out late orders…"
          : state.loadError || !data
            ? `Known orders only (${fmt(f.knownEnd)}) — couldn't load the late-orders prediction just now.`
            : describeFactoryForecast(f, { byWhen, emails })}
      </div>

      {rec && (
        <div className="rounded-xl border bg-background p-3">
          <div className="font-bold">{recommendationText(rec)}</div>
          <div className="text-muted-foreground">
            {rec.changes.map(c => `${c.recipeName} ${c.from}→${c.to}`).join(" · ")}
            {rec.direction === "fewer"
              ? ` — taken from the flavours with the most packs left for their sales; never below a recipe's orders + margin or ${plural(t.minBatchesPerDay, "batch", "batches")} a day.`
              : " — added to the flavours with the fewest packs left for their sales, within the day's capacity."}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-background p-3">
        <div className="font-bold mb-1">When it suggests a change</div>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>{fmt(t.targetLow)}–{fmt(t.targetHigh)} is the target. Up to {fmt(t.warnAt)} it says "above target" and leaves the batches alone.</li>
          <li>At {fmt(t.warnAt)} or more it suggests fewer batches to land near {fmt(t.targetHigh)}; at {fmt(t.maxAt)} saving needs a second tap.</li>
          <li>Over {fmt(t.targetHigh)} when the fridge has ended 3 or more plan days in a row above {fmt(t.targetHigh)} and rising, it says it's time to pull back.</li>
          <li>Under {fmt(t.targetLow)} it suggests more, up to the day's capacity; under {fmt(t.lowRed)} is too low.</li>
          <li>Never below {plural(t.minBatchesPerDay, "batch", "batches")} a day.</li>
        </ul>
        {history && history.length > 0 && (
          <div className="mt-2">
            <span className="font-semibold">Fridge at the end of recent plan days:</span>{" "}
            {history.map(h => `${dayName(h.date)} ${h.date.slice(8, 10)}/${h.date.slice(5, 7)} ${fmt(h.packs)}`).join(" · ")}
          </div>
        )}
        {data && !history && <div className="mt-2 text-muted-foreground">Couldn't read the last plan days, so "time to pull back" isn't checked.</div>}
      </div>

      <ForecastDetails state={state} />
      {editing && canEdit && <ThresholdEditor thresholds={t} />}
    </div>
  );
}

function ForecastDetails({ state }: { state: PlanFactoryForecastState }) {
  const { data, forecast: f } = state;
  const rows = [...f.perRecipe].filter(r => r.knownEnd > 0 || r.predictedLate > 0).sort((a, b) => b.predictedEnd - a.predictedEnd);
  return (
    <div className="grid gap-3 grid-cols-1 xl:grid-cols-2 text-sm">
      <div className="rounded-xl border bg-background p-3 space-y-2">
        <div className="font-bold">Orders still to come</div>
        {(data?.despatches ?? []).map(d => (
          <div key={d.despatchDate}>
            <span className="font-semibold">{dayName(d.despatchDate)} despatch</span> ({dayName(d.deliveryDate)} delivery):{" "}
            {d.closed
              ? "orders closed."
              : d.samples === 0
                ? "not enough history to predict — known orders only."
                : <>~{fmt(d.latePacks)} more packs (likely {fmt(d.low)}–{fmt(d.high)}) before {londonWhen(d.cutoffAt)}. Usually {Math.round(d.shareStillToCome * 100)}% of a {dayName(d.deliveryDate)}'s packs are ordered in the last {Math.round(d.hoursToCutoff)} hours; a typical {dayName(d.deliveryDate)} lately is {fmt(d.typicalDayPacks)} packs{d.emailAdjustment !== 0 ? `; ${d.emailAdjustment > 0 ? "+" : ""}${fmt(d.emailAdjustment)} for ${d.emailsInWindow} email${d.emailsInWindow === 1 ? "" : "s"} (usually ${d.typicalEmails.toFixed(1)})` : ""}.</>}
          </div>
        ))}
        {(data?.emails.length ?? 0) > 0 && (
          <div className="text-muted-foreground">
            Emails due: {data!.emails.map(e => `${londonWhen(e.at)} “${e.name}”`).join(", ")}
          </div>
        )}
        {data && !data.klaviyoConnected && <div className="text-muted-foreground">Klaviyo isn't connected — only emails on the email plan are counted.</div>}
        <div className="text-muted-foreground">
          Known orders out before the plan day ends: {fmt(f.knownOrders)} packs on the plan day's despatch (plus the days before, already in the stock figure).
          Measured on 26 weeks of real orders; on past plans it was out by ~100 packs on average (known orders alone: ~260). Mac cheese and fried chicken are not included.
        </div>
      </div>
      <div className="rounded-xl border bg-background p-3">
        <div className="font-bold mb-1">Per recipe — end of plan day</div>
        <ul className="space-y-0.5">
          {rows.map(r => (
            <li key={r.key} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate">{r.recipeName}</span>
              <span>{fmt(r.knownEnd)} − {fmt(r.predictedLate)} late = <b>{fmt(r.predictedEnd)}</b></span>
            </li>
          ))}
        </ul>
        <div className="text-xs text-muted-foreground mt-1">Late orders are split by each recipe's share of the last 7 days' sales.</div>
      </div>
    </div>
  );
}

const THRESHOLD_FIELDS: Array<{ key: keyof FactoryThresholds; label: string }> = [
  { key: "lowRed", label: "Too low under" },
  { key: "lowAmber", label: "Running low under" },
  { key: "targetLow", label: "Target from" },
  { key: "targetHigh", label: "Target to" },
  { key: "warnAt", label: "Warning at" },
  { key: "maxAt", label: "Freezing at" },
  // Not a pack level: a batch count, outside the left-to-right order check.
  { key: "minBatchesPerDay", label: "Fewest batches a day" },
];

function ThresholdEditor({ thresholds }: { thresholds: FactoryThresholds }) {
  const queryClient = useQueryClient();
  const [vals, setVals] = useState<Record<keyof FactoryThresholds, string>>(
    () => Object.fromEntries(THRESHOLD_FIELDS.map(f => [f.key, String(thresholds[f.key])])) as Record<keyof FactoryThresholds, string>,
  );
  const [orderError, setOrderError] = useState(false);
  const auto = useAutosave(async (next: FactoryThresholds) => {
    await saveFactoryThresholds(next);
    await queryClient.invalidateQueries({ queryKey: ["factory-forecast"] });
  });
  const change = (key: keyof FactoryThresholds, v: string) => {
    const nextVals = { ...vals, [key]: v };
    setVals(nextVals);
    const nums = Object.fromEntries(Object.entries(nextVals).map(([k, s]) => [k, Number(s)])) as unknown as FactoryThresholds;
    const valid = Object.values(nextVals).every(s => s.trim() !== "" && Number.isInteger(Number(s)) && Number(s) >= 0);
    if (!valid) return;
    const inOrder = thresholdsInOrder(nums);
    setOrderError(!inOrder);
    if (inOrder) auto.schedule(nums);
  };
  const field = "h-12 w-24 rounded-xl border-2 border-border bg-background px-3 text-lg font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-4">
        {THRESHOLD_FIELDS.map(f => (
          <label key={f.key} className={cn("space-y-1", f.key === "minBatchesPerDay" && "sm:ml-4 sm:pl-4 sm:border-l-2 border-border")}>
            <span className="block text-sm font-semibold text-muted-foreground">{f.label}</span>
            <input type="number" min={0} inputMode="numeric" value={vals[f.key]} className={field}
              onChange={e => change(f.key, e.target.value)} onBlur={() => void auto.flush()} />
          </label>
        ))}
        <div className="pb-3"><SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} /></div>
      </div>
      {orderError && (
        <div className="text-sm font-semibold text-red-600">Not saved — keep them in order, smallest to largest, left to right.</div>
      )}
      <p className="text-xs text-muted-foreground">Levels are packs of calzone in the fridge at the end of the plan day. Saving a plan predicted at or over the freezing level needs a second tap. No suggestion goes below the fewest batches a day or above the day's capacity.</p>
    </div>
  );
}

/** Saving a plan predicted at/over the freezing line: apply the
 *  recommendation and save, or save as it is with a second, deliberate tap. */
export function FactoryFreezeGuard({ open, state, saving, onApplyAndSave, onSaveAnyway, onClose }: {
  open: boolean;
  state: PlanFactoryForecastState;
  saving: boolean;
  onApplyAndSave: (rec: FactoryRecommendation) => void;
  onSaveAnyway: () => void;
  onClose: () => void;
}) {
  const { forecast: f, recommendation: rec, thresholds: t } = state;
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-xl w-[calc(100vw-1.5rem)] max-h-[92dvh] p-0 gap-0 flex flex-col border-2 border-red-500 rounded-2xl">
        <DialogHeader className="p-5 pb-3 pr-12 text-left">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Snowflake className="w-6 h-6 text-red-600 flex-shrink-0" />
            This plan would leave ~{fmt(f.predictedEnd)} packs — you'd be freezing stock
          </DialogTitle>
          <DialogDescription>
            Over {fmt(t.maxAt)} packs the fridge is full and product has to go in the freezer.
            Likely {fmt(f.low)}–{fmt(f.high)} after the orders still to come.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 text-sm space-y-2">
          {rec && rec.direction === "fewer" && (
            <div className="rounded-xl border border-amber-400 bg-amber-500/5 px-3 py-2.5">
              <div className="font-bold">{recommendationText(rec)}</div>
              <div>{rec.changes.map(c => `${c.recipeName} ${c.from}→${c.to}`).join(" · ")}</div>
            </div>
          )}
        </div>
        <div className="p-5 pt-4 flex flex-col sm:flex-row gap-2 border-t border-border mt-3">
          {rec && rec.direction === "fewer" && (
            <button type="button" disabled={saving} onClick={() => onApplyAndSave(rec)}
              className="flex-1 h-12 rounded-xl bg-primary text-primary-foreground text-base font-bold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2">
              <Minus className="w-5 h-5" /> Make {plural(rec.batches, "batch", "batches").replace(/^(\S+) /, "$1 fewer ")} and save
            </button>
          )}
          <button type="button" disabled={saving} onClick={onSaveAnyway}
            className="flex-1 h-12 rounded-xl border-2 border-red-500 text-red-700 dark:text-red-300 text-sm font-bold hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Save anyway — I'll freeze
          </button>
          <button type="button" onClick={onClose} className="h-12 px-4 rounded-xl border border-border text-sm font-semibold hover:bg-secondary/60">
            Go back
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
