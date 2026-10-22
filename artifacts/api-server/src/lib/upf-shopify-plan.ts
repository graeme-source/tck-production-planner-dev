/**
 * What the website should say about each product's UPF % — pure decisions,
 * no I/O. The runner (upf-shopify-sync.ts) feeds it the live recipe rollups,
 * the recipe → Shopify product links and what we last wrote, and applies the
 * writes it returns. Objective B.
 *
 * Rules (Graeme, 2026-10-22):
 *  - The planner is the source of truth: a product shows its recipe's UPF %
 *    by weight, exactly as the Recipes page computes it.
 *  - Never publish a number the planner itself doubts: any unclassified
 *    ingredient (the "?" on the pill) holds the product back — the website
 *    then shows nothing rather than a wrong figure.
 *  - A product linked to more than one recipe has no single answer, so it
 *    is held back too.
 *  - A product that's no longer linked to any recipe loses its number.
 */

export interface RecipeUpfInput {
  recipeId: number;
  name: string;
  upfPercent: number | null;
  unclassifiedIngredients: string[];
}

export interface ProductLink {
  productGid: string;
  productTitle: string;
  recipeId: number;
}

/** What we last wrote for a product (NULL percent = removed / not there). */
export interface LedgerEntry {
  productGid: string;
  productTitle: string | null;
  publishedPercent: number | null;
}

export type UpfSyncStatus =
  | "published"
  | "held_unclassified"
  | "held_no_data"
  | "held_several_recipes"
  | "unlinked";

export interface UpfDecision {
  productGid: string;
  productTitle: string | null;
  recipeNames: string[];
  status: UpfSyncStatus;
  /** The number the website should show; null = show nothing. */
  percent: number | null;
  unclassified: string[];
  /** True when Shopify needs a write (set or remove) to match. */
  needsWrite: boolean;
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

export function planUpfSync(
  recipes: RecipeUpfInput[],
  links: ProductLink[],
  ledger: LedgerEntry[],
): UpfDecision[] {
  const recipeById = new Map(recipes.map(r => [r.recipeId, r]));
  const ledgerByGid = new Map(ledger.map(l => [l.productGid, l]));

  const byProduct = new Map<string, { title: string; recipeIds: Set<number> }>();
  for (const link of links) {
    const p = byProduct.get(link.productGid) ?? { title: link.productTitle, recipeIds: new Set<number>() };
    p.recipeIds.add(link.recipeId);
    byProduct.set(link.productGid, p);
  }

  const decide = (productGid: string, productTitle: string | null, recipeNames: string[], status: UpfSyncStatus, percent: number | null, unclassified: string[] = []): UpfDecision => {
    const last = ledgerByGid.get(productGid);
    // No ledger row = we don't know what Shopify holds, so write to be sure.
    const needsWrite = !last || last.publishedPercent !== percent;
    return { productGid, productTitle, recipeNames, status, percent, unclassified, needsWrite };
  };

  const decisions: UpfDecision[] = [];
  for (const [gid, p] of byProduct) {
    const linked = [...p.recipeIds].map(id => recipeById.get(id)).filter((r): r is RecipeUpfInput => !!r);
    const names = linked.map(r => r.name).sort();
    if (linked.length === 0) {
      decisions.push(decide(gid, p.title, [], "unlinked", null));
    } else if (linked.length > 1) {
      decisions.push(decide(gid, p.title, names, "held_several_recipes", null));
    } else {
      const r = linked[0];
      if (r.upfPercent == null) decisions.push(decide(gid, p.title, names, "held_no_data", null));
      else if (r.unclassifiedIngredients.length > 0) decisions.push(decide(gid, p.title, names, "held_unclassified", null, [...r.unclassifiedIngredients].sort()));
      else decisions.push(decide(gid, p.title, names, "published", websiteUpfPercent(r.upfPercent)));
    }
  }

  // Products we wrote before that no longer link to any recipe.
  for (const l of ledger) {
    if (byProduct.has(l.productGid)) continue;
    decisions.push({
      productGid: l.productGid,
      productTitle: l.productTitle,
      recipeNames: [],
      status: "unlinked",
      percent: null,
      unclassified: [],
      needsWrite: l.publishedPercent !== null,
    });
  }

  return decisions.sort((a, b) => (a.productTitle ?? "").localeCompare(b.productTitle ?? ""));
}
