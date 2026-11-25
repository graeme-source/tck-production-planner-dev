/**
 * "Create F2F product" from a recipe (Graeme, 25 Nov 2026) — the preview
 * (reads only) and the run (guarded writes + the database side). Objective C.
 *
 *   preview  which product is the recipe's MAIN (the one it's linked to),
 *            exactly what will be made (title, variants, prices, tags, type),
 *            and anything that blocks it — e.g. an "F2F - …" copy already in
 *            Shopify (link that instead).
 *   run      CLAIM the recipe's f2f_product_creations row (a double tap gets
 *            "already being made"), make it (f2f-product-shopify.ts), store
 *            the product id the moment Shopify returns it, then link the
 *            recipe to the new variant (recipes.f2f_variant_id) and record
 *            who made it. A run that fails part-way is finished by the next
 *            run, never duplicated.
 * Rules: f2f-product-rules.ts.
 */
import { db, f2fProductCreationsTable, recipesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  F2F_CREATE_SCOPES, f2fCreateBlockers, f2fProductType, f2fTagsFromMain, f2fTitle, isF2fOf,
  pickF2fLinkVariant, pickMainProduct, type MainProductCandidate,
} from "./f2f-product-rules";
import { applyF2fProduct } from "./f2f-product-shopify";
import { fetchAccessScopes, fetchProducts, fetchVariantProducts, searchProducts, type ShopifyPort } from "./test-box-shopify";
import { RunRefused } from "./test-box-shopify-run";
import { missingWriteScopes } from "./test-box-shopify-rules";
import { setRecipeF2fLink } from "./recipe-f2f-link";
import { getWrapLocationSetting } from "./shopify-wrap-push";
import { ShopifyWritesBlockedError } from "../services/shopify";

export { RunRefused };

export interface F2fCreatePreview {
  recipeId: number;
  recipeName: string;
  main: { productId: string; title: string; status: string; tags: string[]; productType: string } | null;
  /** The recipe's other linked products, to pick a different main. */
  otherProducts: Array<{ productId: string; title: string }>;
  create: {
    title: string;
    status: "ACTIVE";
    productType: string;
    tags: string[];
    keptTags: string[];
    strippedTags: Array<{ tag: string; why: string }>;
    variants: Array<{ title: string; price: string }>;
    imageCount: number;
    linkVariantTitle: string | null;
  } | null;
  /** A product made by an earlier run that didn't finish (finished, not copied again). */
  resuming: { shopifyProductId: string; lastError: string | null } | null;
  blockers: string[];
  writesBlocked: boolean;
  blockedMessage: string | null;
}

interface Plan {
  preview: F2fCreatePreview;
  mainProductId: string | null;
  mainLinkedVariantTitle: string | null;
  resumeProductId: string | null;
}

async function buildPlan(recipeId: number, requestedMain: string | null, port: ShopifyPort, writesBlocked: boolean): Promise<Plan> {
  const [r] = await db.select({
    id: recipesTable.id, name: recipesTable.name, archivedAt: recipesTable.archivedAt,
    f2fVariantId: recipesTable.f2fVariantId, f2fProductTitle: recipesTable.f2fProductTitle,
  }).from(recipesTable).where(eq(recipesTable.id, recipeId));
  if (!r) throw new RunRefused(404, "Recipe not found");

  const mappings = (await db.execute<{ shopify_variant_id: string; shopify_variant_title: string | null }>(sql`
    SELECT shopify_variant_id, shopify_variant_title FROM recipe_shopify_mappings
     WHERE recipe_id = ${recipeId} AND shopify_variant_id IS NOT NULL ORDER BY id
  `)).rows.map(m => ({ variantId: String(m.shopify_variant_id), variantTitle: m.shopify_variant_title }));
  const [made] = await db.select().from(f2fProductCreationsTable).where(eq(f2fProductCreationsTable.recipeId, recipeId));

  const [variantProducts, scopes] = await Promise.all([
    fetchVariantProducts(port, mappings.map(m => m.variantId)),
    fetchAccessScopes(port),
  ]);
  const byProduct = new Map<string, MainProductCandidate>();
  for (const m of mappings) {
    const v = variantProducts.get(m.variantId);
    if (!v) continue;
    const c = byProduct.get(v.productId) ?? { productId: v.productId, title: v.title, status: v.status, mappedVariantIds: [] };
    c.mappedVariantIds.push(m.variantId);
    byProduct.set(v.productId, c);
  }
  const candidates = [...byProduct.values()];
  const mainPick = pickMainProduct(candidates, requestedMain);
  const snap = mainPick ? (await fetchProducts(port, [mainPick.productId])).get(mainPick.productId) ?? null : null;
  const title = snap ? f2fTitle(snap.title) : null;

  const resumeProductId = made?.shopifyProductId && made.state !== "complete" ? made.shopifyProductId : null;
  const existing = title && snap
    ? (await searchProducts(port, title)).filter(p => isF2fOf(p.title, snap.title) && p.productId !== resumeProductId)
    : [];

  const linkedVariantTitle = mainPick ? (mappings.find(m => mainPick.mappedVariantIds.includes(m.variantId))?.variantTitle ?? null) : null;
  const tagPlan = snap ? f2fTagsFromMain(snap.tags) : null;
  const blockers = f2fCreateBlockers({
    alreadyLinked: r.f2fVariantId ? { title: r.f2fProductTitle ?? "linked" } : null,
    main: snap ? { title: snap.title, variantCount: snap.variants.length } : null,
    existingF2f: existing.map(p => ({ productId: p.productId, title: p.title })),
    missingScopes: missingWriteScopes(scopes, F2F_CREATE_SCOPES),
    writesBlocked,
  });
  if (r.archivedAt) blockers.push("This recipe is archived.");

  return {
    mainProductId: snap?.id ?? null,
    mainLinkedVariantTitle: linkedVariantTitle,
    resumeProductId,
    preview: {
      recipeId, recipeName: r.name.trim(),
      main: snap ? { productId: snap.id, title: snap.title, status: snap.status, tags: snap.tags, productType: snap.productType } : null,
      otherProducts: candidates.filter(c => c.productId !== snap?.id && f2fTitle(c.title) !== null).map(c => ({ productId: c.productId, title: c.title })),
      create: snap && title && tagPlan ? {
        title, status: "ACTIVE", productType: f2fProductType(snap.productType),
        tags: tagPlan.tags, keptTags: tagPlan.kept, strippedTags: tagPlan.stripped,
        variants: snap.variants.map(v => ({ title: v.title, price: v.price })),
        imageCount: snap.imageCount,
        linkVariantTitle: pickF2fLinkVariant(snap.variants, linkedVariantTitle)?.title ?? null,
      } : null,
      resuming: resumeProductId ? { shopifyProductId: resumeProductId, lastError: made?.lastError ?? null } : null,
      blockers,
      writesBlocked,
      blockedMessage: writesBlocked ? new ShopifyWritesBlockedError("preview").message : null,
    },
  };
}

