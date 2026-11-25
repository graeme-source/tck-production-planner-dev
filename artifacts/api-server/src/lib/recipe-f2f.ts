/**
 * F2F (frozen) product links (Graeme, 25 Nov 2026) — the matching rule. Pure.
 *
 * Each core recipe's F2F product on Shopify is named "F2F - <its main
 * product's title>" (e.g. "F2F - Garlic Cheese Calzones (v)" for the recipe
 * whose product is "Garlic Cheese Calzones (v)"). The suggestion is the F2F
 * product whose title, without the "F2F - " prefix, matches one of the
 * recipe's own Shopify product titles or its name. Suggested, never linked
 * automatically — a person confirms each one.
 */
export interface F2fProduct { variantId: string; title: string; variantTitle: string | null }

/** Letters and digits only — "CarniZone 🍗 MeatFeast" = "CarniZone Meat Feast". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "F2F - X" → "x" (normalised); null if it isn't an F2F title. */
export function f2fBase(title: string): string | null {
  const m = /^\s*f2f\s*[-–—:]\s*(.+)$/i.exec(title);
  return m ? norm(m[1]!) : null;
}

export function suggestF2f(recipe: { name: string; productTitles: readonly string[] }, products: readonly F2fProduct[], taken: ReadonlySet<string>): F2fProduct | null {
  const wanted = new Set([recipe.name, ...recipe.productTitles].map(norm).filter(Boolean));
  const hits = products.filter(p => !taken.has(p.variantId) && wanted.has(f2fBase(p.title) ?? "\u0000"));
  return hits.length === 1 ? hits[0]! : null; // two candidates → let a person choose
}
