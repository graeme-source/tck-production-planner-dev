/**
 * What the website should say about each product — UPF %, calories and
 * protein per portion, and the full nutrition table — as pure decisions,
 * no I/O. The runner
 * (upf-shopify-sync.ts) feeds it the live recipe facts, the recipe →
 * Shopify product links and what we last wrote, and applies the writes it
 * returns. Objective B.
 *
 * Rules (Graeme, 2026-10-22):
 *  - The planner is the source of truth: each figure is exactly what the
 *    Recipes page computes (UPF rollup; nutrition panel per portion).
 *  - Never publish a figure the planner itself doubts. Any unclassified
 *    ingredient holds back the UPF %; an ingredient missing its kcal (or
 *    protein) holds back that figure. The website then shows nothing for
 *    it rather than a wrong number. Each figure is held back on its own.
 *  - A product linked to more than one recipe has no single answer, so all
 *    its figures are held back.
 *  - A product that's no longer linked to any recipe loses its figures.
 *
 * No pack size (Graeme, 2026-10-27; migration 0286 — e.g. fried chicken,
 * sold by weight): the nutrition table goes up per 100 g only, as
 * { "per100gOnly": true, "per100g": {...} } with no perPortion / portion
 * weight, and the kcal / protein icons (which the theme labels "per
 * portion") are held back — a per 100 g number under a per-portion label
 * would be wrong. Recipes with a portion size are unchanged.
 */

export const WEBSITE_METRICS = ["upf", "kcal", "protein", "nutrition"] as const;
export type WebsiteMetric = (typeof WEBSITE_METRICS)[number];
/** Numbers for the icons; the nutrition table travels as a JSON string. */
export type FigureValue = number | string;

export const NUTRITION_KEYS = ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "fibre", "protein", "salt"] as const;
export type NutritionKey = (typeof NUTRITION_KEYS)[number];
export type NutritionValues = Record<NutritionKey, number | null>;

/** The recipe's nutrition panel as the Recipes page computes it.
 *  portionWeightG / perPortion are null for a recipe with no pack size. */
export interface NutritionPanel {
  portionWeightG: number | null;
  per100g: NutritionValues;
  perPortion: NutritionValues | null;
}

export interface RecipeFacts {
  recipeId: number;
  name: string;
  upfPercent: number | null;
  unclassifiedIngredients: string[];
  /** Per 100 g only (migration 0286): no per-portion icons, table per 100 g. */
  per100gOnly?: boolean;
  kcalPerPortion: number | null;
  proteinPerPortion: number | null;
  /** Ingredients with no kcal / no protein figure. */
  missingKcal: string[];
  missingProtein: string[];
  nutrition: NutritionPanel | null;
  /** Ingredients missing any nutrition value — holds back the whole table. */
  missingNutrition: string[];
}

export interface ProductLink {
  productGid: string;
  productTitle: string;
  recipeId: number;
}

/** What we last wrote for a product (null = removed / not there). */
export interface LedgerEntry {
  productGid: string;
  productTitle: string | null;
  published: Record<WebsiteMetric, FigureValue | null>;
}

export type ProductStatus = "linked" | "several_recipes" | "unlinked";

export interface MetricDecision {
  /** The figure the website should show; null = show nothing. */
  value: FigureValue | null;
  /** Why it's held back (plain English), when value is null. */
  heldBecause: string | null;
  /** True when Shopify needs a write (set or remove) to match. */
  needsWrite: boolean;
}

export interface ProductDecision {
  productGid: string;
  productTitle: string | null;
  recipeNames: string[];
  status: ProductStatus;
  metrics: Record<WebsiteMetric, MetricDecision>;
}

/**
 * One decimal place, but never round a real trace of UPF down to 0 — 0 is
 * what makes the website say "UPF free".
 */
export function websiteUpfPercent(percent: number): number {
  if (percent <= 0) return 0;
  const rounded = Math.round(percent * 10) / 10;
  return rounded === 0 ? 0.1 : Math.min(rounded, 100);
}

const list = (names: string[]) => [...names].sort().join(", ");

/** Each figure for one recipe: the value, or why it's held back. */
/** Label-style rounding: energy whole numbers, salt 2 dp, the rest 1 dp. */
function roundNutrient(key: NutritionKey, v: number): number {
  if (key === "energyKj" || key === "energyKcal") return Math.round(v);
  if (key === "salt") return Math.round(v * 100) / 100;
  return Math.round(v * 10) / 10;
}

/** The reason shown when a per-portion figure is held back by design. */
export const NO_PACK_SIZE_REASON = "no pack size — per 100 g only";

/**
 * The nutrition table as the JSON the theme reads (custom.nutrition_panel),
 * or null when any value is missing. Keys in a fixed order so an unchanged
 * recipe always produces the identical string (no needless writes).
 *
 * With per100gOnly the table is per 100 g only:
 * { "per100gOnly": true, "per100g": {...} } — no perPortion, no
 * portionWeightG, so the theme draws just the "Per 100g" column.
 */
export function nutritionPanelJson(panel: NutritionPanel, per100gOnly = false): string | null {
  const pick = (vals: NutritionValues): Record<NutritionKey, number> | null => {
    const out = {} as Record<NutritionKey, number>;
    for (const k of NUTRITION_KEYS) {
      const v = vals[k];
      if (v == null || !Number.isFinite(v) || v < 0) return null;
      out[k] = roundNutrient(k, v);
    }
    return out;
  };
  const per100g = pick(panel.per100g);
  if (per100gOnly) return per100g ? JSON.stringify({ per100gOnly: true, per100g }) : null;
  if (panel.portionWeightG == null || !(panel.portionWeightG > 0) || !panel.perPortion) return null;
  const perPortion = pick(panel.perPortion);
  if (!per100g || !perPortion) return null;
  return JSON.stringify({ portionWeightG: Math.round(panel.portionWeightG), per100g, perPortion });
}

