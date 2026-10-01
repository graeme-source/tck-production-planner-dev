/**
 * Slow-meat tray limit applied to the Create Plan screen's rows
 * (Graeme, 2026-10-01). The maths is @workspace/slow-meat; this file only
 * decides WHICH rows the cap may touch and how the notice is worded.
 *
 * - Rows still following their suggestion (batches == suggested, included,
 *   not queued test production) are the only ones the cap reduces. A row the
 *   operator has typed into is theirs: it is never silently cut — the live
 *   counter turns red and saving is blocked instead.
 * - A capped row remembers its uncapped suggestion (slowMeatCappedFrom), so
 *   re-running the cap (profile loaded late, the limit changed) always starts
 *   from the real suggestion, and the notice can say "30 → 24".
 */
import {
  capSlowMeatBatches,
  countSlowMeatTrays,
  describeSlowMeatReductions,
  type PlanLine,
  type RecipeMeatProfile,
  type SlowMeatReduction,
  type SlowMeatSettings,
  type SlowMeatTrayCount,
} from "@workspace/slow-meat";

export interface SlowMeatProfileData {
  settings: SlowMeatSettings;
  profiles: RecipeMeatProfile[];
}

export interface CappablePlanRow {
  id: string;
  recipeId: number;
  recipeName: string;
  included: boolean;
  batchesTarget: number;
  suggestedBatches: number;
  /** The uncapped suggestion, set only while the slow-meat cap is holding
   *  this row below it. */
  slowMeatCappedFrom?: number;
}

const isQueued = (row: CappablePlanRow) => row.id.startsWith("queued-");

function followsSuggestion(row: CappablePlanRow): boolean {
  return row.included && !isQueued(row) && row.batchesTarget === row.suggestedBatches;
}

/**
 * Cap the suggestion-following rows so the plan's slow meat fits. `setBatches`
 * returns the row with batches/suggestion (and anything derived, like tins)
 * set to the given number. Returns the SAME array when nothing changes, so it
 * is safe to call inside a state updater or an effect.
 */
export function applySlowMeatCap<T extends CappablePlanRow>(
  rows: T[],
  data: SlowMeatProfileData | null | undefined,
  setBatches: (row: T, batches: number) => T,
): T[] {
  if (!data) return rows;
  const lines: PlanLine[] = rows.map(r => followsSuggestion(r)
    ? { recipeId: r.recipeId, batches: r.slowMeatCappedFrom ?? r.batchesTarget }
    : { recipeId: r.recipeId, batches: r.included ? r.batchesTarget : 0, fixed: true });
  const result = capSlowMeatBatches(data.profiles, lines, data.settings);

  let changed = false;
  const next = rows.map((r, i) => {
    if (!followsSuggestion(r)) return r;
    const orig = r.slowMeatCappedFrom ?? r.batchesTarget;
    const capped = result.lines[i].batches;
    if (capped < orig) {
      if (r.batchesTarget === capped && r.slowMeatCappedFrom === orig) return r;
      changed = true;
      return { ...setBatches(r, capped), slowMeatCappedFrom: orig };
    }
    if (r.slowMeatCappedFrom != null) {
      // The limit no longer bites (raised, or other rows shrank): restore.
      changed = true;
      return { ...setBatches(r, orig), slowMeatCappedFrom: undefined };
    }
    return r;
  });
  return changed ? next : rows;
}

/** Live tray count for the rows as they stand (included rows only). */
export function slowMeatCountForRows(rows: CappablePlanRow[], data: SlowMeatProfileData): SlowMeatTrayCount {
  return countSlowMeatTrays(
    data.profiles,
    rows.filter(r => r.included).map(r => ({ recipeId: r.recipeId, batches: r.batchesTarget })),
    data.settings,
  );
}

/** Reductions the cap is currently holding (rows still on the capped
 *  suggestion — a row the operator has since edited is theirs). */
export function slowMeatReductionsForRows(rows: CappablePlanRow[]): SlowMeatReduction[] {
  return rows
    .filter(r => r.slowMeatCappedFrom != null && followsSuggestion(r) && r.batchesTarget < r.slowMeatCappedFrom)
    .map(r => ({ recipeId: r.recipeId, recipeName: r.recipeName.trim(), from: r.slowMeatCappedFrom!, to: r.batchesTarget }));
}

export function slowMeatNotice(rows: CappablePlanRow[], count: SlowMeatTrayCount): string {
  return describeSlowMeatReductions({ reductions: slowMeatReductionsForRows(rows), after: count });
}
