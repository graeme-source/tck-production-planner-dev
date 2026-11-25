/**
 * The "Link F2F product" picker on a recipe's Shopify section (Graeme,
 * 25 Nov 2026). Choices come from two places: every Shopify product with
 * "F2F" in its title (so a brand-new or never-sold one can be linked), and
 * the F2F products seen on orders. Same variant once; ones already linked to
 * another recipe are left out (a variant can only be one recipe's F2F).
 * Pure and tested. Objective C.
 */
export interface F2fChoice { variantId: string; title: string; variantTitle: string | null }

export interface ShopifyProductLite { id: number | string; title: string; variants: Array<{ id: number | string; title: string }> }

export function isF2fTitle(title: string): boolean {
  return /\bf2f\b/i.test(title);
}

export function f2fChoices(
  shopifyProducts: readonly ShopifyProductLite[],
  seenOnOrders: readonly F2fChoice[],
  taken: ReadonlySet<string>,
): F2fChoice[] {
  const out = new Map<string, F2fChoice>();
  for (const p of shopifyProducts) {
    if (!isF2fTitle(p.title)) continue;
    const many = p.variants.length > 1;
    for (const v of p.variants) {
      const id = String(v.id);
      out.set(id, { variantId: id, title: p.title, variantTitle: many && v.title !== "Default Title" ? v.title : null });
    }
  }
  for (const c of seenOnOrders) if (!out.has(c.variantId)) out.set(c.variantId, c);
  return [...out.values()]
    .filter(c => !taken.has(c.variantId))
    .sort((a, b) => a.title.localeCompare(b.title) || (a.variantTitle ?? "").localeCompare(b.variantTitle ?? "", undefined, { numeric: true }));
}

/** Every word typed must appear in the title or variant (any order, any case). */
export function filterF2fChoices(choices: readonly F2fChoice[], search: string): F2fChoice[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...choices];
  return choices.filter(c => {
    const hay = `${c.title} ${c.variantTitle ?? ""}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export function f2fLabel(c: { title: string; variantTitle: string | null }): string {
  return c.variantTitle ? `${c.title} · ${c.variantTitle}` : c.title;
}