/** True when a nutrition_panel JSON is the per 100 g-only shape. */
export function isPer100gOnlyPanel(json: string | null): boolean {
  if (!json) return false;
  try {
    const p = JSON.parse(json) as { per100gOnly?: unknown; perPortion?: unknown };
    return p.per100gOnly === true && p.perPortion == null;
  } catch {
    return false;
  }
}

/** A figure held back on purpose (no pack size), not for missing data. */
export function heldByDesign(heldBecause: string | null): boolean {
  return heldBecause === NO_PACK_SIZE_REASON;
}

type Figures = Record<WebsiteMetric, { value: FigureValue | null; heldBecause: string | null }>;

export function recipeFigures(r: RecipeFacts): Figures {
  const held = (why: string) => ({ value: null, heldBecause: why });
  const upf = r.upfPercent == null
    ? held("the recipe has no weighable ingredients")
    : r.unclassifiedIngredients.length > 0
      ? held(`not yet classified: ${list(r.unclassifiedIngredients)}`)
      : { value: websiteUpfPercent(r.upfPercent), heldBecause: null };
  // No pack size: the icons are per portion, so there's nothing honest to show.
  const kcal = r.per100gOnly
    ? held(NO_PACK_SIZE_REASON)
    : r.missingKcal.length > 0
    ? held(`no calories on: ${list(r.missingKcal)}`)
    : r.kcalPerPortion == null || r.kcalPerPortion <= 0
      ? held("no portion weight / nutrition yet")
      : { value: Math.round(r.kcalPerPortion), heldBecause: null };
  const protein = r.per100gOnly
    ? held(NO_PACK_SIZE_REASON)
    : r.missingProtein.length > 0
    ? held(`no protein on: ${list(r.missingProtein)}`)
    : r.proteinPerPortion == null || r.proteinPerPortion < 0 || r.kcalPerPortion == null || r.kcalPerPortion <= 0
      ? held("no portion weight / nutrition yet")
      : { value: Math.round(r.proteinPerPortion * 10) / 10, heldBecause: null };
  const panelJson = r.nutrition ? nutritionPanelJson(r.nutrition, r.per100gOnly === true) : null;
  const nutrition = r.missingNutrition.length > 0
    ? held(`missing nutrition on: ${list(r.missingNutrition)}`)
    : panelJson == null
      ? held("no portion weight / nutrition yet")
      : { value: panelJson, heldBecause: null };
  return { upf, kcal, protein, nutrition };
}

export function planWebsiteSync(
  recipes: RecipeFacts[],
  links: ProductLink[],
  ledger: LedgerEntry[],
): ProductDecision[] {
  const recipeById = new Map(recipes.map(r => [r.recipeId, r]));
  const ledgerByGid = new Map(ledger.map(l => [l.productGid, l]));

  const byProduct = new Map<string, { title: string; recipeIds: Set<number> }>();
  for (const link of links) {
    const p = byProduct.get(link.productGid) ?? { title: link.productTitle, recipeIds: new Set<number>() };
    p.recipeIds.add(link.recipeId);
    byProduct.set(link.productGid, p);
  }

  const metricsFor = (gid: string, figures: Figures): Record<WebsiteMetric, MetricDecision> => {
    const last = ledgerByGid.get(gid);
    const out = {} as Record<WebsiteMetric, MetricDecision>;
    for (const m of WEBSITE_METRICS) {
      // No ledger row = we don't know what Shopify holds, so write to be sure.
      out[m] = { ...figures[m], needsWrite: !last || last.published[m] !== figures[m].value };
    }
    return out;
  };
  const allHeld = (why: string) =>
    Object.fromEntries(WEBSITE_METRICS.map(m => [m, { value: null, heldBecause: why }])) as Record<WebsiteMetric, { value: null; heldBecause: string }>;

  const decisions: ProductDecision[] = [];
  for (const [gid, p] of byProduct) {
    const linked = [...p.recipeIds].map(id => recipeById.get(id)).filter((r): r is RecipeFacts => !!r);
    const recipeNames = linked.map(r => r.name).sort();
    if (linked.length === 0) {
      decisions.push({ productGid: gid, productTitle: p.title, recipeNames, status: "unlinked", metrics: metricsFor(gid, allHeld("not linked to a recipe")) });
    } else if (linked.length > 1) {
      decisions.push({ productGid: gid, productTitle: p.title, recipeNames, status: "several_recipes", metrics: metricsFor(gid, allHeld(`linked to more than one recipe (${recipeNames.join(", ")})`)) });
    } else {
      decisions.push({ productGid: gid, productTitle: p.title, recipeNames, status: "linked", metrics: metricsFor(gid, recipeFigures(linked[0])) });
    }
  }

  // Products we wrote before that no longer link to any recipe.
  for (const l of ledger) {
    if (byProduct.has(l.productGid)) continue;
    const metrics = {} as Record<WebsiteMetric, MetricDecision>;
    for (const m of WEBSITE_METRICS) {
      metrics[m] = { value: null, heldBecause: "not linked to a recipe", needsWrite: l.published[m] !== null };
    }
    decisions.push({ productGid: l.productGid, productTitle: l.productTitle, recipeNames: [], status: "unlinked", metrics });
  }

  return decisions.sort((a, b) => (a.productTitle ?? "").localeCompare(b.productTitle ?? ""));
}
