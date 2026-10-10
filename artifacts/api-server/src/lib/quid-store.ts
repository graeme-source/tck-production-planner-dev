/**
 * Automatic QUID — the database half (Graeme, 2026-10-10). Objectives A, D.
 * The rules are pure and tested: lib/quid-matcher.ts (which lines the name
 * names) and lib/quid-plan.ts (what to write; a person's tick always wins).
 *
 * reconcileRecipeQuid() runs inside every recipe create/update transaction
 * (routes/recipes.ts), after a sub-recipe or ingredient is edited (for the
 * recipes that use it), after a person answers a question in the recipe's
 * QUID panel, and from the backfill (dry run unless told to apply).
 * Percentages are never stored: the deck works them out from live weights
 * every time, so a weight change is on the label straight away.
 */
import { db, recipesTable, recipeIngredientsTable, recipeSubRecipesTable, ingredientsTable, subRecipesTable, subRecipeIngredientsTable, subRecipeSubRecipesTable, quidTermsTable, recipeQuidComponentsTable } from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { matchQuid, quidTargetKey, parseQuidKey, type QuidComponentInput, type QuidDecision, type QuidLineInput, type QuidMatchResult, type QuidTerm, type QuidTermMode } from "./quid-matcher";
import { planQuid, type QuidPlan, type QuidSource, type QuidState } from "./quid-plan";
import { buildRecipeIngredientDeck } from "./recipe-ingredient-deck";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

export async function loadQuidTerms(exec: Exec = db): Promise<QuidTerm[]> {
  const rows = await exec.select().from(quidTermsTable).orderBy(asc(quidTermsTable.id));
  return rows.map(r => ({
    phrase: r.phrase,
    mode: r.mode as QuidTermMode,
    targets: r.targets ?? [],
    categories: r.categories ?? [],
    isCategory: r.isCategory,
  }));
}

/** A sub-recipe's ingredients with nested sub-recipes flattened (each
 *  ingredient once). Names only — the matcher needs no weights. */
