/**
 * "Create F2F product" from a recipe — the pure rules (Graeme, 25 Nov 2026).
 * Objective C. The Shopify calls are in ./f2f-product.ts.
 *
 * An F2F ("freezer to fridge") product is the frozen copy of a recipe's main
 * Shopify product. How the existing ones are set up (read from the live
 * store, 25 Nov 2026):
 *   - titled "F2F - <main product title>", status ACTIVE, stock tracked,
 *     same variants and prices as the main;
 *   - tags Clearance, F2F, show, Wonkyzone (+ the main's category tags such
 *     as BBQ / macaroni-cheese / fried-chicken) — never Meals;
 *   - the WonkyZones collection (TAG Clearance AND TAG Wonkyzone AND
 *     VARIANT_INVENTORY > 0) is what shows F2F stock on the site, and only
 *     while there is some.
 * What must NOT be copied from the main, because each one would put the F2F
 * product somewhere it doesn't belong:
 *   - Meals tag (the "Meals" smart collection is TAG EQUALS Meals);
 *   - calzones / Calzones tag (the "Calzones" collection);
 *   - product type "Calzones" (the "Dynamic Calzones" collection is TYPE
 *     EQUALS Calzones);
 *   - wholesale-g (the "Wholesale Calzones" collection) — and "no-wholesale"
 *     is added, as on other items kept out of wholesale;
 *   - "6 Week" (and any "N week(s)"), test-box tags, Carnivore Club (and any
 *     "… Club"), zero-price, Draft;
 *   - membership of any MANUAL collection (removed after the duplicate).
 */

/** Always on an F2F product, in this order and spelling. */
export const F2F_STANDARD_TAGS = ["Clearance", "F2F", "show", "Wonkyzone", "no-wholesale"] as const;

/** Tags never copied from the main product (compared ignoring case). */
export const F2F_STRIP_EXACT = ["meals", "meal", "calzones", "calzone", "wholesale-g", "carnivore club", "zero-price", "draft"] as const;

/** Tag shapes never copied, with the reason shown on the confirm card. */
export const F2F_STRIP_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /^\d+\s*-?\s*weeks?$/i, why: "a menu-rotation tag (\"6 Week\")" },
  { re: /test[\s_-]*box/i, why: "a test-box tag" },
  { re: /\bclub\b/i, why: "a club / subscription tag" },
  { re: /^wholesale/i, why: "a wholesale tag" },
  { re: /^draft\b/i, why: "a draft tag" },
  { re: /^zero[\s_-]*price$/i, why: "the zero-price tag" },
];

export interface F2fTagPlan {
  /** Exactly the tags the F2F product gets. */
  tags: string[];
  /** Main-product tags left off, with why. */
  stripped: Array<{ tag: string; why: string }>;
  /** Main-product tags carried over (e.g. BBQ, macaroni-cheese). */
  kept: string[];
}

const lower = (s: string) => s.trim().toLowerCase();

/** Why a main-product tag is left off the F2F product, or null to keep it. */
export function f2fStripReason(tag: string): string | null {
  const t = lower(tag);
  if (!t) return "blank";
  if ((F2F_STANDARD_TAGS as readonly string[]).some(s => s.toLowerCase() === t)) return null; // re-added in its standard spelling
  if ((F2F_STRIP_EXACT as readonly string[]).includes(t)) {
    if (t === "meals" || t === "meal") return "the Meals tag (puts it in the Meals collection)";
    if (t === "calzones" || t === "calzone") return "the Calzones tag (puts it in the Calzones collection)";
    if (t === "wholesale-g") return "the wholesale tag (puts it in Wholesale Calzones)";
    if (t === "carnivore club") return "a club / subscription tag";
    if (t === "zero-price") return "the zero-price tag";
    return "a draft tag";
  }
  for (const p of F2F_STRIP_PATTERNS) if (p.re.test(tag.trim())) return p.why;
  return null;
}

/**
 * The F2F product's tags from the main product's: the standard F2F set
 * first, then the main's other tags (its category tags) — minus everything
 * that would put it on the menu, in wholesale, in a test box or a club.
 * De-duplicated ignoring case; the standard set's spelling wins.
 */
export function f2fTagsFromMain(mainTags: readonly string[]): F2fTagPlan {
  const tags: string[] = [...F2F_STANDARD_TAGS];
  const seen = new Set(tags.map(lower));
  const stripped: F2fTagPlan["stripped"] = [];
  const kept: string[] = [];
  for (const raw of mainTags) {
    const tag = raw.trim();
    const why = f2fStripReason(tag);
    if (why) { if (tag) stripped.push({ tag, why }); continue; }
    if (seen.has(lower(tag))) continue;
    seen.add(lower(tag));
    tags.push(tag);
    kept.push(tag);
  }
  return { tags, stripped, kept };
}

