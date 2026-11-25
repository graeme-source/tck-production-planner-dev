/**
 * "Create F2F product" — the Shopify side (reads + guarded writes), through a
 * ShopifyPort so the whole sequence is tested against a fake store
 * (f2f-product-shopify.test.ts). Rules: ./f2f-product-rules.ts. The database
 * side (claim, audit, link) is ./f2f-product.ts.
 *
 * The sequence, for a recipe's main product M:
 *   1. productDuplicate(M, "F2F - <M title>", DRAFT, with images) — copies
 *      M's variants, prices, images, description, template and metafields.
 *      Made as a DRAFT so it is never live with M's menu tags for a moment.
 *      `onDuplicated` stores the new id before anything else happens.
 *   2. productUpdate: title, exactly the F2F tags, product type (never
 *      "Calzones").
 *   3. collectionRemoveProducts from every MANUAL collection the copy landed
 *      in (smart collections follow the tags/type on their own).
 *   4. Stock: every variant tracked (inventoryItemUpdate), stocked at the
 *      pinned wrapping location (inventoryActivate), and on-hand 0 everywhere
 *      (inventoryAdjustQuantities by −on-hand, with an idempotency key).
 *   5. productUpdate status ACTIVE — last, once everything above is right.
 * A re-run on a product already duplicated (`existingProductId`) skips 1 and
 * redoes 2–5, which are all safe to repeat.
 *
 * Every write goes through ShopifyPort.write → shopifyGraphQLWrite, which
 * refuses (throws ShopifyWritesBlockedError) on staging or with
 * BLOCK_SHOPIFY_WRITES=true — so the first write stops the run and nothing
 * is changed.
 */
import { numericId, productGid, type ShopifyPort } from "./test-box-shopify";
import { manualCollections, zeroOnHandChanges } from "./f2f-product-rules";

type UserErrors = Array<{ field?: string[] | null; message: string }>;
function check(what: string, errs: UserErrors | undefined) {
  if (errs && errs.length) throw new Error(`Shopify refused ${what}: ${errs.map(e => e.message).join("; ")}`);
}

export interface F2fApplyInput {
  mainProductId: string;
  existingProductId: string | null;
  title: string;
  tags: string[];
  productType: string;
  /** The pinned wrapping location (shopify_wrap_location_id), if set. */
  locationGid: string | null;
}

export interface F2fVariantState {
  id: string; // numeric
  title: string;
  price: string;
  inventoryItemId: string | null; // gid
  tracked: boolean;
  levels: Array<{ locationId: string; onHand: number | null }>;
}

export interface F2fApplyResult {
  productId: string;
  variants: Array<{ id: string; title: string; price: string }>;
  steps: string[];
}

type RawVariant = {
  id: string; title: string; price: string;
  inventoryItem: { id: string; tracked: boolean; inventoryLevels: { nodes: Array<{ location: { id: string }; quantities: Array<{ name: string; quantity: number }> }> } } | null;
};

export const F2F_PRODUCT_READ = `query($id: ID!) { product(id: $id) {
  id title status
  collections(first: 50) { nodes { id title ruleSet { appliedDisjunctively } } }
  variants(first: 50) { nodes { id title price inventoryItem { id tracked
    inventoryLevels(first: 20) { nodes { location { id } quantities(names: ["on_hand"]) { name quantity } } } } } }
} }`;

export async function readF2fProduct(port: ShopifyPort, productId: string): Promise<{
  collections: Array<{ id: string; title: string; ruleSet: unknown }>;
  variants: F2fVariantState[];
} | null> {
  const r = await port.read<{ product: { collections: { nodes: Array<{ id: string; title: string; ruleSet: unknown }> }; variants: { nodes: RawVariant[] } } | null }>(
    F2F_PRODUCT_READ, { id: productGid(productId) },
  );
  if (!r.product) return null;
  return {
    collections: r.product.collections?.nodes ?? [],
    variants: (r.product.variants?.nodes ?? []).map(v => ({
      id: numericId(v.id), title: v.title, price: v.price,
      inventoryItemId: v.inventoryItem?.id ?? null,
      tracked: v.inventoryItem?.tracked === true,
      levels: (v.inventoryItem?.inventoryLevels?.nodes ?? []).map(l => ({
        locationId: l.location.id,
        onHand: l.quantities.find(q => q.name === "on_hand")?.quantity ?? null,
      })),
    })),
  };
}

