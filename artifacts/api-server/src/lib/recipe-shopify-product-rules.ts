/**
 * "Create Shopify product" from a recipe — the RULES (pure, tested).
 * Objective A: a new recipe gets a properly set-up, planner-linked Shopify
 * product in one click (Graeme, 30 Oct 2026).
 *
 * Built on the test-box product creator (test-box-shopify-rules.ts has the
 * notes on how Graeme sets products up by hand), so both make products the
 * same way. What is different for a single recipe:
 *   - Tags: the test-box base tags (show, no-wholesale, calzones) + the
 *     recipe's OWN tags, no box tag.
 *   - Product type always BLANK — never "Calzones" (the website's main menu
 *     collects every product of that type; a new product isn't on the menu).
 *   - One variant only, the 2 Pack — an 8 Pack (or any other variant the
 *     template carries) is deleted from the copy.
 *   - The product description is the recipe's SHOPIFY LISTING description
 *     (recipes.shopify_listing_description), reviewed by Graeme; the short
 *     recipe description still goes to custom.product_recipe.
 *   - The recipe's product photo is put on the product; the template's
 *     images never come across.
 *   - It refuses to make a product without a listing description or with an
 *     incomplete ingredient deck (the deck push refuses those too).
 */
import { TEST_BOX_BASE_TAGS, perPackValue } from "./test-box-shopify-rules";

/** The one variant a new product keeps (option "Size", as the store uses). */
export const PACK_VARIANT_TITLE = "2 Pack";

/** Shopify's limit on one tag. */
const MAX_TAG_LENGTH = 255;
const norm = (s: string) => s.trim().toLowerCase();

/** Base tags, then the recipe's own — trimmed, no blanks, no duplicates in
 *  any case (the first spelling wins). */
export function recipeProductTags(recipeTags: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of [...TEST_BOX_BASE_TAGS, ...(recipeTags ?? [])]) {
    const t = String(raw ?? "").trim().slice(0, MAX_TAG_LENGTH);
    if (t && !out.some(o => norm(o) === norm(t))) out.push(t);
  }
  return out;
}

const variantKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Which of a (duplicated) product's variants to keep: the one titled "2 Pack"
 * (any case / spacing / hyphen). Every other variant is removed. No 2 Pack →
 * nothing kept, with the reason.
 */
export function planVariants<V extends { id: string; title: string }>(variants: readonly V[], wanted: string = PACK_VARIANT_TITLE): {
  keep: V | null; remove: V[]; problem: string | null;
} {
  const keep = variants.find(v => variantKey(v.title) === variantKey(wanted)) ?? null;
  if (!keep) {
    return {
      keep: null, remove: [],
      problem: variants.length
        ? `The template product has no '${wanted}' variant (it has ${variants.map(v => `'${v.title}'`).join(", ")}) — pick another template.`
        : "The template product has no variants — pick another template.",
    };
  }
  return { keep, remove: variants.filter(v => v.id !== keep.id), problem: null };
}

/**
 * - linked: the recipe already has a Shopify product (a variant in
 *   recipe_shopify_mappings) — shown, never made again.
 * - update: the app made one but the run didn't finish (no link yet) — the
 *   next run finishes that same product.
 * - create: nothing yet (or the app's earlier one has gone from Shopify).
 */
export type ListingAction = "create" | "update" | "linked";
export function decideListingAction(input: { createdProductId: string | null; createdProductExists: boolean; mappedProductIds: string[] }): ListingAction {
  if (input.mappedProductIds.length > 0) return "linked";
  if (input.createdProductId && input.createdProductExists) return "update";
  return "create";
}

/** custom.per_recipe: the recipe's portions per pack ("2" for a 2-pack). */
export function perPackForProduct(packSize: number | string | null | undefined): string {
  return perPackValue(packSize);
}

export interface ListingCheckInput {
  action: ListingAction;
  templateFound: boolean;
  templateVariantProblem: string | null;
  listingDescription: string | null;
  recipeDescription: string | null;
  deckComplete: boolean;
  deckMissing: string[];
  nutritionComplete: boolean;
  nutritionMissing: string[];
  hasPhoto: boolean;
  rrp: unknown;
  packSize: number | string | null;
  templateVariantCount: number;
}

const listOf = (xs: string[]) => {
  const u = [...new Set(xs)];
  return u.length ? ` (${u.slice(0, 6).join(", ")}${u.length > 6 ? "…" : ""})` : "";
};

/** What stops the create (blocking) and what Graeme should know (warnings). */
export function listingChecks(input: ListingCheckInput): { warnings: string[]; blocking: string[] } {
  const warnings: string[] = [];
  const blocking: string[] = [];
  if (input.action === "linked") return { warnings, blocking };
  if (input.action === "create") {
    if (!input.templateFound) blocking.push("No template product found to copy the settings from — pick one.");
    else if (input.templateVariantProblem) blocking.push(input.templateVariantProblem);
  }
  if (!input.listingDescription?.trim()) {
    blocking.push("There's no Shopify listing description yet — write it (or Draft with AI) on the Details tab and check it first.");
  }
  if (!input.deckComplete) {
    blocking.push(`The ingredient deck isn't complete${listOf(input.deckMissing)} — fix it on the Label tab first; a product never goes out without its full deck.`);
  }
  if (!input.recipeDescription?.trim()) {
    warnings.push("The recipe description is empty — custom.product_recipe (the line under the picture) will be left empty. Add it on the Details tab.");
  }
  if (!input.nutritionComplete) {
    warnings.push(`Nutrition is incomplete${listOf(input.nutritionMissing)} — the nutrition image can't be made yet, so it will be left off.`);
  }
  if (!input.hasPhoto) warnings.push("No product photo on the recipe — the product will have no picture. Upload one on the Details tab (at least 1000 × 750).");
  if (!(Number(input.rrp) > 0)) warnings.push("No RRP on the recipe — the price stays as the template's. Set the RRP on the recipe first.");
  const perPack = perPackForProduct(input.packSize);
  if (perPack !== "2") warnings.push(`This recipe packs ${perPack} per pack — custom.per_recipe will say ${perPack}, but the variant is the ${PACK_VARIANT_TITLE}. Check it in Shopify.`);
  if (input.action === "create" && input.templateVariantCount > 1 && !input.templateVariantProblem) {
    warnings.push(`The template has ${input.templateVariantCount} variants — only the ${PACK_VARIANT_TITLE} is kept, the others are removed from the copy.`);
  }
  return { warnings, blocking };
}

/** The preview's line for the product photo. */
export function photoLine(photo: { width: number; height: number } | null): { willAttach: boolean; summary: string } {
  return photo
    ? { willAttach: true, summary: `The recipe's photo (${photo.width} × ${photo.height}) — uploaded to the product's images` }
    : { willAttach: false, summary: "No photo on the recipe — the product is made without a picture (the template's images are never copied)" };
}
