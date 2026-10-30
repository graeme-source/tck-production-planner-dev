/**
 * "Create Shopify product" from a recipe — the PREVIEW, built purely from
 * what was read (recipe, Shopify, deck, nutrition), so it can be tested with
 * no database or network. recipe-shopify-product-run.ts does the reads and
 * the run uses exactly what this returns. Objective A.
 */
import type { ProductSnapshot } from "./test-box-shopify";
import type { LoadedContent, ProductLink } from "./test-box-shopify-run";
import { ingredientDeckDocument } from "./shopify-rich-text";
import { ingredientDeclarationGaps, type IngredientGap } from "@workspace/product-labels";
import {
  MF, metafieldPlan, missingFileScopes, missingWriteScopes, nutritionImagePlan, nutritionRows, productPrice,
  type MetafieldLine, type NutritionRow, type RecipeContent, type TemplateCandidate,
} from "./test-box-shopify-rules";
import {
  DECK_INCOMPLETE_HEADLINE, DECK_LEFT_OFF, NUTRITION_INCOMPLETE_HEADLINE, PACK_VARIANT_TITLE, barcodePreviewLine, decideListingAction,
  listingChecks, photoLine, planVariants, recipeProductTags, leftOutTags, type ListingAction, type PackBarcodeState,
} from "./recipe-shopify-product-rules";

// Mirrored in production-planner components/recipe-editor/shopify-product-create.tsx.
export interface RecipeProductPreview {
  recipe: { id: number; name: string; isDraft: boolean; archived: boolean };
  writesBlocked: boolean;
  blockedMessage: string | null;
  missingScopes: string[];
  missingFileScopes: string[];
  action: ListingAction;
  linkedProducts: ProductLink[];
  createdProduct: (ProductLink & { state: string; lastError: string | null }) | null;
  template: (ProductLink & { price: string | null; variantTitles: string[]; reason: string }) | null;
  templates: Array<TemplateCandidate & { adminUrl: string }>;
  title: string;
  status: "DRAFT";
  productType: string;
  tags: string[];
  /** The recipe's tags that aren't sent, and why (Meals, Draft…). */
  tagsLeftOut: Array<{ tag: string; reason: string }>;
  variant: { title: string; removed: string[] };
  price: { set: string | null; summary: string };
  /** The 2 Pack's barcode: the app's (Label tab, or typed in the window). */
  barcode: { code: string | null; summary: string };
  listingDescription: string;
  metafields: MetafieldLine[];
  photo: { willAttach: boolean; summary: string; width: number | null; height: number | null };
  nutrition: { complete: boolean; portionWeightG: number | null; rows: NutritionRow[] };
  nutritionImage: { willAttach: boolean; summary: string };
  /** Ingredients (sub-recipe ones included) missing nutrition or a label
   *  declaration — the Label tab's own warnings, one line each. */
  declarationGaps: { items: IngredientGap[]; headlines: string[] };
  /** The deck isn't complete: custom.ingredient_deck is left empty. */
  deckLeftOff: boolean;
  warnings: string[];
  blocking: string[];
}

export interface PreviewInput {
  recipe: {
    id: number; name: string; description: string | null; listing: string | null; packSize: number | string | null;
    tags: string[] | null; rrp: unknown; isDraft: boolean; archived: boolean;
  };
  /** The product the app made for this recipe before (recipe_shopify_products). */
  made: { shopifyProductId: string; state: string; lastError: string | null } | null;
  photo: { width: number; height: number } | null;
  /** The recipe's pack barcode as the barcode store holds it (null = none). */
  barcode?: PackBarcodeState | null;
  scopes: string[];
  candidates: TemplateCandidate[];
  /** Products the recipe's mapped variants belong to. */
  linked: ProductLink[];
  choice: { productId: string | null; reason: string };
  /** The template and the app's earlier product, as read (absent = gone). */
  snapshots: Map<string, ProductSnapshot>;
  loaded: LoadedContent;
  disclaimer: string | null;
  standardCooking: string;
  writesBlocked: boolean;
  blockedMessage: string | null;
  link: (p: { productId: string; title: string; status: string; variantTitle?: string }) => ProductLink;
}

export interface PreviewPlan {
  preview: RecipeProductPreview;
  content: RecipeContent;
  templateId: string | null;
  existingProductId: string | null;
  price: string | null;
}

const REASON_TEXT: Record<string, string> = {
  chosen: "picked by you",
  "copied-from": "the product of the recipe this one was copied from",
  "previous-box": "the newest test-box product",
  none: "",
};

