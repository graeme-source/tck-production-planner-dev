/**
 * Barcode → product identity: the rule that stops the packing scanner ever
 * accepting the wrong item (Graeme, 2026-10-10 — a mis-pack is hugely
 * expensive).
 *
 * A PRODUCT IDENTITY is one recipe at one pack size: the recipe's pack
 * listings (and its wonky pack — the same physical pack) are one identity,
 * its 8-pack bag is another. A variant someone has marked "same product as"
 * another takes that variant's identity (an F2F / CFF / discounted copy). Any
 * other variant is its own identity. Variants of one identity may share a
 * barcode; different identities may NOT — at scan time one code is one
 * product.
 *
 * CURRENT vs RETIRED. TCK has no spare GS1 numbers, so Graeme reuses the
 * barcodes of retired products (old test boxes, products that never
 * worked). A variant is CURRENT when it is linked to an active recipe (not
 * archived, not a draft) or its Shopify product is active. A RETIRED
 * variant never claims a barcode in our table — it isn't stored, and if a
 * current product holds the same code it is listed as "old product still
 * holding a reused barcode" (optional tidy in Shopify), not as an error.
 *
 * Among CURRENT holders of one code, the first rank keeps it:
 *   0  set (or moved) in the app by a person
 *   1  a recipe's pack listing
 *   2  a recipe's 8-pack bag
 *   3  anything else (an active Shopify product not linked to a recipe)
 * If two different identities tie for the best rank NOBODY keeps it — the
 * scanner can't tell them apart. Every current-vs-current clash is listed
 * for a decision.
 */
import { gtinKey } from "./set";
import { kindLabel, type LinkKind, type LinkedVariant } from "./links";

export interface Identity {
  /** Stable key: r<recipeId>:pack, r<recipeId>:bag, or v<variantId>. */
  key: string;
  /** What people call it: "The Godfather · 2-pack", or the variant's name. */
  name: string;
}

const identityKind = (k: LinkKind): "pack" | "bag" => (k === "bag" ? "bag" : "pack");

/**
 * Every variant's identity. `sameAs` = variant id → the variant it was
 * marked the same product as (followed up to 5 steps; a loop or a dead end
 * falls back to the variant's own identity).
 */
export function identitiesFor(
  variantIds: Iterable<string>,
  links: LinkedVariant[],
  sameAs: Map<string, string>,
  names: Map<string, string>,
  packSizes: Map<number, number | null> = new Map(),
  /** The Calzone Club Special's listings and the recipe flagged
   *  is_current_special: those listings ARE that recipe's pack (copies.ts). */
  special: { variantIds: Set<string>; recipeId: number; recipeName: string } | null = null,
): Map<string, Identity> {
  const linkOf = new Map(links.map(l => [l.variantId, l]));
  const own = (id: string): Identity | null => {
    if (special?.variantIds.has(id)) {
      return { key: `r${special.recipeId}:pack`, name: `${special.recipeName} · ${kindLabel("pack", packSizes.get(special.recipeId))}` };
    }
    const l = linkOf.get(id);
    if (!l) return null;
    const k = identityKind(l.kind);
    return { key: `r${l.recipeId}:${k}`, name: `${l.recipeName} · ${kindLabel(k, packSizes.get(l.recipeId))}` };
  };
  const out = new Map<string, Identity>();
  for (const id of variantIds) {
    let cur = id;
    let found = own(cur);
    const seen = new Set([id]);
    for (let step = 0; !found && step < 5; step++) {
      const next = sameAs.get(cur);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cur = next;
      found = own(cur) ?? (sameAs.has(cur) ? null : { key: `v${cur}`, name: names.get(cur) ?? `Shopify variant ${cur}` });
    }
    out.set(id, found ?? { key: `v${id}`, name: names.get(id) ?? `Shopify variant ${id}` });
  }
  return out;
}

export interface Holding {
  variantId: string;
  /** The variant's own name (product · variant). */
  name: string;
  barcode: string | null;
  identity: Identity;
  current: boolean;
  /** Ours was set or moved in the app by a person. */
  setInApp: boolean;
  /** Linked to a recipe as its pack / bag (undefined = not linked). */
  linkKind?: LinkKind;
}

