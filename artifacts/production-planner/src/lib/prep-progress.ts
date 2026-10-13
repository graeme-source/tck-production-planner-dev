// ── Prep progress, counted in TASKS (Graeme, 2026-10-13) ───────────────────
//
// ONE definition of "how far through prep are we", used by the dashboard's
// "Prepping For" tile, the Prepping For hub, the plan page's prep button and
// the header of each prep section (Main Prep, Bases & Sauces, Raw Meat), so
// none of them can disagree again.
//
// Why tasks, not tins: on 13 Oct the tile said "28 / 31 tins prepped" while
// Main Prep said "33 of 33 tins resolved" and everything was finished. The
// tile ran its own server-side reconstruction of main prep: it never saw
// sub-recipe lines (TCK Burger Sauce, Garlic Butter, Garlic Confit, Nacho
// Cheese — 5 tins, all ticked) and it didn't apply the station's
// one-tin-per-recipe rule, so Fresh Basil ×2 and Rosemary carried phantom
// second tins nobody could ever tick. Two copies of one rule drifted.
//
// A TASK is one prep line exactly as the station lists it:
//   • Main Prep  — each ingredient or sub-recipe row under each recipe
//                  (the left-hand list), plus each tickable linked row
//                  (pasta cooking water / salt).
//                  Done = every tin is resolved: ticked OR deferred to the
//                  production day — the station's existing "resolved" rule.
//   • Bases      — each sauce row under each recipe, plus each base
//                  sub-recipe (Tomato Base…). Sauce done = every tin ticked;
//                  base done = marked made for this plan.
//   • Raw Meat   — each raw-meat ingredient under each recipe (e.g. chicken
//                  for Peri Peri). Done = every tray ticked.
// Tins / trays stay as secondary detail on each section.
//
// Inputs are the SAME responses the stations render from, so the pure
// functions below are the whole of the logic — no second reconstruction.

/** A tick (completion) or deferral row as /main-prep returns it. */
export interface PrepTick {
  ingredientId: number | null;
  recipeId: number;
  tinNumber: number | null;
  isSubRecipe?: boolean;
  subRecipeOriginId?: number | null;
}

/** One prep row with per-recipe tin counts (/main-prep `ingredients[]`). */
export interface PrepTinLine {
  ingredientId: number;
  ingredientName: string;
  isSubRecipe?: boolean;
  recipes: Array<{ recipeId: number; tinCount: number; subRecipeOriginId?: number | null }>;
}

export interface Count { done: number; total: number }

export interface SectionProgress extends Count {
  /** Secondary detail: tins (main prep, bases sauces) or trays (raw meat). */
  units: Count;
  /** Bases only: base sub-recipes made, of those needed. */
  bases?: Count;
  /** Main prep only: tins resolved by deferral rather than a tick. */
  deferredUnits?: number;
}

export type PrepSectionKey = "main_prep" | "prep_bases" | "prep_meat";

export interface PrepProgress extends Count {
  pct: number;
  bySection: Record<PrepSectionKey, SectionProgress>;
}

const tickKey = (isSub: boolean | undefined, ingredientId: number | null, recipeId: number, origin: number | null | undefined, tin: number | null) =>
  `${isSub ? 1 : 0}:${ingredientId ?? 0}:${recipeId}:${origin ?? 0}:${tin ?? 0}`;

function tickSet(rows: PrepTick[] | undefined): Set<string> {
  const s = new Set<string>();
  for (const r of rows ?? []) s.add(tickKey(r.isSubRecipe, r.ingredientId, r.recipeId, r.subRecipeOriginId, r.tinNumber));
  return s;
}

const EMPTY: SectionProgress = { done: 0, total: 0, units: { done: 0, total: 0 } };

/** Tasks for tin-tracked rows: one per (row, parent recipe), as the station's
 *  left-hand list shows them. Entries of one row under the same recipe (an
 *  ingredient reached through two sub-recipes) are ONE task, done when all
 *  of their tins are. A row with no tins has nothing to tick: not a task. */
function tinLineTasks(lines: PrepTinLine[], completed: Set<string>, deferred: Set<string>) {
  let done = 0, total = 0, unitsDone = 0, unitsTotal = 0, deferredUnits = 0;
  for (const line of lines) {
    const byRecipe = new Map<number, { tins: number; resolved: number }>();
    for (const r of line.recipes) {
      const agg = byRecipe.get(r.recipeId) ?? { tins: 0, resolved: 0 };
      for (let tn = 1; tn <= r.tinCount; tn++) {
        const k = tickKey(line.isSubRecipe, line.ingredientId, r.recipeId, r.subRecipeOriginId ?? null, tn);
        agg.tins++;
        if (completed.has(k)) agg.resolved++;
        else if (deferred.has(k)) { agg.resolved++; deferredUnits++; }
      }
      byRecipe.set(r.recipeId, agg);
    }
    for (const agg of byRecipe.values()) {
      if (agg.tins <= 0) continue;
      total++;
      unitsTotal += agg.tins;
      unitsDone += agg.resolved;
      if (agg.resolved >= agg.tins) done++;
    }
  }
  return { done, total, units: { done: unitsDone, total: unitsTotal }, deferredUnits };
}

// ── Main Prep ───────────────────────────────────────────────────────────────

