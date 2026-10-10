/**
 * Listings that are the SAME physical pack as a recipe's own listing.
 *
 * 1. The Calzone Club Special. One Shopify product whose contents rotate:
 *    it always delivers the recipe flagged is_current_special — the rule the
 *    fulfilment stock decrement already uses (by product title,
 *    inventory-sync.ts). Its barcode is never its own: it scans as the
 *    current special's pack, with that recipe's barcode. Graeme switches the
 *    Club Special's barcode in Shopify by hand the day before the new
 *    special's first delivery, while the planner flag flips later (renewals
 *    run on a 7-day offset), so for a few days Shopify carries the INCOMING
 *    special's barcode. That is expected: it is shown as "special changing",
 *    never as a clash or "different in Shopify", and during it the Club
 *    Special line also accepts the incoming special's code — both are the
 *    special, and only those two codes.
 *
 * 2. F2F copies ("F2F - Chicken & Chorizo"). The same pack with the same
 *    printed barcode, always (Graeme, 2026-10-10). They are deliberately NOT
 *    added to recipe_shopify_mappings: a mapping also drives the production-
 *    fridge stock decrement, sales counts and the stock gate, and F2F stock
 *    is held on Shopify, not in the production fridge. Instead each F2F copy
 *    is marked "same product as" the recipe's listing (sku_barcodes.
 *    same_product_as — barcodes only). suggestF2fLinks lists the copies to
 *    mark, for a person to review and apply once.
 */
import { gtinKey } from "./set";
import type { KnownCodes } from "./scan";

/** The Club Special's Shopify product title (lower-case). One copy — the
 *  stock decrement and the DPT suggestion read it from here too. */
export const CLUB_SPECIAL_TITLE_LC = "calzone club special";

export function isClubSpecialTitle(productTitle: string | null | undefined): boolean {
  return (productTitle ?? "").trim().toLowerCase() === CLUB_SPECIAL_TITLE_LC;
}

export interface AlsoAccepts { code: string; identityKey: string; name: string }

export interface ClubSpecialScan {
  /** The code the Club Special scans with: the current special's pack code. */
  barcode: string | null;
  /** During a changeover: the incoming special's code, also accepted. */
  alsoAccepts: AlsoAccepts[];
  /** Shopify's Club Special code is another special's (expected changeover). */
  changing: boolean;
  /** Shopify's code is neither — worth a look, but never a clash. */
  unexpected: boolean;
}

/**
 * What a Club Special listing scans with.
 * @param specialCode    the current special's pack barcode (null = none set / no special)
 * @param specialKey     the current special's identity key
 * @param shopifyCode    the Club Special's barcode in Shopify
 * @param known          every code a current product owns (gtinKey → owner)
 */
export function clubSpecialScan(specialCode: string | null, specialKey: string | null, shopifyCode: string | null, known: KnownCodes): ClubSpecialScan {
  const base: ClubSpecialScan = { barcode: specialCode, alsoAccepts: [], changing: false, unexpected: false };
  const theirs = (shopifyCode ?? "").trim();
  if (!theirs || (specialCode && gtinKey(theirs) === gtinKey(specialCode))) return base;
  const owner = known[gtinKey(theirs)];
  if (owner && owner.identityKey !== specialKey && /^r\d+:pack$/.test(owner.identityKey)) {
    return { ...base, alsoAccepts: [{ code: theirs, identityKey: owner.identityKey, name: owner.name }], changing: true };
  }
  return { ...base, unexpected: true };
}

/** The marker an F2F copy carries at the start of its product title. */
export const F2F_TITLE_PREFIX = /^\s*f2f\b/i;

export interface CopyCandidate {
  variantId: string;
  name: string;
  productTitle: string | null;
  current: boolean;
  /** Linked to a recipe (then it is never a copy). */
  linked: boolean;
  sameProductAs: string | null;
  /** Its barcode — ours, else Shopify's. */
  barcode: string | null;
}

export interface PackListing {
  variantId: string;
  recipeId: number;
  name: string;
  /** "Chicken and Chorizo · 2-pack" */
  productName: string;
  barcode: string | null;
}

export interface CopyLink {
  variantId: string;
  name: string;
  barcode: string;
  sameAs: string;
  sameAsName: string;
  recipeId: number;
}

/**
 * F2F copies to mark "same product as": a CURRENT listing, not linked to a
 * recipe and not already marked, whose title starts "F2F" and whose barcode
 * is a recipe pack's barcode — of exactly one recipe (anything less certain
 * is left alone for a person).
 */
export function suggestF2fLinks(candidates: CopyCandidate[], packs: PackListing[]): CopyLink[] {
  const byCode = new Map<string, PackListing[]>();
  for (const p of packs) {
    if (!p.barcode) continue;
    const k = gtinKey(p.barcode);
    byCode.set(k, [...(byCode.get(k) ?? []), p]);
  }
  const out: CopyLink[] = [];
  for (const c of candidates) {
    if (!c.current || c.linked || c.sameProductAs || !c.barcode || !F2F_TITLE_PREFIX.test(c.productTitle ?? "")) continue;
    const hits = byCode.get(gtinKey(c.barcode)) ?? [];
    const recipes = new Set(hits.map(h => h.recipeId));
    if (recipes.size !== 1) continue;
    const target = hits[0];
    out.push({ variantId: c.variantId, name: c.name, barcode: c.barcode, sameAs: target.variantId, sameAsName: target.productName, recipeId: target.recipeId });
  }
  return out.sort((a, b) => a.sameAsName.localeCompare(b.sameAsName, "en-GB") || a.name.localeCompare(b.name));
}
