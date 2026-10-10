/**
 * Which Shopify variants are linked to which recipe, and as what.
 *
 * Everything is keyed by Shopify VARIANT id: TCK SKUs are shelf labels shared
 * by many products (189 variants, 41 SKUs), so a SKU can never identify one.
 *
 *   pack   recipe_shopify_mappings.shopify_variant_id — the listing(s) a
 *          recipe sells as (the 2-pack for a calzone). A recipe can have
 *          several (an old and a new listing, a FREE-gift listing); they are
 *          the same physical pack and share one barcode.
 *   bag    the 8-pack bag. recipe_shopify_mappings.eight_pack_variant_id when
 *          it is set; otherwise the variant of the SAME Shopify product as a
 *          mapped pack whose variant title says "8 Pack Bag" — the
 *          convention the wholesale-bags queue and the despatch decrement
 *          already use (eight-pack-bags.ts), joined here by product id rather
 *          than product title so a renamed product can't break it.
 *   wonky  recipe_shopify_mappings.wonky_variant_id.
 */

export type LinkKind = "pack" | "bag" | "wonky";

export const LINK_KINDS: readonly LinkKind[] = ["pack", "bag", "wonky"];

export interface MappingRow {
  recipeId: number;
  recipeName: string;
  shopifyVariantId: string;
  wonkyVariantId: string | null;
  eightPackVariantId: string | null;
}

export interface CatalogueVariant {
  variantId: string;
  productId: string | null;
  variantTitle: string | null;
}

export interface LinkedVariant {
  variantId: string;
  recipeId: number;
  recipeName: string;
  kind: LinkKind;
}

export interface LinkResult {
  links: LinkedVariant[];
  /** Bag variants whose product carries packs of more than one recipe —
   *  not linked, because which recipe they belong to is a guess. */
  ambiguousBags: string[];
}

/** Same marker eight-pack-bags.ts (EIGHT_PACK_VARIANT_MATCH) keys on. */
export const BAG_TITLE_MARKER = "8 pack bag";

export function isBagTitle(variantTitle: string | null | undefined): boolean {
  return (variantTitle ?? "").toLowerCase().includes(BAG_TITLE_MARKER);
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export function deriveLinkedVariants(mappings: MappingRow[], catalogue: CatalogueVariant[]): LinkResult {
  const out = new Map<string, LinkedVariant>();
  const add = (variantId: string | null, m: MappingRow, kind: LinkKind) => {
    if (!variantId || out.has(variantId)) return;
    out.set(variantId, { variantId, recipeId: m.recipeId, recipeName: m.recipeName, kind });
  };
  for (const m of mappings) add(clean(m.shopifyVariantId), m, "pack");
  for (const m of mappings) add(clean(m.eightPackVariantId), m, "bag");
  for (const m of mappings) add(clean(m.wonkyVariantId), m, "wonky");

  // Bags by product: which recipe(s) own a pack in each Shopify product.
  const productOf = new Map(catalogue.map(c => [c.variantId, c.productId]));
  const recipesByProduct = new Map<string, Map<number, MappingRow>>();
  for (const m of mappings) {
    const pid = productOf.get(clean(m.shopifyVariantId) ?? "");
    if (!pid) continue;
    const owners = recipesByProduct.get(pid) ?? new Map<number, MappingRow>();
    owners.set(m.recipeId, m);
    recipesByProduct.set(pid, owners);
  }
  const ambiguousBags: string[] = [];
  for (const c of catalogue) {
    if (out.has(c.variantId) || !c.productId || !isBagTitle(c.variantTitle)) continue;
    const owners = recipesByProduct.get(c.productId);
    if (!owners || owners.size === 0) continue;
    if (owners.size > 1) { ambiguousBags.push(c.variantId); continue; }
    add(c.variantId, [...owners.values()][0], "bag");
  }

  const kindOrder = (k: LinkKind) => LINK_KINDS.indexOf(k);
  const links = [...out.values()].sort((a, b) =>
    a.recipeName.localeCompare(b.recipeName, "en-GB") || a.recipeId - b.recipeId || kindOrder(a.kind) - kindOrder(b.kind) || a.variantId.localeCompare(b.variantId));
  return { links, ambiguousBags };
}

/** What a group is called on screen. The pack is named from the recipe's own
 *  pack size, never from a product name. */
export function kindLabel(kind: LinkKind, packSize?: number | null): string {
  if (kind === "bag") return "8-pack bag";
  if (kind === "wonky") return "Wonky pack";
  const n = Number(packSize);
  return Number.isFinite(n) && n > 1 && Number.isInteger(n) ? `${n}-pack` : "Pack";
}