async function flattenComponents(exec: Exec, subRecipeId: number, path: Set<number>, cache: Map<number, QuidComponentInput[]>): Promise<QuidComponentInput[]> {
  const cached = cache.get(subRecipeId);
  if (cached) return cached;
  if (path.has(subRecipeId)) return [];
  path.add(subRecipeId);
  const direct = await exec
    .select({ ingredientId: ingredientsTable.id, name: ingredientsTable.name, declaration: ingredientsTable.labelDeclaration, category: ingredientsTable.category })
    .from(subRecipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(subRecipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(subRecipeIngredientsTable.subRecipeId, subRecipeId));
  const nested = await exec
    .select({ id: subRecipeSubRecipesTable.componentSubRecipeId })
    .from(subRecipeSubRecipesTable)
    .where(eq(subRecipeSubRecipesTable.subRecipeId, subRecipeId));
  const out = new Map<number, QuidComponentInput>();
  for (const d of direct) out.set(d.ingredientId, d);
  for (const n of nested) {
    for (const c of await flattenComponents(exec, n.id, path, cache)) if (!out.has(c.ingredientId)) out.set(c.ingredientId, c);
  }
  path.delete(subRecipeId);
  const list = [...out.values()];
  cache.set(subRecipeId, list);
  return list;
}

export interface RecipeQuidData {
  recipe: { id: number; name: string; archived: boolean; isDraft: boolean };
  lines: QuidLineInput[];
  current: Map<string, QuidState>;
  labels: Map<string, string>;
}

const merge = (a: QuidState | undefined, quid: boolean, source: string | null): QuidState => {
  const src: QuidSource = source === "manual" || source === "auto" ? source : null;
  if (!a) return { quid, source: src };
  // The same ingredient on two lines: ticked if either is; a person's
  // decision on either line counts for both.
  const rank = (s: QuidSource) => (s === "manual" ? 2 : s === "auto" ? 1 : 0);
  return { quid: a.quid || quid, source: rank(src) > rank(a.source) ? src : a.source };
};

export async function loadRecipeQuid(exec: Exec, recipeId: number): Promise<RecipeQuidData | null> {
  const [recipe] = await exec
    .select({ id: recipesTable.id, name: recipesTable.name, archivedAt: recipesTable.archivedAt, isDraft: recipesTable.isDraft })
    .from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!recipe) return null;

  const ingRows = await exec
    .select({ id: ingredientsTable.id, name: ingredientsTable.name, declaration: ingredientsTable.labelDeclaration, category: ingredientsTable.category, quid: recipeIngredientsTable.quid, source: recipeIngredientsTable.quidSource })
    .from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(recipeIngredientsTable.ingredientId, ingredientsTable.id))
    .where(eq(recipeIngredientsTable.recipeId, recipeId))
    .orderBy(asc(recipeIngredientsTable.id));
  const subRows = await exec
    .select({ id: subRecipesTable.id, name: subRecipesTable.name, declaration: subRecipesTable.labelDeclaration, quid: recipeSubRecipesTable.quid, source: recipeSubRecipesTable.quidSource })
    .from(recipeSubRecipesTable)
    .innerJoin(subRecipesTable, eq(recipeSubRecipesTable.subRecipeId, subRecipesTable.id))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId))
    .orderBy(asc(recipeSubRecipesTable.id));
  const compRows = await exec.select().from(recipeQuidComponentsTable).where(eq(recipeQuidComponentsTable.recipeId, recipeId));

  const lines: QuidLineInput[] = [];
  const current = new Map<string, QuidState>();
  const labels = new Map<string, string>();
  const seen = new Set<string>();
  for (const r of ingRows) {
    const key = `i:${r.id}`;
    current.set(key, merge(current.get(key), r.quid, r.source));
    if (seen.has(key)) continue;
    seen.add(key);
    labels.set(key, r.name.trim());
    lines.push({ kind: "ingredient", id: r.id, name: r.name, declaration: r.declaration, category: r.category });
  }
  const cache = new Map<number, QuidComponentInput[]>();
  for (const r of subRows) {
    const key = `s:${r.id}`;
    current.set(key, merge(current.get(key), r.quid, r.source));
    if (seen.has(key)) continue;
    seen.add(key);
    labels.set(key, r.name.trim());
    const components = await flattenComponents(exec, r.id, new Set(), cache);
    for (const c of components) labels.set(`c:${r.id}:${c.ingredientId}`, `${c.name.trim()} in ${r.name.trim()}`);
    lines.push({ kind: "subRecipe", id: r.id, name: r.name, declaration: r.declaration, category: null, components });
  }
  const subIds = new Set(subRows.map(r => r.id));
  for (const c of compRows) {
    // A decision about a sub-recipe that's no longer in the recipe is kept
    // (it comes back if the line does) but plays no part meanwhile.
    if (!subIds.has(c.subRecipeId)) continue;
    current.set(`c:${c.subRecipeId}:${c.ingredientId}`, { quid: c.quid, source: c.source === "manual" ? "manual" : "auto" });
  }
  return { recipe: { id: recipe.id, name: recipe.name, archived: recipe.archivedAt != null, isDraft: recipe.isDraft }, lines, current, labels };
}

/** Each line's stored QUID before a recipe save deletes and re-inserts the
 *  lines — carried through by carryQuid(). */
export async function snapshotLineQuid(exec: Exec, recipeId: number): Promise<{ ing: Map<number, QuidState>; sub: Map<number, QuidState> }> {
  const ing = new Map<number, QuidState>();
  const sub = new Map<number, QuidState>();
  for (const r of await exec.select({ id: recipeIngredientsTable.ingredientId, quid: recipeIngredientsTable.quid, source: recipeIngredientsTable.quidSource })
    .from(recipeIngredientsTable).where(eq(recipeIngredientsTable.recipeId, recipeId))) ing.set(r.id, merge(ing.get(r.id), r.quid, r.source));
  for (const r of await exec.select({ id: recipeSubRecipesTable.subRecipeId, quid: recipeSubRecipesTable.quid, source: recipeSubRecipesTable.quidSource })
    .from(recipeSubRecipesTable).where(eq(recipeSubRecipesTable.recipeId, recipeId))) sub.set(r.id, merge(sub.get(r.id), r.quid, r.source));
  return { ing, sub };
}

