/**
 * Turning a suggestion into the rows the planner actually edits.
 *
 * The suggestion is what the maths thinks a run of N kg should make. The plan
 * is what has been decided. They are not the same thing and the dialog has to
 * hold both: re-opening it must show the plan as it stands, not quietly
 * overwrite last night's decision with a fresh suggestion (Graeme, 2026-09-03
 * — the paper sheet was edited and left on the wall; the screen has to behave
 * the same way).
 *
 * Kept pure and separate from the dialog so the arithmetic can be tested
 * without a browser.
 */

/** One variant as GET /fried-chicken/suggestion returns it. */
export interface SuggestionVariant {
  recipeId: number;
  name: string;
  stockPacks: number;
  soldLast30: number;
  dptPercent: number;
  kgPerPack: number;
  /** What the allocator would make. */
  packs: number;
  stockAfter: number;
  daysCoverNow: number | null;
}

/** A fried chicken line already sitting on the plan. */
export interface PlannedBag {
  recipeId: number;
  /** Bags targeted. */
  packs: number;
  /** Bags already fried and counted at the station. */
  made: number;
}

export interface PlanRow extends SuggestionVariant {
  /** What the allocator suggested — kept so "reset to suggestion" can work. */
  suggested: number;
  /** What will be saved. */
  planned: number;
  /** Already on the plan before this dialog opened. */
  onPlanAlready: boolean;
  /** Bags already fried. The floor for `planned`: the server refuses to
   *  delete a line with work against it, and nobody should be asked to
   *  un-fry a bag. */
  made: number;
}

export function mergeSuggestionWithPlan(
  variants: readonly SuggestionVariant[],
  existing: readonly PlannedBag[],
): PlanRow[] {
  const onPlan = new Map(existing.map(e => [e.recipeId, e]));
  return variants.map(v => {
    const prior = onPlan.get(v.recipeId);
    const made = Math.max(0, prior?.made ?? 0);
    return {
      ...v,
      suggested: v.packs,
      // An untouched plan takes the suggestion; a plan that already says
      // something keeps saying it until someone changes it.
      planned: Math.max(made, prior ? prior.packs : v.packs),
      onPlanAlready: prior !== undefined,
      made,
    };
  });
}

export interface RunTotals {
  packs: number;
  /** Raw chicken the planned bags cost. */
  kgUsed: number;
  /** Budget left unspent. Zero once the run is fully committed. */
  kgSpare: number;
  /** Over the budget — allowed, but it has to be said out loud, because the
   *  chicken has already been ordered against `rawKg`. */
  kgOver: number;
  /** Oil to have on site for the chicken actually planned, not for the
   *  nominal run size. */
  oilKg: number;
}

export function runTotals(
  rows: readonly Pick<PlanRow, "planned" | "kgPerPack">[],
  rawKg: number,
  oilKgPerKg: number,
): RunTotals {
  const packs = rows.reduce((n, r) => n + Math.max(0, r.planned), 0);
  const kgUsed = rows.reduce((n, r) => n + Math.max(0, r.planned) * Math.max(0, r.kgPerPack), 0);
  const budget = Math.max(0, rawKg);
  return {
    packs,
    kgUsed: round(kgUsed, 3),
    kgSpare: round(Math.max(0, budget - kgUsed), 3),
    kgOver: round(Math.max(0, kgUsed - budget), 3),
    oilKg: round(kgUsed * Math.max(0, oilKgPerKg), 1),
  };
}

/** Days of cover a variant lands on once the planned bags are made. Null when
 *  nothing has sold in the window — dividing by no sales says nothing useful,
 *  and a made-up number here would drive the run. */
export function daysCoverAfter(
  row: Pick<PlanRow, "stockPacks" | "planned" | "soldLast30">,
  windowDays: number,
): number | null {
  const perDay = row.soldLast30 / Math.max(1, windowDays);
  if (!(perDay > 0)) return null;
  return round((row.stockPacks + Math.max(0, row.planned)) / perDay, 1);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
