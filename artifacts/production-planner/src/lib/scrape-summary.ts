/**
 * The one-line "what did the product-URL scrape find" summary on the
 * ingredient form (Graeme, 23 Oct 2026 — objective G): "Found: nutrition 9/9,
 * ingredients, 1 allergen, UPF: NOVA 4 — modified starch", plus the fields
 * still missing (shown amber so they're filled in before saving). Pure.
 */
import { ALLERGEN_DISPLAY } from "@workspace/allergens";

export type FieldSource = "parsed" | "ai" | "missing";

export const SCRAPE_NUTRIENTS = [
  "energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "fibre", "salt",
] as const;

export const SCRAPE_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  packSize: "Pack size",
  packUnit: "Unit",
  costPerPack: "Price",
  supplierPartNumber: "Product code",
  ingredients: "Ingredient declaration",
  allergens: "Allergens",
  energyKj: "Energy (kJ)",
  energyKcal: "Energy (kcal)",
  fat: "Fat",
  saturates: "Saturates",
  carbohydrate: "Carbs",
  sugars: "Sugars",
  protein: "Protein",
  fibre: "Fibre",
  salt: "Salt",
};

export interface ScrapeUpf {
  novaClass: number | null;
  markers: string[];
  reasoning: string;
  confidence: string;
  method: "ai" | "markers";
}

export interface ScrapeSummary {
  /** "Found: nutrition 9/9, ingredients, 1 allergen (Milk), UPF: NOVA 4 — modified starch" */
  text: string;
  /** Labels of fields the scrape couldn't find, for the amber list. */
  missing: string[];
  /** Field key → where it came from, for the per-field chips. */
  sources: Record<string, FieldSource>;
  usedAi: boolean;
}

export function summariseScrape(
  sources: Record<string, FieldSource> | undefined,
  allergens: string[],
  upf: ScrapeUpf | null | undefined,
): ScrapeSummary {
  const src = sources ?? {};
  const found: string[] = [];
  const nutrientsFound = SCRAPE_NUTRIENTS.filter(k => src[k] && src[k] !== "missing").length;
  found.push(`nutrition ${nutrientsFound}/${SCRAPE_NUTRIENTS.length}`);
  if (src["ingredients"] && src["ingredients"] !== "missing") found.push("ingredients");
  if (src["allergens"] && src["allergens"] !== "missing") {
    const names = allergens.map(a => ALLERGEN_DISPLAY[a] ?? a);
    found.push(allergens.length === 0
      ? "no allergens"
      : `${allergens.length} allergen${allergens.length === 1 ? "" : "s"} (${names.join(", ")})`);
  }
  if (upf && upf.novaClass != null) {
    found.push(`UPF: NOVA ${upf.novaClass}${upf.novaClass === 4 && upf.markers.length ? ` — ${upf.markers.slice(0, 4).join(", ")}` : ""}`);
  } else if (src["ingredients"] && src["ingredients"] !== "missing") {
    found.push("UPF: not worked out yet — it will be on save");
  }
  const missing = Object.keys(SCRAPE_FIELD_LABELS)
    .filter(k => k !== "packUnit" && src[k] === "missing")
    .map(k => SCRAPE_FIELD_LABELS[k]);
  return {
    text: `Found: ${found.join(", ")}`,
    missing,
    sources: src,
    usedAi: Object.values(src).some(s => s === "ai"),
  };
}
