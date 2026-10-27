/**
 * The real Shopify side of barcode-push.ts: a live read of each variant, the
 * "can we write?" check, and the one barcode mutation (productVariantsBulkUpdate
 * through shopifyGraphQLWrite — refused on staging / BLOCK_SHOPIFY_WRITES).
 */
import { shopifyGraphQL, shopifyGraphQLWrite, shopifyWritesBlocked } from "../services/shopify";
import type { LiveVariant, ShopifyBarcodePort } from "./barcode-push";

const variantGid = (id: string) => `gid://shopify/ProductVariant/${id}`;
const productGid = (id: string) => `gid://shopify/Product/${id}`;
const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/** Shopify permission a barcode write needs. */
export const BARCODE_WRITE_SCOPE = "write_products";

let scopeCache: { at: number; scopes: string[] } | null = null;
const SCOPE_TTL_MS = 10 * 60 * 1000;

async function accessScopes(): Promise<string[]> {
  if (scopeCache && Date.now() - scopeCache.at < SCOPE_TTL_MS) return scopeCache.scopes;
  const r = await shopifyGraphQL<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(
    `{ currentAppInstallation { accessScopes { handle } } }`,
  );
  const scopes = r.currentAppInstallation.accessScopes.map(s => s.handle);
  scopeCache = { at: Date.now(), scopes };
  return scopes;
}

/** Why barcode writes can't go from this server now; null = they can.
 *  A failed permission read returns null — the write itself then reports. */
export async function barcodeWritesBlockedReason(): Promise<string | null> {
  if (shopifyWritesBlocked()) return "Shopify writes are switched off on this server (BLOCK_SHOPIFY_WRITES / staging) — waiting to send";
  try {
    const scopes = await accessScopes();
    if (!scopes.includes(BARCODE_WRITE_SCOPE)) {
      return `The app's Shopify connection isn't allowed to change products yet (it needs the ${BARCODE_WRITE_SCOPE} permission) — waiting to send`;
    }
  } catch (err) {
    console.warn("[barcodes] couldn't read Shopify access scopes:", err instanceof Error ? err.message : err);
  }
  return null;
}

export const liveBarcodePort: ShopifyBarcodePort = {
  async read(variantIds) {
    const out = new Map<string, LiveVariant>();
    const ids = [...new Set(variantIds)];
    for (let i = 0; i < ids.length; i += 100) {
      const r = await shopifyGraphQL<{ nodes: Array<{ id?: string; title?: string; barcode?: string | null; product?: { id: string; status: string; title: string } } | null> }>(
        `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id title barcode product { id status title } } } }`,
        { ids: ids.slice(i, i + 100).map(variantGid) },
      );
      for (const n of r.nodes) {
        if (!n?.id || !n.product) continue;
        out.set(numericId(n.id), {
          productId: numericId(n.product.id), barcode: (n.barcode ?? "").trim() || null, status: n.product.status.toLowerCase(),
          productTitle: n.product.title ?? null, variantTitle: n.title ?? null,
        });
      }
    }
    return out;
  },
  blockedReason: barcodeWritesBlockedReason,
  async write(productId, variants) {
    const r = await shopifyGraphQLWrite<{ productVariantsBulkUpdate: { userErrors: Array<{ field?: string[] | null; message: string }> } }>(
      "productVariantsBulkUpdate.barcode",
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
      }`,
      { productId: productGid(productId), variants: variants.map(v => ({ id: variantGid(v.variantId), barcode: v.barcode })) },
    );
    const errs = r.productVariantsBulkUpdate.userErrors;
    if (errs?.length) throw new Error(errs.map(e => e.message).join("; "));
  },
};
