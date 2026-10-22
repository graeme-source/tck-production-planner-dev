/**
 * What the website should say about each product — UPF %, calories and
 * protein per portion — as pure decisions, no I/O. The runner
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
 */

export const WEBSITE_METRICS = ["upf", "kcal", "protein"] as const;
export type WebsiteMetric = (typeof WEBSITE_METRICS)[number];

export interface RecipeFacts {
  recipeId: number;
  name: string;
  upfPercent: number | null;
  unclassifiedIngredients: string[];
  kcalPerPortion: number | null;
  proteinPerPortion: number | null;
  /** Ingredients with no kcal / no protein figure. */
  missingKcal: string[];
  missingProtein: string[];
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
  published: Record<WebsiteMetric, number | null>;
}

export type ProductStatus = "linked" | "several_recipes" | "unlinked";

export interface MetricDecision {
  /** The figure the website should show; null = show nothing. */
  value: number | null;
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
export function recipeFigures(r: RecipeFacts): Record<WebsiteMetric, { value: number | null; heldBecause: string | null }> {
  const held = (why: string) => ({ value: null, heldBecause: why });
  const upf = r.upfPercent == null
    ? held("the recipe has no weighable ingredients")
    : r.unclassifiedIngredients.length > 0
      ? held(`not yet classified: ${list(r.unclassifiedIngredients)}`)
      : { value: websiteUpfPercent(r.upfPercent), heldBecause: null };
  const kcal = r.missingKcal.length > 0
    ? held(`no calories on: ${list(r.missingKcal)}`)
    : r.kcalPerPortion == null || r.kcalPerPortion <= 0
      ? held("no portion weight / nutrition yet")
      : { value: Math.round(r.kcalPerPortion), heldBecause: null };
  const protein = r.missingProtein.length > 0
    ? held(`no protein on: ${list(r.missingProtein)}`)
    : r.proteinPerPortion == null || r.proteinPerPortion < 0 || r.kcalPerPortion == null || r.kcalPerPortion <= 0
      ? held("no portion weight / nutrition yet")
      : { value: Math.round(r.proteinPerPortion * 10) / 10, heldBecause: null };
  return { upf, kcal, protein };
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

  const metricsFor = (gid: string, figures: Record<WebsiteMetric, { value: number | null; heldBecause: string | null }>): Record<WebsiteMetric, MetricDecision> => {
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