export function assembleRecipePreview(i: PreviewInput): PreviewPlan {
  const r = i.recipe;
  const template = i.choice.productId ? i.snapshots.get(i.choice.productId) ?? null : null;
  const madeSnap = i.made ? i.snapshots.get(i.made.shopifyProductId) ?? null : null;
  const action = decideListingAction({
    createdProductId: i.made?.shopifyProductId ?? null,
    createdProductExists: madeSnap != null,
    mappedProductIds: i.linked.map(l => l.productId),
  });

  const deck = i.loaded.deck;
  const content: RecipeContent = {
    description: r.description,
    packSize: r.packSize,
    deckDocument: deck?.isComplete
      ? JSON.stringify(ingredientDeckDocument({ deckText: deck.deckText, mayContainStatement: deck.mayContainStatement, disclaimer: i.disclaimer }))
      : null,
    deckSummary: deck ? deck.deckText.replace(/\*\*/g, "") : null,
  };

  const base = action === "update" ? madeSnap : template;
  const vp = template ? planVariants(template.variants) : null;
  const kept = action === "update" ? (madeSnap?.variants ?? []) : vp?.keep ? [vp.keep] : [];
  const price = productPrice(r.rrp, kept.length, kept[0]?.price ?? null);
  const fileScopesMissing = missingFileScopes(i.scopes);
  const nutritionImage = nutritionImagePlan({ nutritionComplete: i.loaded.nutrition?.complete ?? false, missingFileScopes: fileScopesMissing });
  const plan = metafieldPlan(content, base?.metafields ?? [], i.standardCooking, nutritionImage);
  // Never a partial deck: an incomplete one is left off (the template's is
  // still removed) and goes on later with Push to Shopify on the Label tab.
  const deckLeftOff = !content.deckDocument;
  const metafields = plan.lines.map(m => (deckLeftOff && m.field === `${MF.ingredientDeck.namespace}.${MF.ingredientDeck.key}`
    ? { ...m, summary: `${m.action === "remove" ? "The template's deck is removed. " : ""}${DECK_LEFT_OFF}` }
    : m));
  const gapItems = ingredientDeclarationGaps({
    nutrition: i.loaded.nutrition?.missingDetail ?? [],
    missingDeclarations: i.loaded.deck?.missingDetail ?? (i.loaded.deck?.missing ?? []).map(name => ({ name })),
    unwrappedDeclarations: i.loaded.deck?.unwrapped ?? [],
  });
  const headlines = [
    ...(deckLeftOff ? [`${DECK_INCOMPLETE_HEADLINE} ${DECK_LEFT_OFF}`] : []),
    ...(i.loaded.nutrition && !i.loaded.nutrition.complete ? [NUTRITION_INCOMPLETE_HEADLINE] : []),
  ];
  const { warnings, blocking } = listingChecks({
    action,
    templateFound: template != null,
    templateVariantProblem: vp?.problem ?? null,
    listingDescription: r.listing,
    recipeDescription: r.description,
    deckComplete: deck?.isComplete ?? false,
    deckMissing: deck?.missing ?? [],
    nutritionComplete: i.loaded.nutrition?.complete ?? false,
    nutritionMissing: i.loaded.nutrition?.missing ?? [],
    hasPhoto: i.photo != null,
    rrp: r.rrp,
    packSize: r.packSize,
    templateVariantCount: template?.variants.length ?? 0,
  });
  if (action === "create" && i.choice.productId && !template) blocking.unshift("The chosen template product isn't in Shopify any more — pick another.");
  if (i.made && !madeSnap && action === "create") warnings.push("The product the app made for this recipe before has gone from Shopify — it will be made again.");
  if (action === "update") {
    warnings.unshift(`The app started this product${i.made?.lastError ? ` but the run stopped (${i.made.lastError})` : " but didn't finish linking it"} — this finishes that same draft rather than making another.`);
  }
  if (r.archived) warnings.push("This recipe is archived.");

  const preview: RecipeProductPreview = {
    recipe: { id: r.id, name: r.name, isDraft: r.isDraft, archived: r.archived },
    writesBlocked: i.writesBlocked,
    blockedMessage: i.blockedMessage,
    missingScopes: missingWriteScopes(i.scopes),
    missingFileScopes: fileScopesMissing,
    action,
    linkedProducts: action === "linked" ? i.linked : [],
    createdProduct: madeSnap && i.made
      ? { ...i.link({ productId: madeSnap.id, title: madeSnap.title, status: madeSnap.status }), state: i.made.state, lastError: i.made.lastError }
      : null,
    template: template ? {
      ...i.link({ productId: template.id, title: template.title, status: template.status }),
      price: vp?.keep?.price ?? template.variants[0]?.price ?? null,
      variantTitles: template.variants.map(v => v.title),
      reason: REASON_TEXT[i.choice.reason] ?? "",
    } : null,
    templates: i.candidates.map(c => ({ ...c, adminUrl: i.link({ productId: c.productId, title: c.title, status: c.status }).adminUrl })),
    title: r.name,
    status: "DRAFT",
    productType: "",
    tags: recipeProductTags(r.tags),
    tagsLeftOut: leftOutTags(r.tags),
    variant: { title: kept[0]?.title ?? PACK_VARIANT_TITLE, removed: action === "create" ? (vp?.remove ?? []).map(v => v.title) : [] },
    price: { set: price.price, summary: price.summary },
    barcode: barcodePreviewLine(action, i.barcode ?? null),
    listingDescription: r.listing?.trim() ?? "",
    metafields,
    photo: { ...photoLine(i.photo), width: i.photo?.width ?? null, height: i.photo?.height ?? null },
    nutrition: {
      complete: i.loaded.nutrition?.complete ?? false,
      portionWeightG: i.loaded.nutrition?.portionWeightG ?? null,
      rows: i.loaded.nutrition ? nutritionRows(i.loaded.nutrition.per100g, i.loaded.nutrition.perPortion) : [],
    },
    nutritionImage,
    declarationGaps: { items: action === "linked" ? [] : gapItems, headlines: action === "linked" ? [] : headlines },
    deckLeftOff: action !== "linked" && deckLeftOff,
    warnings,
    blocking: action === "linked" ? [] : blocking,
  };
  return {
    preview, content, price: price.price,
    templateId: template?.id ?? null,
    existingProductId: action === "update" && madeSnap ? madeSnap.id : null,
  };
}