async function writeState(exec: Exec, recipeId: number, key: string, to: QuidState, actorName: string | null) {
  const t = parseQuidKey(key);
  if (!t) return;
  if (t.kind === "ingredient") {
    await exec.update(recipeIngredientsTable).set({ quid: to.quid, quidSource: to.source })
      .where(and(eq(recipeIngredientsTable.recipeId, recipeId), eq(recipeIngredientsTable.ingredientId, t.ingredientId)));
  } else if (t.kind === "subRecipe") {
    await exec.update(recipeSubRecipesTable).set({ quid: to.quid, quidSource: to.source })
      .where(and(eq(recipeSubRecipesTable.recipeId, recipeId), eq(recipeSubRecipesTable.subRecipeId, t.subRecipeId)));
  } else if (to.source == null) {
    await exec.delete(recipeQuidComponentsTable).where(and(
      eq(recipeQuidComponentsTable.recipeId, recipeId),
      eq(recipeQuidComponentsTable.subRecipeId, t.subRecipeId),
      eq(recipeQuidComponentsTable.ingredientId, t.ingredientId),
    ));
  } else {
    await exec.insert(recipeQuidComponentsTable)
      .values({ recipeId, subRecipeId: t.subRecipeId, ingredientId: t.ingredientId, quid: to.quid, source: to.source, updatedByName: actorName })
      .onConflictDoUpdate({
        target: [recipeQuidComponentsTable.recipeId, recipeQuidComponentsTable.subRecipeId, recipeQuidComponentsTable.ingredientId],
        set: { quid: to.quid, source: to.source, updatedAt: new Date(), updatedByName: actorName },
      });
  }
}

export interface ReconcileResult {
  data: RecipeQuidData;
  match: QuidMatchResult;
  plan: QuidPlan;
}

/** Re-run the matcher for one recipe and (when `apply`) write the result. */
export async function reconcileRecipeQuid(exec: Exec, recipeId: number, opts: { apply: boolean; actorName?: string | null; terms?: QuidTerm[] }): Promise<ReconcileResult | null> {
  const data = await loadRecipeQuid(exec, recipeId);
  if (!data) return null;
  const terms = opts.terms ?? await loadQuidTerms(exec);
  const match = matchQuid(data.recipe.name, data.lines, terms);
  const plan = planQuid(data.current, match.decisions);
  if (opts.apply) {
    for (const ch of plan.changes) await writeState(exec, recipeId, ch.key, ch.to, opts.actorName ?? "Automatic QUID");
  }
  return { data, match, plan };
}

/** A person's answer: tick (true), untick (false) — both "manual", never
 *  overwritten — or null = "back to automatic" (forget the answer, then let
 *  the matcher decide again). */
export async function setQuidDecision(recipeId: number, key: string, quid: boolean | null, actorName: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const to: QuidState = quid == null ? { quid: false, source: null } : { quid, source: "manual" };
    await writeState(tx, recipeId, key, to, actorName);
    await reconcileRecipeQuid(tx, recipeId, { apply: true, actorName });
  });
}

/** Every recipe that uses a sub-recipe or ingredient, directly or through
 *  nested sub-recipes — the ones to recheck when it is renamed or changed. */
export async function recipesUsing(target: { subRecipeId?: number; ingredientId?: number }): Promise<number[]> {
  const seed = target.subRecipeId != null
    ? sql`SELECT ${target.subRecipeId}::int AS id`
    : sql`SELECT sub_recipe_id AS id FROM sub_recipe_ingredients WHERE ingredient_id = ${target.ingredientId ?? -1}`;
  const rows = await db.execute<{ recipe_id: number }>(sql`
    WITH RECURSIVE subs(id) AS (
      ${seed}
      UNION
      SELECT ssr.sub_recipe_id FROM sub_recipe_sub_recipes ssr JOIN subs ON ssr.component_sub_recipe_id = subs.id
    )
    SELECT DISTINCT recipe_id FROM recipe_sub_recipes WHERE sub_recipe_id IN (SELECT id FROM subs)
    UNION
    SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = ${target.ingredientId ?? -1}
  `);
  return rows.rows.map(r => Number(r.recipe_id));
}

