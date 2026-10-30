/**
 * "Create Shopify product" from a recipe: the preview (reads only) and the
 * run (guarded writes). Objective A (Graeme, 30 Oct 2026: "click in a recipe,
 * click 'Create Shopify product', and it sets up the product in Shopify").
 *
 * The Shopify calls are the test-box product creator's (test-box-shopify.ts:
 * duplicate a template → update → variants → metafields → nutrition image),
 * with three extras for a single recipe: product type blank, only the 2 Pack
 * kept, and the recipe's photo on the product. The rules are in
 * recipe-shopify-product-rules.ts (+ the shared test-box-shopify-rules.ts).
 *
 * Idempotent by construction:
 *   - a recipe already linked to a Shopify product (recipe_shopify_mappings)
 *     is shown as "Already in Shopify" and never made again;
 *   - the product the app makes is stored the moment Shopify returns its id
 *     (recipe_shopify_products), so a failure part-way through is FINISHED
 *     by the next run, never duplicated.
 * Nothing is ever published or set Active.
 */
import {
  db, recipesTable, recipeShopifyProductsTable, recipeProductImagesTable, recipePackSizeOrOne,
  recipeIngredientsTable, ingredientsTable, recipeSubRecipesTable, subRecipesTable,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { productPhotoFilename, type ProductPhotoMime } from "@workspace/product-labels";
import { ShopifyWritesBlockedError } from "../services/shopify";
import { intArrayLiteral } from "./int-array-literal";
import { linkVariantToRecipe } from "./recipe-shopify-mapping";
import {
  applyRecipeProduct, fetchAccessScopes, fetchProducts, fetchTemplateCandidates, fetchVariantProducts,
  liveFileDeps, type FileDeps, type ShopifyPort,
} from "./test-box-shopify";
import {
  STANDARD_COOKING, RunRefused, disclaimerText, productLink, type ContentLoader, type ProductLink,
} from "./test-box-shopify-run";
import {
  chooseTemplate, copiedFromRecipeId, descriptionHtml, nutritionImageForRun, templateSearchQuery,
} from "./test-box-shopify-rules";
import { PACK_VARIANT_TITLE } from "./recipe-shopify-product-rules";
import { assembleRecipePreview, type PreviewPlan } from "./recipe-shopify-product-preview";
import type { ListingRecipeData } from "./listing-description-ai";

export { RunRefused };
export type { RecipeProductPreview } from "./recipe-shopify-product-preview";

async function mappedVariantIds(recipeIds: number[]): Promise<Array<{ recipe_id: number; shopify_variant_id: string }>> {
  if (!recipeIds.length) return [];
  return (await db.execute<{ recipe_id: number; shopify_variant_id: string }>(sql`
    SELECT recipe_id, shopify_variant_id FROM recipe_shopify_mappings
    WHERE recipe_id = ANY(${intArrayLiteral(recipeIds)}::int[]) ORDER BY created_at
  `)).rows;
}

/** Everything the preview shows, plus what the run needs. Reads only; the
 *  preview itself is assembled purely (recipe-shopify-product-preview.ts). */
export async function buildRecipePlan(
  recipeId: number,
  opts: { templateProductId?: string | null },
  port: ShopifyPort,
  loadContent: ContentLoader,
  writesBlocked: boolean,
): Promise<PreviewPlan> {
  const [r] = await db.select({
    id: recipesTable.id, name: recipesTable.name, description: recipesTable.description,
    listing: recipesTable.shopifyListingDescription, packSize: recipePackSizeOrOne, tags: recipesTable.tags,
    notes: recipesTable.notes, rrp: recipesTable.rrp, isDraft: recipesTable.isDraft, archivedAt: recipesTable.archivedAt,
  }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!r) throw new RunRefused(404, "Recipe not found");

  const [made] = await db.select().from(recipeShopifyProductsTable).where(eq(recipeShopifyProductsTable.recipeId, recipeId));
  const [photo] = await db.select({ width: recipeProductImagesTable.width, height: recipeProductImagesTable.height })
    .from(recipeProductImagesTable).where(eq(recipeProductImagesTable.recipeId, recipeId));

  const copiedFrom = copiedFromRecipeId(r.notes);
  const mappings = await mappedVariantIds(copiedFrom != null ? [recipeId, copiedFrom] : [recipeId]);

  const [scopes, candidates, variantProducts, disclaimer, loaded] = await Promise.all([
    fetchAccessScopes(port),
    fetchTemplateCandidates(port, templateSearchQuery()),
    fetchVariantProducts(port, mappings.map(m => String(m.shopify_variant_id))),
    disclaimerText(),
    loadContent(recipeId),
  ]);
  const productsOf = (id: number) => {
    const out = new Map<string, ProductLink>();
    for (const m of mappings) {
      if (Number(m.recipe_id) !== id) continue;
      const v = variantProducts.get(String(m.shopify_variant_id));
      if (v && !out.has(v.productId)) out.set(v.productId, productLink({ productId: v.productId, title: v.title, status: v.status, variantTitle: v.variantTitle }));
    }
    return [...out.values()];
  };

  // A box name of "" — the recipe flow has no box, so no candidate is excluded.
  const choice = chooseTemplate({
    requested: opts.templateProductId ?? null,
    copiedFromProductId: copiedFrom != null ? productsOf(copiedFrom)[0]?.productId ?? null : null,
    candidates,
    boxName: "",
  });
  const snapshots = await fetchProducts(port, [choice.productId, made?.shopifyProductId].filter((x): x is string => !!x));

  return assembleRecipePreview({
    recipe: {
      id: r.id, name: r.name, description: r.description, listing: r.listing, packSize: r.packSize, tags: r.tags,
      rrp: r.rrp, isDraft: r.isDraft === true, archived: r.archivedAt != null,
    },
    made: made ? { shopifyProductId: made.shopifyProductId, state: made.state, lastError: made.lastError } : null,
    photo: photo ?? null,
    scopes,
    candidates,
    linked: productsOf(recipeId),
    choice,
    snapshots,
    loaded,
    disclaimer,
    standardCooking: STANDARD_COOKING,
    writesBlocked,
    blockedMessage: writesBlocked ? new ShopifyWritesBlockedError("preview").message : null,
    link: productLink,
  });
}

// ── The run ─────────────────────────────────────────────────────────────────
export interface RecipeRunResult {
  outcome: "created" | "finished" | "blocked";
  message: string;
  product: ProductLink | null;
  steps: string[];
  linkedVariants: string[];
}

export interface Actor { id: number; name: string }

export async function runRecipeCreate(
  recipeId: number,
  opts: { templateProductId?: string | null; nutritionPngBase64?: string },
  user: Actor,
  port: ShopifyPort,
  loadContent: ContentLoader,
  writesBlocked: boolean,
  files: FileDeps = liveFileDeps,
): Promise<RecipeRunResult> {
  const plan = await buildRecipePlan(recipeId, opts, port, loadContent, writesBlocked);
  const p = plan.preview;
  if (p.action === "linked") {
    throw new RunRefused(409, `Already in Shopify — ${p.linkedProducts.map(l => l.title).join(", ")}. Nothing was made.`);
  }
  // With writes blocked the guard stops the run at its first write (and says
  // so) — the dry run still goes through every read and decision first.
  if (!writesBlocked && p.missingScopes.length) {
    throw new RunRefused(409, `Shopify hasn't given the app permission to create products yet (missing: ${p.missingScopes.join(", ")}). Nothing was changed.`);
  }
  if (p.blocking.length) throw new RunRefused(422, `${p.blocking.join(" ")} Nothing was changed.`);

  const nutrition = nutritionImageForRun({ title: p.title, nutritionImage: p.nutritionImage }, opts.nutritionPngBase64);
  const [photoRow] = await db.select().from(recipeProductImagesTable).where(eq(recipeProductImagesTable.recipeId, recipeId));
  const productPhoto = photoRow ? {
    bytes: Uint8Array.from(photoRow.data),
    filename: productPhotoFilename(p.title, photoRow.mimeType as ProductPhotoMime),
    alt: p.title,
    mimeType: photoRow.mimeType,
  } : null;

  try {
    const res = await applyRecipeProduct(port, {
      action: p.action,
      templateProductId: plan.templateId,
      existingProductId: plan.existingProductId,
      title: p.title,
      tags: p.tags,
      descriptionHtml: descriptionHtml(p.listingDescription),
      includeImages: false,
      content: plan.content,
      standardCooking: STANDARD_COOKING,
      price: plan.price,
      nutritionImage: nutrition.image,
      productType: "",
      onlyVariantTitled: PACK_VARIANT_TITLE,
      productPhoto,
    }, async (productId) => {
      // Stored before anything else happens to it — a later failure can
      // never lead to a second duplicate.
      await db.insert(recipeShopifyProductsTable).values({
        recipeId, shopifyProductId: productId, productTitle: p.title, templateProductId: plan.templateId, state: "created",
        createdById: user.id, createdByName: user.name, updatedByName: user.name,
      }).onConflictDoUpdate({
        target: recipeShopifyProductsTable.recipeId,
        set: { shopifyProductId: productId, productTitle: p.title, templateProductId: plan.templateId, state: "created", lastError: null, updatedByName: user.name, updatedAt: new Date() },
      });
    }, files);
    if (nutrition.note) res.steps.push(nutrition.note);
    await db.update(recipeShopifyProductsTable)
      .set({ state: "complete", productTitle: res.title, lastError: null, updatedByName: user.name, updatedAt: new Date() })
      .where(eq(recipeShopifyProductsTable.recipeId, recipeId));

    // Link the 2 Pack to the recipe so its sales reach the planner — the same
    // way the test-box flow does ("keep": never steals another recipe's link).
    const linkedVariants: string[] = [];
    const conflicts: string[] = [];
    for (const v of res.variants) {
      const l = await linkVariantToRecipe(db, { recipeId, shopifyVariantId: v.id, shopifyProductTitle: res.title, shopifyVariantTitle: v.title, shopifySku: v.sku }, "keep");
      if (l.linked) linkedVariants.push(v.title); else conflicts.push(v.title);
    }
    const linkNote = conflicts.length
      ? ` The ${conflicts.join(", ")} variant is already linked to another recipe — not changed.`
      : linkedVariants.length ? ` Its ${linkedVariants.join(", ")} is linked to the recipe, so sales reach the planner.` : "";
    return {
      outcome: p.action === "create" ? "created" : "finished",
      message: (p.action === "create" ? "Made as a draft in Shopify — nothing is published." : "Finished the draft the app started.") + linkNote,
      product: productLink({ productId: res.productId, title: res.title, status: res.status }),
      steps: res.steps,
      linkedVariants,
    };
  } catch (err) {
    if (err instanceof ShopifyWritesBlockedError) {
      return { outcome: "blocked", message: err.message, product: null, steps: [], linkedVariants: [] };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[recipe-shopify-product] recipe ${recipeId}:`, msg);
    await db.update(recipeShopifyProductsTable).set({ lastError: msg.slice(0, 1000), updatedAt: new Date() })
      .where(eq(recipeShopifyProductsTable.recipeId, recipeId));
    throw err;
  }
}

// ── Status (for the recipe's Shopify tab, before any preview) ───────────────
export interface RecipeShopifyStatus {
  /** linked = sold through these products; started = the app made one but it isn't linked yet; none */
  state: "linked" | "started" | "none";
  products: Array<{ title: string; variantTitle: string | null; adminUrl: string | null; status: string | null }>;
  started: (ProductLink & { lastError: string | null }) | null;
  /** The Shopify read failed — products are listed from the planner's own links. */
  shopifyUnreachable: boolean;
}

export async function recipeShopifyStatus(recipeId: number, port: ShopifyPort): Promise<RecipeShopifyStatus> {
  const rows = (await db.execute<{ shopify_variant_id: string; shopify_product_title: string | null; shopify_variant_title: string | null }>(sql`
    SELECT shopify_variant_id, shopify_product_title, shopify_variant_title FROM recipe_shopify_mappings WHERE recipe_id = ${recipeId} ORDER BY created_at
  `)).rows;
  const [made] = await db.select().from(recipeShopifyProductsTable).where(eq(recipeShopifyProductsTable.recipeId, recipeId));
  let found: Awaited<ReturnType<typeof fetchVariantProducts>> | null = null;
  try {
    found = await fetchVariantProducts(port, rows.map(r => String(r.shopify_variant_id)));
  } catch (err) {
    console.warn("[recipe-shopify-product] status read failed:", err instanceof Error ? err.message : err);
  }
  const products: RecipeShopifyStatus["products"] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = found?.get(String(r.shopify_variant_id));
    if (found && !v) continue; // gone from Shopify
    const key = v?.productId ?? `t:${r.shopify_product_title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(v
      ? { title: v.title, variantTitle: v.variantTitle, adminUrl: productLink({ productId: v.productId, title: v.title, status: v.status }).adminUrl, status: v.status }
      : { title: r.shopify_product_title ?? "Shopify product", variantTitle: r.shopify_variant_title, adminUrl: null, status: null });
  }
  const started = made && products.length === 0
    ? { ...productLink({ productId: made.shopifyProductId, title: made.productTitle ?? "Draft product", status: "DRAFT" }), lastError: made.lastError }
    : null;
  return { state: products.length ? "linked" : started ? "started" : "none", products, started, shopifyUnreachable: found == null && rows.length > 0 };
}

// ── What the AI draft is written from ───────────────────────────────────────
export async function listingRecipeData(recipeId: number): Promise<ListingRecipeData | null> {
  const [r] = await db.select({
    name: recipesTable.name, description: recipesTable.description, category: recipesTable.category, tags: recipesTable.tags, notes: recipesTable.notes,
  }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!r) return null;
  const ings = await db.select({ name: ingredientsTable.name }).from(recipeIngredientsTable)
    .innerJoin(ingredientsTable, eq(ingredientsTable.id, recipeIngredientsTable.ingredientId))
    .where(eq(recipeIngredientsTable.recipeId, recipeId)).orderBy(desc(recipeIngredientsTable.quantity));
  const subs = await db.select({ name: subRecipesTable.name }).from(recipeSubRecipesTable)
    .innerJoin(subRecipesTable, eq(subRecipesTable.id, recipeSubRecipesTable.subRecipeId))
    .where(eq(recipeSubRecipesTable.recipeId, recipeId)).orderBy(desc(recipeSubRecipesTable.quantity));
  return {
    name: r.name, description: r.description, category: r.category, tags: r.tags ?? [], notes: r.notes,
    ingredients: [...new Set(ings.map(i => i.name))],
    subRecipes: [...new Set(subs.map(s => s.name))],
  };
}