export interface MainPrepProgressInput {
  ingredients: PrepTinLine[];
  completions: PrepTick[];
  deferrals?: PrepTick[];
  /** Linked sub-rows by parent ingredient; rows with a `key` are tasks. */
  linkedItems?: Record<number, Array<{ key?: string }>>;
  /** Keys of linked rows ticked for this plan (/prep-linked-completions). */
  linkedDone: Iterable<string>;
}

export function mainPrepProgress(input: MainPrepProgressInput | null | undefined): SectionProgress {
  if (!input) return EMPTY;
  const t = tinLineTasks(input.ingredients, tickSet(input.completions), tickSet(input.deferrals));
  const linkedDone = new Set(input.linkedDone);
  // Linked rows only render under a parent row that is on the list.
  const onList = new Set(input.ingredients.filter(i => !i.isSubRecipe).map(i => i.ingredientId));
  let done = t.done, total = t.total;
  const seen = new Set<string>();
  for (const [parentId, rows] of Object.entries(input.linkedItems ?? {})) {
    if (!onList.has(Number(parentId))) continue;
    for (const row of rows) {
      if (!row.key || seen.has(row.key)) continue;
      seen.add(row.key);
      total++;
      if (linkedDone.has(row.key)) done++;
    }
  }
  return { done, total, units: t.units, deferredUnits: t.deferredUnits };
}

// ── Bases & Sauces ──────────────────────────────────────────────────────────

/** Rows the Bases & Sauces list shows. "Normal Base" is represented by the
 *  pinned Tomato Base item (the base sub-recipes), so it isn't listed again
 *  as a sauce — the station's existing rule, moved here so the list and the
 *  count share it. */
export const isBasesSauceLine = (line: { ingredientName: string }) =>
  !line.ingredientName.toLowerCase().includes("normal base");

/** Plan sub-recipes that count as bases on the Bases & Sauces station. */
export const isBaseSubRecipe = (sr: { isBase?: boolean | null }) => sr.isBase !== false;

export interface BasesProgressInput {
  /** /main-prep?station=prep_bases `ingredients[]` (unfiltered). */
  ingredients: PrepTinLine[];
  completions: PrepTick[];
  /** /sub-recipe-requirements `subRecipes[]` (unfiltered). */
  subRecipes: Array<{ subRecipeId: number; isBase?: boolean | null }>;
  /** Sub-recipe ids with a sub_recipe_completions row for this plan. */
  completedSubRecipeIds: Iterable<number>;
}

export function basesProgress(input: BasesProgressInput | null | undefined): SectionProgress {
  if (!input) return EMPTY;
  // The bases station has no defer control: a sauce is done when ticked.
  const sauces = tinLineTasks(input.ingredients.filter(isBasesSauceLine), tickSet(input.completions), new Set());
  const made = new Set(input.completedSubRecipeIds);
  const baseIds = [...new Set(input.subRecipes.filter(isBaseSubRecipe).map(s => s.subRecipeId))];
  const basesDone = baseIds.filter(id => made.has(id)).length;
  return {
    done: sauces.done + basesDone,
    total: sauces.total + baseIds.length,
    units: sauces.units,
    bases: { done: basesDone, total: baseIds.length },
  };
}

// ── Raw Meat ────────────────────────────────────────────────────────────────

export interface RawMeatProgressInput {
  /** /prep-requirements-by-recipe?station=prep_meat `recipes[]`. */
  recipes: Array<{
    recipeId: number;
    ingredients: Array<{ ingredientId: number; isRawMeat: boolean; trayCount: number | null }>;
  }>;
  completions: PrepTick[];
}

export function rawMeatProgress(input: RawMeatProgressInput | null | undefined): SectionProgress {
  if (!input) return EMPTY;
  // Meat trays are ticked as plain ingredient rows (no sub-recipe origin).
  const lines: PrepTinLine[] = [];
  for (const r of input.recipes) {
    for (const ing of r.ingredients) {
      if (!ing.isRawMeat || !ing.trayCount) continue;
      lines.push({ ingredientId: ing.ingredientId, ingredientName: "", recipes: [{ recipeId: r.recipeId, tinCount: ing.trayCount }] });
    }
  }
  const t = tinLineTasks(lines, tickSet(input.completions), new Set());
  return { done: t.done, total: t.total, units: t.units };
}

// ── Whole of prep ───────────────────────────────────────────────────────────

export interface PrepProgressInput {
  mainPrep: MainPrepProgressInput | null;
  bases: BasesProgressInput | null;
  rawMeat: RawMeatProgressInput | null;
}

export function prepProgress(input: PrepProgressInput): PrepProgress {
  const bySection: Record<PrepSectionKey, SectionProgress> = {
    main_prep: mainPrepProgress(input.mainPrep),
    prep_bases: basesProgress(input.bases),
    prep_meat: rawMeatProgress(input.rawMeat),
  };
  const done = bySection.main_prep.done + bySection.prep_bases.done + bySection.prep_meat.done;
  const total = bySection.main_prep.total + bySection.prep_bases.total + bySection.prep_meat.total;
  return { done, total, pct: progressPct({ done, total }), bySection };
}

/** Whole-number percent, capped at 100; 0 when there is nothing to do. */
export function progressPct(c: Count): number {
  return c.total > 0 ? Math.round((Math.min(c.done, c.total) / c.total) * 100) : 0;
}

/** "24 of 24 tasks" — the one wording every prep header uses. */
export function tasksLine(c: Count): string {
  return `${c.done} of ${c.total} task${c.total === 1 ? "" : "s"}`;
}
