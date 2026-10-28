/**
 * The tabs of the recipe AND sub-recipe editors, and the pure rules behind
 * them (Graeme, 28 Oct 2026: "build tabs on the edit recipe/subrecipe
 * dialogue … so it's much easier to find things"; "the subrecipe editing
 * should copy it exactly"). Objectives A and F.
 *
 *   • EDITOR_TABS — the one tab bar both editors show, in order. An editor
 *     fills a tab or leaves it out; it never renames or reorders them.
 *   • RECIPE_FIELD_TABS / SUB_RECIPE_FIELD_TABS — which tab each form field
 *     lives on, so a refused save can jump to the tab holding the first
 *     error and every tab can show how many errors it holds.
 *   • orderLines — the combined ingredients + sub-recipes table: one list
 *     drawn from the form's two separate arrays (the saved shape never
 *     changes), with rows added in this sitting kept at the bottom where
 *     the Add buttons are.
 *
 * Pure — tested in recipe-editor-tabs.test.ts.
 */

export type EditorTabId = "ingredients" | "details" | "production" | "label" | "more";

export const EDITOR_TABS: ReadonlyArray<{ id: EditorTabId; label: string }> = [
  { id: "ingredients", label: "Ingredients" },
  { id: "details", label: "Details" },
  { id: "production", label: "Production" },
  { id: "label", label: "Label & nutrition" },
  { id: "more", label: "More" },
];

/** The tab every editor opens on: the lines are "the bit I always scroll to first". */
export const DEFAULT_EDITOR_TAB: EditorTabId = "ingredients";

export type FieldTabs = Readonly<Record<string, EditorTabId>>;

/** Final products (pages/recipes.tsx) — every field of the form's schema. */
export const RECIPE_FIELD_TABS: FieldTabs = {
  ingredients: "ingredients",
  subRecipes: "ingredients",
  name: "details",
  category: "details",
  description: "details",
  tags: "details",
  servings: "details",
  servingUnit: "details",
  packSize: "details",
  shelfLifeDays: "details",
  cookingLossPercent: "details",
  dietaryCategory: "details",
  rrp: "details",
  packagingCost: "details",
  labourCost: "details",
  isCoreMenu: "details",
  isCurrentSpecial: "details",
  isFridgeProduct: "details",
  startAsDraft: "details",
  color: "details",
  secondaryColor: "details",
  notes: "details",
  portionsPerBatch: "production",
  targetBuildMinutes: "production",
  builderFillingDeductionGrams: "production",
  tinSize: "production",
  maxBatchesPerTin: "production",
  ovenTempC: "production",
  ovenTimeMinutes: "production",
  sopUrl: "production",
};

/** Sub-recipes (pages/sub-recipes.tsx) — every field of the form's schema. */
export const SUB_RECIPE_FIELD_TABS: FieldTabs = {
  ingredients: "ingredients",
  subRecipeComponents: "ingredients",
  name: "details",
  description: "details",
  yield: "details",
  yieldPercent: "details",
  yieldUnit: "details",
  shelfLifeDays: "details",
  notes: "details",
  isBase: "production",
  expandInPrep: "production",
  madeOnProductionDay: "production",
  prepOneTinPerRecipe: "production",
  labelDeclaration: "label",
};

/** The tab a field path ("ingredients.2.quantity", "name") lives on. */
export function tabOfField(path: string, fieldTabs: FieldTabs, fallback: EditorTabId = "details"): EditorTabId {
  const top = path.split(".")[0] ?? "";
  return fieldTabs[top] ?? fallback;
}

/** How many problems one react-hook-form error entry holds: a field's own
 *  message, plus each row of an array that has one. */
function countErrors(entry: unknown): number {
  if (entry == null || typeof entry !== "object") return 0;
  const e = entry as Record<string, unknown> & { message?: unknown; root?: { message?: unknown } };
  const own = typeof e.message === "string" && e.message ? 1 : 0;
  const root = typeof e.root?.message === "string" && e.root.message ? 1 : 0;
  // Array fields: one entry per row that has a problem (sparse array, or
  // an object keyed "0", "1"…).
  const rows = Object.entries(e).filter(([k, v]) => /^\d+$/.test(k) && v != null).length;
  const n = own + root + rows;
  // Anything else react-hook-form put there still counts as one problem.
  return n > 0 ? n : Object.keys(e).length > 0 ? 1 : 0;
}

/** Errors per tab, from react-hook-form's `formState.errors`. */
export function errorCountsByTab(
  errors: Record<string, unknown> | null | undefined,
  fieldTabs: FieldTabs,
  fallback: EditorTabId = "details",
): Partial<Record<EditorTabId, number>> {
  const out: Partial<Record<EditorTabId, number>> = {};
  for (const [field, entry] of Object.entries(errors ?? {})) {
    const n = countErrors(entry);
    if (n === 0) continue;
    const tab = tabOfField(field, fieldTabs, fallback);
    out[tab] = (out[tab] ?? 0) + n;
  }
  return out;
}

/** The first tab (in tab-bar order) that holds an error, or null. */
export function firstErrorTab(
  errors: Record<string, unknown> | null | undefined,
  fieldTabs: FieldTabs,
  fallback: EditorTabId = "details",
): EditorTabId | null {
  const counts = errorCountsByTab(errors, fieldTabs, fallback);
  for (const t of EDITOR_TABS) if ((counts[t.id] ?? 0) > 0) return t.id;
  return null;
}

/** The tabs to draw: every tab the editor gave content to, in bar order. */
export function visibleTabs(filled: Partial<Record<EditorTabId, boolean>>): EditorTabId[] {
  return EDITOR_TABS.filter(t => t.id === DEFAULT_EDITOR_TAB || filled[t.id]).map(t => t.id);
}

export type LineKind = "ingredient" | "subRecipe";
export type OrderedLine = { kind: LineKind; key: string; index: number };

/**
 * The combined table's row order. `ingredientKeys` / `subRecipeKeys` are the
 * stable ids of the rows in the form's two arrays (useFieldArray's field.id),
 * in array order; `added` is the keys of rows added in this sitting, oldest
 * first. Rows that were there when the editor opened come first (ingredients,
 * then sub-recipes — as saved), then the added ones in the order they were
 * added, whichever kind. `index` is the row's position in its own array.
 */
export function orderLines(ingredientKeys: readonly string[], subRecipeKeys: readonly string[], added: readonly string[]): OrderedLine[] {
  const addedSet = new Set(added);
  const ing = ingredientKeys.map((key, index) => ({ kind: "ingredient" as const, key, index }));
  const sub = subRecipeKeys.map((key, index) => ({ kind: "subRecipe" as const, key, index }));
  const byKey = new Map([...ing, ...sub].map(l => [l.key, l]));
  const original = [...ing, ...sub].filter(l => !addedSet.has(l.key));
  const fresh = added.map(k => byKey.get(k)).filter((l): l is OrderedLine => l != null);
  return [...original, ...fresh];
}
