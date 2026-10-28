/**
 * The nutrition table as the CUSTOMER sees it — row order, labels and
 * rounding — in one place for everything that prints or publishes one: the
 * website's nutrition image the test-box Shopify run makes (Objective A), the
 * preview beside it, and any label that later carries a table. Pure.
 *
 * Matches the nutrition images already on the website (read from the public
 * product pages, 28 Oct 2026 — e.g. Carnizone, Garlic & Cheese): "Typical
 * values | per 100g | per 355g serving", Energy in kJ then kcal on its own
 * line, "of which" rows indented, no space between number and unit, and the
 * UK/EU labelling-guidance rounding:
 *   - energy: whole kJ / kcal
 *   - fat, carbohydrate, sugars, fibre, protein, saturates: 10 g or more →
 *     whole grams; under 10 g → one decimal place ("4.0g", "0.2g"); a
 *     trace that rounds to nothing → "<0.1g"
 *   - salt: 1 g or more → one decimal ("1.1g", "4.0g"); under 1 g → two
 *     decimals ("0.45g"); a trace → "<0.01g"
 * Fibre is voluntary on a UK table and the website's images leave it out, so
 * it is marked optional (the planner's own screens still show it).
 */

export type NutritionKey = "energyKj" | "energyKcal" | "fat" | "saturates" | "carbohydrate" | "sugars" | "fibre" | "protein" | "salt";

export interface NutritionTableRow {
  key: NutritionKey;
  /** "" on the kcal line — it sits under "Energy". */
  label: string;
  unit: "kJ" | "kcal" | "g";
  /** An "of which …" line, drawn indented. */
  indent: boolean;
  /** Voluntary on a UK table; left off the website image. */
  optional: boolean;
}

export const NUTRITION_TABLE_ROWS: readonly NutritionTableRow[] = [
  { key: "energyKj", label: "Energy", unit: "kJ", indent: false, optional: false },
  { key: "energyKcal", label: "", unit: "kcal", indent: false, optional: false },
  { key: "fat", label: "Fat", unit: "g", indent: false, optional: false },
  { key: "saturates", label: "of which saturates", unit: "g", indent: true, optional: false },
  { key: "carbohydrate", label: "Carbohydrate", unit: "g", indent: false, optional: false },
  { key: "sugars", label: "of which sugars", unit: "g", indent: true, optional: false },
  { key: "fibre", label: "Fibre", unit: "g", indent: false, optional: true },
  { key: "protein", label: "Protein", unit: "g", indent: false, optional: false },
  { key: "salt", label: "Salt", unit: "g", indent: false, optional: false },
];

/** One value as printed: "1004kJ", "240kcal", "12g", "5.8g", "1.10g"→"1.1g", "—" when unknown. */
export function formatNutrient(key: NutritionKey | string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.max(0, value);
  if (key === "energyKj") return `${Math.round(v)}kJ`;
  if (key === "energyKcal") return `${Math.round(v)}kcal`;
  if (v === 0) return "0g";
  if (key === "salt") {
    if (v >= 0.995) return `${(Math.round(v * 10) / 10).toFixed(1)}g`;
    const two = Math.round(v * 100) / 100;
    return two === 0 ? "<0.01g" : `${two.toFixed(2)}g`;
  }
  const one = Math.round(v * 10) / 10;
  if (one >= 10) return `${Math.round(v)}g`;
  return one === 0 ? "<0.1g" : `${one.toFixed(1)}g`;
}

/** The table's column headings: "per 100g" and, with a portion weight, "per 355g" / "serving". */
export function nutritionHeadings(portionWeightG: number | null | undefined): { per100g: string; perPortion: [string, string] | null } {
  const w = Number(portionWeightG);
  return { per100g: "per 100g", perPortion: w > 0 ? [`per ${Math.round(w)}g`, "serving"] : null };
}