/** Product type: never "Calzones" (that puts it in Dynamic Calzones); any
 *  other type is kept as the main has it. */
export function f2fProductType(mainType: string | null | undefined): string {
  const t = (mainType ?? "").trim();
  return /^calzones?$/i.test(t) ? "" : t;
}

/** "F2F - <main title>"; null if the main is itself an F2F product. */
export function f2fTitle(mainTitle: string): string | null {
  const t = mainTitle.trim();
  if (!t || /^f2f\b/i.test(t)) return null;
  return `F2F - ${t}`;
}

export interface MainProductCandidate { productId: string; title: string; status: string; mappedVariantIds: string[] }

/**
 * Which of the recipe's linked Shopify products is its MAIN product (the one
 * to duplicate): a requested one if it's among them, otherwise the one with
 * the most of the recipe's variants linked (first linked wins a tie). F2F
 * products are never a main.
 */
export function pickMainProduct(candidates: readonly MainProductCandidate[], requested?: string | null): MainProductCandidate | null {
  const usable = candidates.filter(c => f2fTitle(c.title) !== null);
  if (requested) return usable.find(c => c.productId === requested) ?? null;
  let best: MainProductCandidate | null = null;
  for (const c of usable) if (!best || c.mappedVariantIds.length > best.mappedVariantIds.length) best = c;
  return best;
}

/**
 * The F2F variant the recipe is linked to after the create: the one titled
 * like the recipe's linked variant on the main ("2 Pack" ↔ "2 Pack"),
 * otherwise the first.
 */
export function pickF2fLinkVariant<V extends { id: string; title: string }>(newVariants: readonly V[], mainLinkedVariantTitle: string | null): V | null {
  if (!newVariants.length) return null;
  const want = lower(mainLinkedVariantTitle ?? "");
  return (want && newVariants.find(v => lower(v.title) === want)) || newVariants[0]!;
}

export interface CreateBlockInput {
  alreadyLinked: { title: string } | null;
  main: { title: string; variantCount: number } | null;
  existingF2f: Array<{ productId: string; title: string }>;
  missingScopes: string[];
  writesBlocked: boolean;
}

/** Why the create can't go ahead (empty = it can). Plain words for the card. */
export function f2fCreateBlockers(i: CreateBlockInput): string[] {
  const out: string[] = [];
  if (i.alreadyLinked) out.push(`This recipe already has its F2F product (${i.alreadyLinked.title}).`);
  if (!i.main) out.push("This recipe isn't linked to a main Shopify product yet, so there is nothing to copy.");
  else if (f2fTitle(i.main.title) === null) out.push("The linked product is itself an F2F product.");
  else if (i.main.variantCount === 0) out.push("The main product has no variants to copy.");
  if (i.existingF2f.length) {
    out.push(`Shopify already has ${i.existingF2f.map(p => `"${p.title}"`).join(", ")} — link it from the list instead of making another.`);
  }
  // With writes blocked the run is stopped by the guard anyway, and says so.
  if (!i.writesBlocked && i.missingScopes.length) {
    out.push(`Shopify hasn't given the app permission for this yet (missing: ${i.missingScopes.join(", ")}).`);
  }
  return out;
}

/** Shopify scopes the create needs: products (duplicate, tags, collections)
 *  and inventory (stock tracked, on-hand 0). */
export const F2F_CREATE_SCOPES = ["write_products", "write_inventory"] as const;

/** Is this product (by title) the F2F copy of `mainTitle`? Ignores case and
 *  spacing/punctuation, as lib/recipe-f2f.ts matches them. */
export function isF2fOf(title: string, mainTitle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const m = /^\s*f2f\s*[-–—:]\s*(.+)$/i.exec(title);
  return !!m && norm(m[1]!) === norm(mainTitle);
}

/** A manual collection has no rule set; smart ones are kept (their rules
 *  decide on their own, and the tag/type rules above keep it out). */
export function manualCollections<C extends { ruleSet: unknown }>(collections: readonly C[]): C[] {
  return collections.filter(c => c.ruleSet == null);
}

/** Quantities to take off to leave each location's on-hand at 0. */
export function zeroOnHandChanges(levels: ReadonlyArray<{ locationId: string; onHand: number | null }>): Array<{ locationId: string; delta: number }> {
  return levels.filter(l => typeof l.onHand === "number" && l.onHand !== 0).map(l => ({ locationId: l.locationId, delta: -(l.onHand as number) }));
}