export async function applyF2fProduct(port: ShopifyPort, input: F2fApplyInput, onDuplicated: (productId: string) => Promise<void>): Promise<F2fApplyResult> {
  const steps: string[] = [];
  let productId = input.existingProductId;

  if (!productId) {
    const r = await port.write<{ productDuplicate: { newProduct: { id: string } | null; userErrors: UserErrors } }>(
      "productDuplicate",
      `mutation($productId: ID!, $newTitle: String!) {
        productDuplicate(productId: $productId, newTitle: $newTitle, newStatus: DRAFT, includeImages: true, synchronous: true) {
          newProduct { id }
          userErrors { field message }
        }
      }`,
      { productId: productGid(input.mainProductId), newTitle: input.title },
    );
    check("the duplicate", r.productDuplicate.userErrors);
    if (!r.productDuplicate.newProduct) throw new Error("Shopify didn't return the new product");
    productId = numericId(r.productDuplicate.newProduct.id);
    await onDuplicated(productId);
    steps.push("Copied the main product (variants, prices, images, description, template) as a draft");
  } else {
    steps.push("Finishing the F2F product made last time (not copied again)");
  }

  const u = await port.write<{ productUpdate: { userErrors: UserErrors } }>(
    "productUpdate",
    `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`,
    { product: { id: productGid(productId), title: input.title, tags: input.tags, productType: input.productType } },
  );
  check("the title and tags", u.productUpdate.userErrors);
  steps.push(`Set the title, the F2F tags (${input.tags.join(", ")}) and product type ${input.productType ? `"${input.productType}"` : "blank"}`);

  const product = await readF2fProduct(port, productId);
  if (!product) throw new Error("The new product isn't in Shopify any more");

  for (const c of manualCollections(product.collections)) {
    const d = await port.write<{ collectionRemoveProducts: { userErrors: UserErrors } }>(
      "collectionRemoveProducts",
      `mutation($id: ID!, $productIds: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $productIds) { job { id } userErrors { field message } } }`,
      { id: c.id, productIds: [productGid(productId)] },
    );
    check(`taking it out of "${c.title}"`, d.collectionRemoveProducts.userErrors);
    steps.push(`Taken out of the manual collection "${c.title}"`);
  }

  for (const v of product.variants) {
    if (!v.inventoryItemId) { steps.push(`${v.title}: Shopify has no stock record for it — check it in Shopify`); continue; }
    if (!v.tracked) {
      const t = await port.write<{ inventoryItemUpdate: { userErrors: UserErrors } }>(
        "inventoryItemUpdate",
        `mutation($id: ID!, $input: InventoryItemInput!) { inventoryItemUpdate(id: $id, input: $input) { inventoryItem { id tracked } userErrors { field message } } }`,
        { id: v.inventoryItemId, input: { tracked: true } },
      );
      check(`tracking stock for ${v.title}`, t.inventoryItemUpdate.userErrors);
      steps.push(`${v.title}: stock tracking switched on`);
    }
    if (input.locationGid && !v.levels.some(l => l.locationId === input.locationGid)) {
      const a = await port.write<{ inventoryActivate: { userErrors: UserErrors } }>(
        "inventoryActivate",
        `mutation($inventoryItemId: ID!, $locationId: ID!) { inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) { inventoryLevel { id } userErrors { field message } } }`,
        { inventoryItemId: v.inventoryItemId, locationId: input.locationGid },
      );
      check(`stocking ${v.title} at the wrapping location`, a.inventoryActivate.userErrors);
      steps.push(`${v.title}: stocked at the wrapping location`);
    }
    for (const z of zeroOnHandChanges(v.levels)) {
      const key = `f2f-create-zero:${v.id}:${numericId(z.locationId)}:${z.delta}`;
      const q = await port.write<{ inventoryAdjustQuantities: { userErrors: UserErrors } }>(
        "inventoryAdjustQuantities",
        `mutation($input: InventoryAdjustQuantitiesInput!, $key: String!) {
          inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { id } userErrors { field message } }
        }`,
        {
          key,
          input: {
            name: "available", reason: "correction",
            referenceDocumentUri: `gid://tck-production-planner/F2fCreate/${encodeURIComponent(key)}`,
            changes: [{ delta: z.delta, inventoryItemId: v.inventoryItemId, locationId: z.locationId }],
          },
        },
      );
      check(`setting ${v.title}'s stock to 0`, q.inventoryAdjustQuantities.userErrors);
      steps.push(`${v.title}: stock set to 0 (was ${-z.delta})`);
    }
  }
  steps.push("Stock tracked, at 0 on every variant");

  const s = await port.write<{ productUpdate: { userErrors: UserErrors } }>(
    "productUpdate",
    `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`,
    { product: { id: productGid(productId), status: "ACTIVE" } },
  );
  check("setting it Active", s.productUpdate.userErrors);
  steps.push("Set Active (it shows on the site in WonkyZones only while it has stock)");

  return { productId, variants: product.variants.map(v => ({ id: v.id, title: v.title, price: v.price })), steps };
}