/** After a sub-recipe or ingredient edit: recheck the recipes that use it. */
export async function reconcileRecipesUsing(target: { subRecipeId?: number; ingredientId?: number }, actorName: string | null): Promise<void> {
  const ids = await recipesUsing(target);
  if (!ids.length) return;
  const terms = await loadQuidTerms();
  for (const id of ids) {
    await db.transaction(tx => reconcileRecipeQuid(tx, id, { apply: true, actorName, terms }));
  }
}

// ── What the recipe editor's QUID panel shows ────────────────────────────

export interface QuidViewItem {
  key: string;
  kind: "ingredient" | "subRecipe" | "component";
  label: string;
  quid: boolean;
  source: QuidSource;
  /** Present when the name names it: the words, and auto vs question. */
  match: { term: string; level: "auto" | "suggest"; isCategory: boolean } | null;
}

export interface QuidView {
  recipeId: number;
  recipeName: string;
  items: QuidViewItem[];
  suggestions: Array<{ key: string; label: string; term: string }>;
  unmatched: string[];
  unwrapped: string[];
  deckText: string;
}

export async function recipeQuidView(recipeId: number): Promise<QuidView | null> {
  const data = await loadRecipeQuid(db, recipeId);
  if (!data) return null;
  const match = matchQuid(data.recipe.name, data.lines, await loadQuidTerms());
  const plan = planQuid(data.current, match.decisions);
  const byKey = new Map(match.decisions.map(d => [d.key, d]));
  const item = (key: string, kind: QuidViewItem["kind"]): QuidViewItem => {
    const st = data.current.get(key) ?? { quid: false, source: null };
    const d = byKey.get(key);
    return { key, kind, label: data.labels.get(key) ?? key, quid: st.quid, source: st.source, match: d ? { term: d.term, level: d.level, isCategory: d.isCategory } : null };
  };
  const items: QuidViewItem[] = [];
  for (const l of data.lines) {
    if (l.kind === "ingredient") { items.push(item(`i:${l.id}`, "ingredient")); continue; }
    items.push(item(`s:${l.id}`, "subRecipe"));
    for (const c of l.components ?? []) {
      const key = `c:${l.id}:${c.ingredientId}`;
      // Inside a sub-recipe: only what's ticked, decided or named.
      if (data.current.has(key) || byKey.has(key)) items.push(item(key, "component"));
    }
  }
  const deck = await buildRecipeIngredientDeck(recipeId);
  return {
    recipeId,
    recipeName: data.recipe.name,
    items,
    suggestions: plan.suggestions.map(d => ({ key: d.key, label: d.label, term: d.term })),
    unmatched: match.unmatched,
    unwrapped: unwrappedTicked(deck.unwrappedDeclarations, items.filter(i => i.quid).map(i => i.label)),
    deckText: deck.deckText,
  };
}

// ── Backfill: every non-archived recipe ──────────────────────────────────

export interface BackfillRecipe {
  recipeId: number;
  name: string;
  isDraft: boolean;
  ticks: Array<{ key: string; label: string; term: string; from: QuidState; to: QuidState }>;
  unticks: Array<{ key: string; label: string; from: QuidState }>;
  kept: Array<{ key: string; label: string; state: QuidState }>;
  suggestions: Array<{ key: string; label: string; term: string }>;
  unmatched: string[];
  /** Ticked ingredients whose declaration is a bare list, not "Name (…)" —
   *  the percentage lands on the end of the list and reads wrong until the
   *  declaration is fixed (labels already refuse to publish these). */
  unwrapped: string[];
  deckBefore: string;
  deckAfter: string;
}

/** Of the deck's unwrapped declarations, the ones on a ticked line. */
function unwrappedTicked(deckUnwrapped: string[], tickedLabels: string[]): string[] {
  const names = new Set(tickedLabels.map(l => l.split(" in ")[0].trim().toLowerCase()));
  return deckUnwrapped.filter(n => names.has(n.trim().toLowerCase()));
}

