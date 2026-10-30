/**
 * Which facts an ingredient record is still missing — the ONE rule shared by
 * the recipe nutrition panel (api-server computeRecipeNutritionals →
 * missingNutritionalDetail), the UPF roll-up ("unclassified") and the amber
 * "No nutrition" / "No UPF class" chips on each recipe and sub-recipe editor
 * row (Graeme, 2026-10-23). Objective G.
 *
 *   • Nutrition: missing when ANY per-100 g value is blank. Blank means null,
 *     undefined or an empty string — 0 is a real, entered value.
 *   • UPF: missing when the NOVA class is blank (null/undefined).
 */

/** The nine per-100 g values on a UK nutrition panel. */
export const NUTRIENT_KEYS = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"] as const;
export type NutrientKey = typeof NUTRIENT_KEYS[number];

type Blankable = number | string | null | undefined;

function isBlank(v: Blankable): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** The nutrients this ingredient has no value for (0 counts as entered). */
export function missingNutrients(row: Partial<Record<NutrientKey, Blankable>>): NutrientKey[] {
  return NUTRIENT_KEYS.filter(k => isBlank(row[k]));
}

/** No NOVA class yet, so the recipe's UPF figure can't be trusted. */
export function isNovaUnclassified(novaClass: number | null | undefined): boolean {
  return novaClass == null;
}

export interface IngredientGapChip {
  kind: "nutrition" | "upf";
  label: string;
  /** Hover / long-press detail. */
  title: string;
}

const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  energyKj: "energy (kJ)", energyKcal: "energy (kcal)", fat: "fat", saturates: "saturates",
  carbohydrate: "carbohydrate", sugars: "sugars", fibre: "fibre", protein: "protein", salt: "salt",
};

/** The amber chips an editor row shows for this ingredient (none = complete). */
export function ingredientGapChips(
  row: Partial<Record<NutrientKey, Blankable>> & { novaClass?: number | null },
): IngredientGapChip[] {
  const chips: IngredientGapChip[] = [];
  const missing = missingNutrients(row);
  if (missing.length > 0) {
    chips.push({
      kind: "nutrition",
      label: "No nutrition",
      title: `Missing ${missing.map(k => NUTRIENT_LABEL[k]).join(", ")} — open it to fill these in`,
    });
  }
  if (isNovaUnclassified(row.novaClass)) {
    chips.push({ kind: "upf", label: "No UPF class", title: "No NOVA / UPF class yet — open it to set one" });
  }
  return chips;
}

// ── Missing nutrition and label declarations, per ingredient ────────────────
// The SAME facts the recipe's Label tab warns about — the nutrition panel's
// "Missing nutritionals" (computeRecipeNutritionals → missingNutritionalDetail,
// built with missingNutrients above) and the ingredient deck's "Missing label
// declarations" / "Compound ingredients not named" (recipe-ingredient-deck.ts)
// — merged into one line per ingredient, sub-recipe ingredients included.
// Used by "Create Shopify product" (Graeme, 30 Oct 2026: "flag if there are
// any nutritional or label declarations missing from any of the ingredients
// or sub-ingredients … it should explicitly warn me").

export interface IngredientGap {
  ingredientId: number | null;
  name: string;
  /** What's missing, in words: "no nutrition data", "nutrition: fat, salt",
   *  "no label declaration", "declaration doesn't name the compound ingredient". */
  missing: string[];
  nutrition: boolean;
  declaration: boolean;
}

/** One line per ingredient with something missing, in the order met
 *  (nutrition gaps first, then declaration gaps). Merged by id, else name. */
export function ingredientDeclarationGaps(input: {
  nutrition?: ReadonlyArray<{ ingredientId?: number | null; name: string; missing: readonly string[] }> | null;
  missingDeclarations?: ReadonlyArray<{ ingredientId?: number | null; name: string }> | null;
  unwrappedDeclarations?: readonly string[] | null;
}): IngredientGap[] {
  const out: IngredientGap[] = [];
  const find = (id: number | null | undefined, name: string): IngredientGap => {
    const key = name.trim().toLowerCase();
    let g = out.find(x => (id != null && x.ingredientId === id) || x.name.trim().toLowerCase() === key);
    if (!g) {
      g = { ingredientId: id ?? null, name: name.trim(), missing: [], nutrition: false, declaration: false };
      out.push(g);
    } else if (g.ingredientId == null && id != null) {
      g.ingredientId = id;
    }
    return g;
  };
  const add = (g: IngredientGap, text: string) => { if (!g.missing.includes(text)) g.missing.push(text); };
  const isKey = (k: string): k is NutrientKey => (NUTRIENT_KEYS as readonly string[]).includes(k);
  for (const n of input.nutrition ?? []) {
    if (!n.missing.length) continue;
    const g = find(n.ingredientId, n.name);
    g.nutrition = true;
    const known = n.missing.filter(isKey);
    add(g, known.length >= NUTRIENT_KEYS.length ? "no nutrition data" : `nutrition: ${n.missing.map(k => (isKey(k) ? NUTRIENT_LABEL[k] : k)).join(", ")}`);
  }
  for (const d of input.missingDeclarations ?? []) {
    const g = find(d.ingredientId, d.name);
    g.declaration = true;
    add(g, "no label declaration");
  }
  for (const name of input.unwrappedDeclarations ?? []) {
    const g = find(null, name);
    g.declaration = true;
    add(g, "declaration doesn't name the compound ingredient");
  }
  return out;
}

/** "Mozzarella — nutrition: fat, salt; no label declaration" */
export function ingredientGapLine(g: Pick<IngredientGap, "name" | "missing">): string {
  return `${g.name} — ${g.missing.join("; ")}`;
}