export function rankOf(h: Pick<Holding, "setInApp" | "linkKind">): number {
  if (h.setInApp) return 0;
  if (h.linkKind === "pack" || h.linkKind === "wonky") return 1;
  if (h.linkKind === "bag") return 2;
  return 3;
}

interface Side { identity: Identity; variants: Array<{ variantId: string; name: string }> }

export interface Clash {
  barcode: string;
  /** The identity that keeps it, or null when two tied for best. */
  keeper: Side | null;
  /** Other CURRENT identities that may not use it. */
  losers: Side[];
}

export interface Reuse {
  barcode: string;
  /** Who uses it now (null when no current product does). */
  current: Side | null;
  /** Retired variants still carrying it in Shopify. */
  retired: Array<{ variantId: string; name: string }>;
}

export interface Ownership {
  /** variant id → the barcode it may use (null = none / held back). */
  barcodeOf: Map<string, string | null>;
  /** Current-vs-current clashes — a decision is needed. */
  clashes: Clash[];
  /** Retired products still holding a code a current product uses. */
  reused: Reuse[];
}

export function resolveOwnership(holdings: Holding[]): Ownership {
  const barcodeOf = new Map<string, string | null>();
  const byCode = new Map<string, Holding[]>();
  for (const h of holdings) {
    const b = (h.barcode ?? "").trim();
    barcodeOf.set(h.variantId, null);
    if (b) byCode.set(gtinKey(b), [...(byCode.get(gtinKey(b)) ?? []), h]);
  }
  const clashes: Clash[] = [];
  const reused: Reuse[] = [];
  const side = (hs: Holding[]): Side => ({ identity: hs[0].identity, variants: hs.map(h => ({ variantId: h.variantId, name: h.name })) });

  for (const group of byCode.values()) {
    const code = group[0].barcode!.trim();
    const current = group.filter(h => h.current);
    const retired = group.filter(h => !h.current);
    const byIdentity = new Map<string, Holding[]>();
    for (const h of current) byIdentity.set(h.identity.key, [...(byIdentity.get(h.identity.key) ?? []), h]);

    let keeperKey: string | null = null;
    if (byIdentity.size === 1) {
      keeperKey = [...byIdentity.keys()][0];
    } else if (byIdentity.size > 1) {
      const best = (hs: Holding[]) => Math.min(...hs.map(rankOf));
      const top = Math.min(...[...byIdentity.values()].map(best));
      const atTop = [...byIdentity].filter(([, hs]) => best(hs) === top).map(([k]) => k);
      keeperKey = atTop.length === 1 ? atTop[0] : null;
      clashes.push({
        barcode: code,
        keeper: keeperKey ? side(byIdentity.get(keeperKey)!) : null,
        losers: [...byIdentity].filter(([k]) => k !== keeperKey).map(([, hs]) => side(hs)),
      });
    }
    if (keeperKey) for (const h of byIdentity.get(keeperKey)!) barcodeOf.set(h.variantId, h.barcode!.trim());
    if (retired.length && current.length) {
      reused.push({ barcode: code, current: keeperKey ? side(byIdentity.get(keeperKey)!) : null, retired: retired.map(h => ({ variantId: h.variantId, name: h.name })) });
    }
  }
  clashes.sort((a, b) => a.barcode.localeCompare(b.barcode));
  reused.sort((a, b) => a.barcode.localeCompare(b.barcode));
  return { barcodeOf, clashes, reused };
}

/** One line for a clash, for people. */
export function describeClash(c: Clash): string {
  if (!c.keeper) return `${c.barcode} is on ${c.losers.map(l => l.identity.name).join(" and ")} — different current products, so none of them can be scanned with it until it's changed in Shopify.`;
  return `${c.barcode} is used by ${c.keeper.identity.name}; it is also on ${c.losers.map(l => l.identity.name).join(", ")}, which can't be scanned with it until it gets its own barcode.`;
}
