/**
 * Slow-meat tray limit on the Create Plan screen (Graeme, 2026-10-01).
 *
 * The kitchen can only cook so many trays of slow meat (cook time of 2 hours
 * or more — the pulled-pork pork and the slow-cooked beef today) for one
 * plan. This shows:
 *   - a live tray counter ("Slow meat: 9 of 11 trays") with the per-meat split
 *   - a friendly notice when the suggestions were cut to fit
 *   - a red warning when typed-in batches push it over (saving is blocked)
 *   - any slow meat with no kg-per-tray set (flagged, never guessed) — the
 *     ingredient name links to its edit form
 *   - for admins, the limit and the threshold, autosaved
 * Trays are counted exactly as the Raw Meat station lays them out
 * (@workspace/slow-meat).
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Flame, Info, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutosave } from "@/hooks/use-autosave";
import { SaveChip } from "@/components/save-chip";
import { ingredientTimingHref } from "@/components/timing-flag";
import { SLOW_MEAT_PROFILE_KEY, saveSlowMeatSettings } from "@/hooks/use-slow-meat-profile";
import { slowMeatCountForRows, slowMeatNotice, type CappablePlanRow, type SlowMeatProfileData } from "@/lib/slow-meat-plan";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function cookTimeLabel(min: number): string {
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? "" : "s"}`;
  return `${min} minutes`;
}

/** Big card above the recipes table. */
export function SlowMeatPanel({ rows, data, loadError, isAdmin }: {
  rows: CappablePlanRow[];
  data: SlowMeatProfileData | undefined;
  loadError: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!data) {
    if (!loadError) return null;
    return (
      <div className="mb-3 px-4 py-3 rounded-2xl border-2 border-amber-400/60 bg-amber-500/10 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <span>Couldn't load the slow-meat tray limit, so trays aren't being counted here. The plan is still checked when you save.</span>
      </div>
    );
  }

  const count = slowMeatCountForRows(rows, data);
  const notice = slowMeatNotice(rows, count);
  const { totalTrays, trayLimit } = count;
  const over = count.overLimit;
  const atLimit = !over && totalTrays === trayLimit && trayLimit > 0;
  // Tray boxes: one per tray allowed, plus red ones for any over.
  const boxes = Math.min(40, Math.max(trayLimit, totalTrays));

  return (
    <div className={cn(
      "mb-3 rounded-2xl border-2 p-4 space-y-3",
      over ? "border-red-500 bg-red-500/10" : "border-border bg-card",
    )}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <Flame className={cn("w-6 h-6 flex-shrink-0", over ? "text-red-600" : "text-orange-500")} />
          <span className="text-lg font-bold">
            Slow meat:{" "}
            <span className={cn("tabular-nums", over ? "text-red-600 dark:text-red-400" : atLimit ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
              {totalTrays} of {trayLimit}
            </span>{" "}
            trays
          </span>
        </div>
        <div className="flex flex-wrap gap-1" aria-hidden>
          {Array.from({ length: boxes }, (_, i) => (
            <span
              key={i}
              className={cn(
                "w-4 h-5 rounded-[3px] border",
                i < Math.min(totalTrays, trayLimit) ? "bg-orange-500 border-orange-600"
                  : i < trayLimit ? "bg-secondary border-border"
                  : "bg-red-600 border-red-700",
              )}
            />
          ))}
        </div>
        {count.byIngredient.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {count.byIngredient.map(m => (
              <span key={m.ingredientId} className="px-2.5 py-1 rounded-full bg-secondary text-sm font-semibold tabular-nums" title={`${m.kg} kg raw meat + marinade at ${m.trayCapacityKg} kg a tray`}>
                {m.ingredientName} {m.trays}
              </span>
            ))}
          </div>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditing(v => !v)}
            className="ml-auto inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-border bg-background text-sm font-semibold hover:bg-secondary/60"
          >
            {editing ? <X className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
            {editing ? "Done" : "Change limit"}
          </button>
        )}
      </div>

      {over && (
        <div className="flex items-start gap-2 text-base font-semibold text-red-700 dark:text-red-300">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            Too much slow-cooked meat: {totalTrays} trays, but we can only cook {trayLimit}. Reduce{" "}
            {count.byRecipe.filter(r => r.trays > 0).map(r => r.recipeName.trim()).join(" or ")} — the plan can't be saved until it fits.
          </span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-sky-500/10 border border-sky-400/50 text-sm text-sky-900 dark:text-sky-200">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><span className="font-semibold">Slow meat limit:</span> {notice}.</span>
        </div>
      )}

      {count.missingTraySize.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-400/60 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {count.missingTraySize.map((m, i) => (
              <span key={m.ingredientId}>
                {i > 0 && ", "}
                <a href={`${BASE}${ingredientTimingHref(m.ingredientId)}`} target="_blank" rel="noreferrer" className="font-semibold underline">
                  {m.ingredientName}
                </a>
              </span>
            ))}
            {" "}{count.missingTraySize.length === 1 ? "has" : "have"} no kg per tray set, so {count.missingTraySize.length === 1 ? "its" : "their"} trays aren't counted. Set it on the ingredient.
          </span>
        </div>
      )}

      {editing && isAdmin && <SlowMeatSettingsEditor data={data} />}

      <p className="text-xs text-muted-foreground">
        Slow meat = a cook time of {cookTimeLabel(data.settings.minCookMinutes)} or more. Trays = raw meat + marinade ÷ the meat's kg per tray, the same as the Raw Meat station.
      </p>
    </div>
  );
}