export async function previewF2fCreate(recipeId: number, requestedMain: string | null, port: ShopifyPort, writesBlocked: boolean): Promise<F2fCreatePreview> {
  return (await buildPlan(recipeId, requestedMain, port, writesBlocked)).preview;
}

export interface F2fCreateResult {
  outcome: "created" | "finished";
  productId: string;
  title: string;
  linked: { variantId: string; variantTitle: string } | null;
  linkError: string | null;
  steps: string[];
}

/**
 * Make the F2F product. `expectedTitle` is the title on the confirm card —
 * if the main product changed in between, the run refuses rather than make
 * something the person didn't see.
 */
export async function runF2fCreate(
  recipeId: number,
  opts: { mainProductId?: string | null; expectedTitle: string },
  user: { id: number; name: string },
  port: ShopifyPort,
  writesBlocked: boolean,
): Promise<F2fCreateResult> {
  const plan = await buildPlan(recipeId, opts.mainProductId ?? null, port, writesBlocked);
  const p = plan.preview;
  if (p.blockers.length) throw new RunRefused(409, `${p.blockers.join(" ")} Nothing was changed.`);
  if (!p.create || !plan.mainProductId) throw new RunRefused(409, "There's no main product to copy. Nothing was changed.");
  if (p.create.title !== opts.expectedTitle) throw new RunRefused(409, `The main product has changed since you checked (it would now be "${p.create.title}"). Check again. Nothing was changed.`);

  // The claim: only one run per recipe at a time (a stale claim — a crash
  // mid-run — frees itself after 10 minutes).
  const claimed = await db.execute<{ id: number }>(sql`
    INSERT INTO f2f_product_creations (recipe_id, main_product_id, product_title, state, created_by_id, created_by_name)
    VALUES (${recipeId}, ${plan.mainProductId}, ${p.create.title}, 'creating', ${user.id}, ${user.name})
    ON CONFLICT (recipe_id) DO UPDATE
       SET state = 'creating', main_product_id = EXCLUDED.main_product_id, product_title = EXCLUDED.product_title,
           last_error = NULL, created_by_id = EXCLUDED.created_by_id, created_by_name = EXCLUDED.created_by_name, updated_at = NOW()
     WHERE f2f_product_creations.state <> 'creating' OR f2f_product_creations.updated_at < NOW() - INTERVAL '10 minutes'
    RETURNING id
  `);
  if (!claimed.rows.length) throw new RunRefused(409, "This F2F product is already being made — wait a moment, then check again.");

  const location = await getWrapLocationSetting();
  try {
    const res = await applyF2fProduct(port, {
      mainProductId: plan.mainProductId,
      existingProductId: plan.resumeProductId,
      title: p.create.title,
      tags: p.create.tags,
      productType: p.create.productType,
      locationGid: location,
    }, async (productId) => {
      // Stored before anything else happens to it — a later failure can
      // never lead to a second copy.
      await db.update(f2fProductCreationsTable)
        .set({ shopifyProductId: productId, state: "created", updatedAt: new Date() })
        .where(eq(f2fProductCreationsTable.recipeId, recipeId));
    });

    const v = pickF2fLinkVariant(res.variants, plan.mainLinkedVariantTitle);
    let linkError: string | null = null;
    if (v) {
      const link = await setRecipeF2fLink(recipeId, { variantId: v.id, productTitle: p.create.title, variantTitle: v.title });
      if (!link.ok) linkError = link.error;
    } else linkError = "The new product has no variants to link.";
    const steps = [...res.steps, v && !linkError ? `Linked to the recipe (${v.title})` : `Not linked: ${linkError}`];

    await db.update(f2fProductCreationsTable)
      .set({ state: "complete", shopifyProductId: res.productId, linkedVariantId: v && !linkError ? v.id : null, steps, lastError: linkError, updatedAt: new Date() })
      .where(eq(f2fProductCreationsTable.recipeId, recipeId));
    console.log(`[f2f-product] ${user.name} made "${p.create.title}" (product ${res.productId}) for recipe ${recipeId}`);
    return {
      outcome: plan.resumeProductId ? "finished" : "created",
      productId: res.productId, title: p.create.title,
      linked: v && !linkError ? { variantId: v.id, variantTitle: v.title } : null,
      linkError, steps,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(f2fProductCreationsTable)
      .set({ state: "failed", lastError: msg, updatedAt: new Date() })
      .where(eq(f2fProductCreationsTable.recipeId, recipeId));
    throw err;
  }
}
