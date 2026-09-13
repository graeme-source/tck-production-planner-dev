import { db, recipesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { shopifyGraphQL } from "../services/shopify";
import { shouldSkipSideEffect, logSkippedSideEffect } from "./app-env";

/**
 * Keeps Shopify's rotating-special markers in step with the planner.
 *
 * The planner's `recipes.is_current_special` flag (unique-indexed to
 * exactly one recipe) is the single source of truth for which recipe
 * the Calzone Club Special DELIVERS. The storefront reads two things
 * derived from it:
 *
 *   - shop metafield `tck.current_special` (JSON snapshot: handle,
 *     variant_id, title, display, image) — drives the Club Special
 *     drawer panel, the cart swap/consent copy, the "This delivery"
 *     checkout property and the switch-back target. The snapshot is
 *     deliberate: a drafted one-time product can't break the display.
 *   - product tag `current-special` — drives the menu badge and which
 *     product the cart upsell offers to swap onto the club plan.
 *
 * Changeover procedure (Graeme, Sep 2026): the operator updates the
 * Club Special's Zapiet delivery dates, then flips is_current_special
 * in the planner. THIS sync notices the flip and updates Shopify —
 * the storefront must never run ahead of it, because renewal orders
 * deliver on a 7-day offset and the old recipe keeps shipping for up
 * to a week after the new one goes on sale one-time.
 */

const TAG = "current-special";
const METAFIELD_NS = "tck";
const METAFIELD_KEY = "current_special";

interface SpecialSnapshot {
  handle: string;
  variant_id: number;
  title: string;
  display: string;
  image: string;
}

let shopGidCache: string | null = null;
async function shopGid(): Promise<string> {
  if (shopGidCache) return shopGidCache;
  const r = await shopifyGraphQL<{ shop: { id: string } }>(`{ shop { id } }`);
  shopGidCache = r.shop.id;
  return shopGidCache;
}

async function loadPlannerSpecial(): Promise<{ recipeId: number; name: string; variantId: string } | null> {
  const [row] = await db
    .select({ id: recipesTable.id, name: recipesTable.name })
    .from(recipesTable)
    .where(eq(recipesTable.isCurrentSpecial, true))
    .limit(1);
  if (!row) return null;
  const result = await db.execute<{ shopify_variant_id: string | null }>(sql`
    SELECT shopify_variant_id FROM recipe_shopify_mappings WHERE recipe_id = ${row.id} LIMIT 1
  `);
  const variantId = result.rows[0]?.shopify_variant_id;
  if (!variantId) return null; // unmapped recipe — nothing safe to sync
  return { recipeId: row.id, name: row.name, variantId: String(variantId) };
}

async function readShopifySnapshot(): Promise<SpecialSnapshot | null> {
  const r = await shopifyGraphQL<{ shop: { metafield: { value: string } | null } }>(
    `{ shop { metafield(namespace: "${METAFIELD_NS}", key: "${METAFIELD_KEY}") { value } } }`,
  );
  if (!r.shop.metafield?.value) return null;
  try {
    return JSON.parse(r.shop.metafield.value) as SpecialSnapshot;
  } catch {
    return null;
  }
}

/** Compare the planner's current special with Shopify's markers and
 *  update Shopify when they differ. Idempotent; safe on an interval. */
export async function syncSpecialToShopify(): Promise<void> {
  const planner = await loadPlannerSpecial();
  if (!planner) return; // no special flagged, or recipe unmapped — leave Shopify alone

  const current = await readShopifySnapshot();
  if (current && String(current.variant_id) === planner.variantId) return; // in sync

  // Resolve the mapped variant's product for the new snapshot.
  const v = await shopifyGraphQL<{
    productVariant: {
      id: string;
      product: {
        id: string;
        handle: string;
        title: string;
        featuredMedia: { preview: { image: { url: string } | null } | null } | null;
      };
    } | null;
  }>(
    `query($id: ID!) { productVariant(id: $id) { id product { id handle title featuredMedia { preview { image { url } } } } } }`,
    { id: `gid://shopify/ProductVariant/${planner.variantId}` },
  );
  if (!v.productVariant) {
    console.error(`[special-sync] mapped variant ${planner.variantId} not found in Shopify — skipping`);
    return;
  }
  const product = v.productVariant.product;

  const snapshot: SpecialSnapshot = {
    handle: product.handle,
    variant_id: Number(planner.variantId),
    title: product.title,
    display: planner.name,
    image: product.featuredMedia?.preview?.image?.url ?? "",
  };

  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("special-sync.update", { from: current?.handle ?? null, to: snapshot.handle });
    return;
  }

  // 1. Snapshot metafield — the storefront's source for all club copy.
  const mf = await shopifyGraphQL<{ metafieldsSet: { userErrors: Array<{ message: string }> } }>(
    `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`,
    {
      m: [
        {
          ownerId: await shopGid(),
          namespace: METAFIELD_NS,
          key: METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(snapshot),
        },
      ],
    },
  );
  if (mf.metafieldsSet.userErrors.length > 0) {
    console.error(`[special-sync] metafieldsSet failed: ${mf.metafieldsSet.userErrors.map(e => e.message).join("; ")}`);
    return; // don't move tags if the snapshot didn't land — keep the pair consistent
  }

  // 2. Move the current-special product tag: off the old special (if any), onto the new.
  if (current?.handle && current.handle !== product.handle) {
    const prev = await shopifyGraphQL<{ products: { nodes: Array<{ id: string }> } }>(
      `query($q: String!) { products(first: 1, query: $q) { nodes { id } } }`,
      { q: `handle:${current.handle}` },
    );
    const prevId = prev.products.nodes[0]?.id;
    if (prevId) {
      await shopifyGraphQL(
        `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`,
        { id: prevId, tags: [TAG] },
      );
    }
  }
  await shopifyGraphQL(
    `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
    { id: product.id, tags: [TAG] },
  );

  console.log(
    `[special-sync] Shopify special updated: ${current?.display ?? "(none)"} -> ${snapshot.display} (${product.handle}, variant ${planner.variantId})`,
  );
}