function SlowMeatSettingsEditor({ data }: { data: SlowMeatProfileData }) {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(data.settings.trayLimit));
  const [minutes, setMinutes] = useState(String(data.settings.minCookMinutes));
  const auto = useAutosave(async (next: { trayLimit: number; minCookMinutes: number }) => {
    await saveSlowMeatSettings(next);
    await queryClient.invalidateQueries({ queryKey: SLOW_MEAT_PROFILE_KEY });
  });
  const schedule = (l: string, m: string) => {
    const trayLimit = Number(l);
    const minCookMinutes = Number(m);
    if (l.trim() === "" || m.trim() === "" || !Number.isInteger(trayLimit) || trayLimit < 0 || !Number.isInteger(minCookMinutes) || minCookMinutes < 1) return;
    auto.schedule({ trayLimit, minCookMinutes });
  };

  const field = "h-12 w-24 rounded-xl border-2 border-border bg-background px-3 text-lg font-bold tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <div className="flex flex-wrap items-end gap-4 pt-1">
      <label className="space-y-1">
        <span className="block text-sm font-semibold text-muted-foreground">Most slow-meat trays a plan</span>
        <input
          type="number" min={0} inputMode="numeric" value={limit} className={field}
          onChange={e => { setLimit(e.target.value); schedule(e.target.value, minutes); }}
          onBlur={() => void auto.flush()}
        />
      </label>
      <label className="space-y-1">
        <span className="block text-sm font-semibold text-muted-foreground">Slow = cook time of at least (minutes)</span>
        <input
          type="number" min={1} inputMode="numeric" value={minutes} className={field}
          onChange={e => { setMinutes(e.target.value); schedule(limit, e.target.value); }}
          onBlur={() => void auto.flush()}
        />
      </label>
      <div className="pb-3"><SaveChip state={auto.state} error={auto.error} onRetry={() => void auto.flush()} /></div>
    </div>
  );
}

/** One line by the save buttons: the counter, red when over. */
export function SlowMeatSaveStatus({ rows, data }: { rows: CappablePlanRow[]; data: SlowMeatProfileData | undefined }) {
  if (!data) return null;
  const count = slowMeatCountForRows(rows, data);
  if (count.totalTrays === 0 && !count.overLimit) return null;
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
      count.overLimit ? "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500" : "bg-secondary text-foreground",
    )}>
      <Flame className="w-4 h-4 flex-shrink-0" />
      {count.overLimit
        ? <span>Slow meat {count.totalTrays} of {count.trayLimit} trays — reduce it to save</span>
        : <span>Slow meat: {count.totalTrays} of {count.trayLimit} trays</span>}
    </div>
  );
}