export async function quidBackfill(opts: { apply: boolean; actorName: string | null }): Promise<{ applied: boolean; recipes: BackfillRecipe[] }> {
  const terms = await loadQuidTerms();
  const recipes = await db.select({ id: recipesTable.id }).from(recipesTable).where(isNull(recipesTable.archivedAt)).orderBy(asc(recipesTable.id));
  const out: BackfillRecipe[] = [];
  for (const { id } of recipes) {
    const r = await reconcileRecipeQuid(db, id, { apply: false, terms });
    if (!r) continue;
    const deckBefore = (await buildRecipeIngredientDeck(id)).deckText;
    const after = new Set([...r.plan.next].filter(([, s]) => s.quid).map(([k]) => k));
    const deckAfterFull = await buildRecipeIngredientDeck(id, { quidOverride: after });
    const deckAfter = deckAfterFull.deckText;
    if (opts.apply && r.plan.changes.length) {
      await db.transaction(async tx => {
        // Re-plan inside the transaction so a save made meanwhile is respected.
        await reconcileRecipeQuid(tx, id, { apply: true, actorName: opts.actorName ?? "QUID backfill", terms });
      });
    }
    const label = (k: string) => r.data.labels.get(k) ?? k;
    out.push({
      recipeId: id,
      name: r.data.recipe.name,
      isDraft: r.data.recipe.isDraft,
      ticks: r.plan.changes.filter(c => c.to.quid).map(c => ({ key: c.key, label: label(c.key), term: c.decision?.term ?? "", from: c.from, to: c.to })),
      unticks: r.plan.changes.filter(c => !c.to.quid && c.from.quid).map(c => ({ key: c.key, label: label(c.key), from: c.from })),
      kept: [...r.plan.next].filter(([k, s]) => s.quid && !r.plan.changes.some(c => c.key === k)).map(([k, s]) => ({ key: k, label: label(k), state: s })),
      suggestions: r.plan.suggestions.map((d: QuidDecision) => ({ key: d.key, label: label(d.key), term: d.term })),
      unmatched: r.match.unmatched,
      unwrapped: unwrappedTicked(deckAfterFull.unwrappedDeclarations, [...after].map(label)),
      deckBefore,
      deckAfter,
    });
  }
  return { applied: opts.apply, recipes: out };
}

/** The backfill as plain text — what the script prints and the admin
 *  endpoint returns, so Graeme reviews the same thing either way. */
export function formatBackfill(report: { applied: boolean; recipes: BackfillRecipe[] }): string {
  const lines: string[] = [];
  const strip = (s: string) => s.replace(/\*\*/g, "");
  lines.push(report.applied ? "QUID backfill — APPLIED" : "QUID backfill — DRY RUN (nothing written)");
  const changed = report.recipes.filter(r => r.ticks.length || r.unticks.length).length;
  const asking = report.recipes.filter(r => r.suggestions.length).length;
  lines.push(`${report.recipes.length} recipes checked · ${changed} would change · ${asking} with questions`);
  for (const r of report.recipes) {
    lines.push("");
    lines.push(`#${r.recipeId} ${r.name.trim()}${r.isDraft ? " (draft)" : ""}`);
    if (!r.ticks.length && !r.unticks.length && !r.kept.length && !r.suggestions.length && !r.unmatched.length && !r.unwrapped.length) {
      lines.push("  nothing named — no percentages");
      continue;
    }
    for (const t of r.ticks) lines.push(`  + tick (auto)  ${t.label}  — named: "${t.term}"`);
    for (const t of r.unticks) lines.push(`  - untick       ${t.label}  (was ${t.from.source ?? "unset"})`);
    for (const k of r.kept) lines.push(`  = keep         ${k.label}  (${k.state.source === "manual" ? "set by a person" : "already auto"})`);
    for (const s of r.suggestions) lines.push(`  ? ask          Should "${s.term}" show a percentage? → ${s.label}`);
    for (const u of r.unmatched) lines.push(`  ! "${u}" is in the name but no line matches it — tick by hand if it's in there`);
    for (const u of r.unwrapped) lines.push(`  ! ${u}: its label declaration is a bare list, not "Name (…)" — the percentage reads wrong until it's fixed`);
    if (r.deckAfter !== r.deckBefore) lines.push(`  deck after: ${strip(r.deckAfter)}`);
    else lines.push(`  deck (unchanged): ${strip(r.deckAfter)}`);
  }
  return lines.join("\n");
}

export { quidTargetKey };
