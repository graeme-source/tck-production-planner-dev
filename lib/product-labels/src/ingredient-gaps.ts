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
