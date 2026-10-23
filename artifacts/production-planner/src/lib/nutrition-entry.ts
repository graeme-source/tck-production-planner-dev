/**
 * Per-100g nutrition entry on the ingredient form — blank vs zero
 * (Graeme, 22 Oct 2026; objective G, website/product info).
 *
 * A blank box means "not entered" and is saved as null; a typed 0 is a real
 * value (soy sauce, vinegar: most nutrients genuinely 0) and is saved as 0.
 * The recipe nutrition panel and the website sync both treat null as missing
 * and 0 as entered, so the form must never blur the two. Zeros are only ever
 * filled in by an explicit tap on "Set the blank ones to 0".
 */

export const NUTRITION_FIELDS = [
  { field: "energyKj", label: "Energy (kJ)" },
  { field: "energyKcal", label: "Energy (kcal)" },
  { field: "fat", label: "Fat (g)" },
  { field: "saturates", label: "Saturates (g)" },
  { field: "carbohydrate", label: "Carbs (g)" },
  { field: "sugars", label: "Sugars (g)" },
  { field: "protein", label: "Protein (g)" },
  { field: "fibre", label: "Fibre (g)" },
  { field: "salt", label: "Salt (g)" },
] as const;

export type NutritionField = (typeof NUTRITION_FIELDS)[number]["field"];

/** True when a box holds nothing — never true for 0 or "0". */
export function isNutritionBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

/** Form input → stored value: blank → null, "0" / "0.00" → 0, "2.5" → 2.5.
 *  Anything non-numeric comes back NaN so the zod number check rejects it. */
export function nutritionInputToValue(v: unknown): number | null {
  if (isNutritionBlank(v)) return null;
  return typeof v === "number" ? v : Number(String(v).trim());
}

/** The nutrition boxes that are still blank (not entered). */
export function blankNutritionFields(values: Partial<Record<NutritionField, unknown>>): NutritionField[] {
  return NUTRITION_FIELDS.map(f => f.field).filter(f => isNutritionBlank(values[f]));
}

/** Offer "Set the blank ones to 0" only when something has been entered
 *  (so it's a real label being copied) and something is still blank. */
export function shouldOfferFillBlanks(values: Partial<Record<NutritionField, unknown>>): boolean {
  const blanks = blankNutritionFields(values).length;
  return blanks > 0 && blanks < NUTRITION_FIELDS.length;
}

/** The updates for "Set the blank ones to 0": a 0 for each blank box only —
 *  boxes already holding a value (including 0) are left alone. */
export function fillBlankNutritionWithZero(values: Partial<Record<NutritionField, unknown>>): Partial<Record<NutritionField, 0>> {
  const out: Partial<Record<NutritionField, 0>> = {};
  for (const f of blankNutritionFields(values)) out[f] = 0;
  return out;
}
