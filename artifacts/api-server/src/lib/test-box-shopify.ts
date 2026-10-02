/**
 * Test box → Shopify draft products: the SHOPIFY side (reads + guarded
 * writes). Everything goes through a ShopifyPort so tests can run the whole
 * create/update sequence against a fake store with no network. The rules
 * (tags, metafields, what to remove, idempotency) are in
 * test-box-shopify-rules.ts; the inspection notes on how Graeme sets these
 * products up by hand are at the top of that file.
 *
 * Writes (Admin GraphQL 2026-01, all need the write_products scope):
 *   productDuplicate(productId, newTitle, newStatus: DRAFT, includeImages)
 *   productUpdate(product: { id, title, tags, descriptionHtml, status })
 *   productVariantsBulkUpdate(productId, variants: [{ id, barcode: null }])
 *   metafieldsDelete / metafieldsSet
 *   collectionCreate(input: { title, ruleSet: TAG EQUALS box, sortOrder })
 *   discountCodeBasicCreate(basicCodeDiscount) — needs write_discounts
 * The app's Shopify connection had NEITHER write_products NOR write_discounts
 * on 2026-10-02 (read-only check of currentAppInstallation.accessScopes), so
 * the previews say so and the creates refuse until the scopes are added.
 * Every write goes through ShopifyPort.write → shopifyGraphQLWrite, which
 * refuses (throws ShopifyWritesBlockedError) on staging or with
 * BLOCK_SHOPIFY_WRITES=true. Nothing is ever published or set Active.
 */
import { shopifyGraphQL, shopifyGraphQLWrite } from "../services/shopify";
import {
  metafieldPlan, productSearchQuery, type CollectionInfo, type MetafieldRef, type MetafieldValue, type RecipeContent, type TemplateCandidate,
} from "./test-box-shopify-rules";
import type { ExistingDiscount } from "./test-box-discount-rules";

export interface ShopifyPort {
  read<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  write<T>(operation: string, query: string, variables?: Record<string, unknown>): Promise<T>;
}

export const liveShopify: ShopifyPort = {
  read: (q, v) => shopifyGraphQL(q, v),
  write: (op, q, v) => shopifyGraphQLWrite(op, q, v),
};

const PRODUCT_GID = "gid://shopify/Product/";
const VARIANT_GID = "gid://shopify/ProductVariant/";
const COLLECTION_GID = "gid://shopify/Collection/";
export const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);
export const productGid = (id: string) => (id.startsWith("gid://") ? id : `${PRODUCT_GID}${id}`);
export const variantGid = (id: string) => (id.startsWith("gid://") ? id : `${VARIANT_GID}${id}`);

type UserErrors = Array<{ field?: string[] | null; message: string }>;
function check(op: string, errs: UserErrors | undefined) {
  if (errs && errs.length) throw new Error(`Shopify refused ${op}: ${errs.map(e => e.message).join("; ")}`);
}

// ── Reads ───────────────────────────────────────────────────────────────────
export interface ProductSnapshot {
  id: string; // numeric
  title: string;
  handle: string;
  status: string;
  tags: string[];
  productType: string;
  imageCount: number;
  imageUrl: string | null;
  variants: Array<{ id: string; title: string; price: string; sku: string | null; barcode: string | null }>;
  metafields: MetafieldValue[];
}

const PRODUCT_FIELDS = `
  id title handle status tags productType
  media(first: 20) { nodes { id } }
  featuredMedia { preview { image { url } } }
  variants(first: 20) { nodes { id title price sku barcode } }
  metafields(first: 100) { nodes { namespace key type value } }`;

type RawProduct = {
  id: string; title: string; handle: string; status: string; tags: string[]; productType: string;
  media: { nodes: Array<{ id: string }> };
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: Array<{ id: string; title: string; price: string; sku: string | null; barcode: string | null }> };
  metafields: { nodes: MetafieldValue[] };
};

function snapshot(p: RawProduct): ProductSnapshot {
  return {
    id: numericId(p.id), title: p.title, handle: p.handle, status: p.status, tags: p.tags, productType: p.productType ?? "",
    imageCount: p.media?.nodes?.length ?? 0,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    variants: (p.variants?.nodes ?? []).map(v => ({ ...v, id: numericId(v.id) })),
    metafields: p.metafields?.nodes ?? [],
  };
}

/** Products by numeric id; ones that no longer exist are simply absent. */
export async function fetchProducts(port: ShopifyPort, ids: string[]): Promise<Map<string, ProductSnapshot>> {
  const out = new Map<string, ProductSnapshot>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return out;
  const r = await port.read<{ nodes: Array<RawProduct | null> }>(
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } } }`,
    { ids: unique.map(productGid) },
  );
  for (const n of r.nodes) if (n?.id) out.set(numericId(n.id), snapshot(n));
  return out;
}

/** Variant id → its product (title, status). Missing variants are absent. */
export async function fetchVariantProducts(port: ShopifyPort, variantIds: string[]): Promise<Map<string, { productId: string; title: string; status: string; variantTitle: string }>> {
  const out = new Map<string, { productId: string; title: string; status: string; variantTitle: string }>();
  const unique = [...new Set(variantIds.filter(Boolean))];
  if (!unique.length) return out;
  const r = await port.read<{ nodes: Array<{ id: string; title: string; product: { id: string; title: string; status: string } } | null> }>(
    `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id title product { id title status } } } }`,
    { ids: unique.map(variantGid) },
  );
  for (const n of r.nodes) {
    if (n?.product) out.set(numericId(n.id), { productId: numericId(n.product.id), title: n.product.title, status: n.product.status, variantTitle: n.title });
  }
  return out;
}

export async function fetchTemplateCandidates(port: ShopifyPort, query: string): Promise<TemplateCandidate[]> {
  const r = await port.read<{ products: { nodes: Array<{ id: string; title: string; status: string; tags: string[]; createdAt: string }> } }>(
    `query($q: String!) { products(first: 15, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id title status tags createdAt } } }`,
    { q: query },
  );
  return r.products.nodes.map(p => ({ productId: numericId(p.id), title: p.title, status: p.status, tags: p.tags, createdAt: p.createdAt }));
}

export async function fetchCollections(port: ShopifyPort): Promise<CollectionInfo[]> {
  const r = await port.read<{ collections: { nodes: Array<{ id: string; title: string; handle: string; sortOrder: string; templateSuffix: string | null; ruleSet: { rules: Array<{ column: string; relation: string; condition: string }> } | null }> } }>(
    `{ collections(first: 250) { nodes { id title handle sortOrder templateSuffix ruleSet { rules { column relation condition } } } } }`,
  );
  return r.collections.nodes.map(c => ({
    id: numericId(c.id), title: c.title, handle: c.handle, sortOrder: c.sortOrder, templateSuffix: c.templateSuffix,
    rules: c.ruleSet?.rules ?? null,
  }));
}

export async function fetchAccessScopes(port: ShopifyPort): Promise<string[]> {
  const r = await port.read<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(
    `{ currentAppInstallation { accessScopes { handle } } }`,
  );
  return r.currentAppInstallation.accessScopes.map(s => s.handle);
}

export interface SearchHit { productId: string; title: string; status: string; tags: string[]; imageUrl: string | null; variants: Array<{ id: string; title: string; sku: string | null }> }

/** Read-only product search for "Link an existing product". */
export async function searchProducts(port: ShopifyPort, text: string): Promise<SearchHit[]> {
  const q = productSearchQuery(text);
  if (!q) return [];
  const r = await port.read<{ products: { nodes: Array<{ id: string; title: string; status: string; tags: string[]; featuredMedia: { preview: { image: { url: string } | null } | null } | null; variants: { nodes: Array<{ id: string; title: string; sku: string | null }> } }> } }>(
    `query($q: String!) { products(first: 12, query: $q, sortKey: RELEVANCE) { nodes { id title status tags featuredMedia { preview { image { url } } } variants(first: 10) { nodes { id title sku } } } } }`,
    { q },
  );
  return r.products.nodes.map(p => ({
    productId: numericId(p.id), title: p.title, status: p.status, tags: p.tags,
    imageUrl: p.featuredMedia?.preview?.image?.url ?? null,
    variants: p.variants.nodes.map(v => ({ id: numericId(v.id), title: v.title, sku: v.sku })),
  }));
}

// ── Writes ──────────────────────────────────────────────────────────────────
export interface ApplyInput {
  action: "create" | "update";
  templateProductId: string | null;
  existingProductId: string | null;
  title: string;
  tags: string[];
  descriptionHtml: string;
  includeImages: boolean;
  content: RecipeContent;
  standardCooking: string;
}

export interface ApplyResult {
  productId: string;
  title: string;
  status: string;
  variants: Array<{ id: string; title: string; sku: string | null }>;
  steps: string[];
}

/**
 * Make (or update) one recipe's product. `onDuplicated` is called the moment
 * Shopify returns the new product's id — BEFORE anything else — so the caller
 * can store it and a failure further on can't lead to a second duplicate.
 */
export async function applyRecipeProduct(port: ShopifyPort, input: ApplyInput, onDuplicated: (productId: string) => Promise<void>): Promise<ApplyResult> {
  const steps: string[] = [];
  let productId = input.existingProductId;

  if (input.action === "create") {
    if (!input.templateProductId) throw new Error("No template product to duplicate");
    const r = await port.write<{ productDuplicate: { newProduct: { id: string } | null; userErrors: UserErrors } }>(
      "productDuplicate",
      `mutation($productId: ID!, $newTitle: String!, $includeImages: Boolean) {
        productDuplicate(productId: $productId, newTitle: $newTitle, newStatus: DRAFT, includeImages: $includeImages, synchronous: true) {
          newProduct { id }
          userErrors { field message }
        }
      }`,
      { productId: productGid(input.templateProductId), newTitle: input.title, includeImages: input.includeImages },
    );
    check("the duplicate", r.productDuplicate.userErrors);
    if (!r.productDuplicate.newProduct) throw new Error("Shopify didn't return the new product");
    productId = numericId(r.productDuplicate.newProduct.id);
    await onDuplicated(productId);
    steps.push(`Duplicated the template as a draft${input.includeImages ? " with its images" : " without images"}`);
  }
  if (!productId) throw new Error("No product to update");

  const product = (await fetchProducts(port, [productId])).get(productId);
  if (!product) throw new Error("The product isn't in Shopify any more");

  // Title, exact tags, description; status DRAFT only on the first make —
  // a re-run never un-publishes a product that has gone live.
  const u = await port.write<{ productUpdate: { userErrors: UserErrors } }>(
    "productUpdate",
    `mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`,
    {
      product: {
        id: productGid(productId), title: input.title, tags: input.tags, descriptionHtml: input.descriptionHtml,
        ...(input.action === "create" ? { status: "DRAFT" } : {}),
      },
    },
  );
  check("the product update", u.productUpdate.userErrors);
  steps.push(input.action === "create" ? "Set title, tags and description; status Draft" : "Updated title, tags and description");

  // Barcodes blank on a new product (GS1 numbers go on by hand). Never on a
  // re-run — they may have been added since.
  if (input.action === "create" && product.variants.length) {
    const b = await port.write<{ productVariantsBulkUpdate: { userErrors: UserErrors } }>(
      "productVariantsBulkUpdate",
      `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
      }`,
      { productId: productGid(productId), variants: product.variants.map(v => ({ id: variantGid(v.id), barcode: null })) },
    );
    check("clearing the barcodes", b.productVariantsBulkUpdate.userErrors);
    steps.push("Cleared the barcode");
  }

  const plan = metafieldPlan(input.content, product.metafields, input.standardCooking);
  if (plan.remove.length) {
    const d = await port.write<{ metafieldsDelete: { userErrors: UserErrors } }>(
      "metafieldsDelete",
      `mutation($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { field message } } }`,
      { metafields: plan.remove.map((m: MetafieldRef) => ({ ownerId: productGid(productId!), namespace: m.namespace, key: m.key })) },
    );
    check("removing the template's details", d.metafieldsDelete.userErrors);
    steps.push(`Removed the template's ${plan.remove.map(m => `${m.namespace}.${m.key}`).join(", ")}`);
  }
  if (plan.set.length) {
    const s = await port.write<{ metafieldsSet: { userErrors: UserErrors } }>(
      "metafieldsSet",
      `mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
      { metafields: plan.set.map(m => ({ ownerId: productGid(productId!), namespace: m.namespace, key: m.key, type: m.type, value: m.value })) },
    );
    check("writing the details", s.metafieldsSet.userErrors);
    steps.push(`Wrote ${plan.set.map(m => `${m.namespace}.${m.key}`).join(", ")}`);
  }

  return {
    productId,
    title: input.title,
    status: input.action === "create" ? "DRAFT" : product.status,
    variants: product.variants.map(v => ({ id: v.id, title: v.title, sku: v.sku })),
    steps,
  };
}

/** Create the box's smart collection (tag = box name). Not published. */
export async function createBoxCollection(port: ShopifyPort, settings: { title: string; rule: { column: string; relation: string; condition: string }; sortOrder: string; templateSuffix: string | null }): Promise<string> {
  const r = await port.write<{ collectionCreate: { collection: { id: string } | null; userErrors: UserErrors } }>(
    "collectionCreate",
    `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }`,
    {
      input: {
        title: settings.title,
        ruleSet: { appliedDisjunctively: false, rules: [settings.rule] },
        sortOrder: settings.sortOrder,
        ...(settings.templateSuffix ? { templateSuffix: settings.templateSuffix } : {}),
      },
    },
  );
  check("the collection", r.collectionCreate.userErrors);
  if (!r.collectionCreate.collection) throw new Error("Shopify didn't return the new collection");
  return numericId(r.collectionCreate.collection.id);
}

export const collectionGid = (id: string) => `${COLLECTION_GID}${id}`;

// ── Discount codes ──────────────────────────────────────────────────────────
type RawBasic = {
  __typename: string;
  title?: string;
  appliesOncePerCustomer?: boolean;
  usageLimit?: number | null;
  combinesWith?: { orderDiscounts: boolean; productDiscounts: boolean; shippingDiscounts: boolean };
  customerGets?: {
    appliesOnOneTimePurchase: boolean;
    appliesOnSubscription: boolean;
    value: { __typename: string; percentage?: number };
    items: { __typename: string; collections?: { nodes: Array<{ title: string }> } };
  };
};

/** Earlier "CC…" codes, newest first — the test-box ones are copied. */
export async function fetchEarlierCodes(port: ShopifyPort): Promise<ExistingDiscount[]> {
  const r = await port.read<{ codeDiscountNodes: { nodes: Array<{ codeDiscount: RawBasic }> } }>(
    `{ codeDiscountNodes(first: 25, query: "title:CC*", sortKey: CREATED_AT, reverse: true) { nodes { codeDiscount { __typename
      ... on DiscountCodeBasic { title appliesOncePerCustomer usageLimit
        combinesWith { orderDiscounts productDiscounts shippingDiscounts }
        customerGets { appliesOnOneTimePurchase appliesOnSubscription
          value { __typename ... on DiscountPercentage { percentage } }
          items { __typename ... on DiscountCollections { collections(first: 5) { nodes { title } } } } } } } } } }`,
  );
  return r.codeDiscountNodes.nodes
    .map(n => n.codeDiscount)
    .filter(c => c.__typename === "DiscountCodeBasic" && c.customerGets && c.combinesWith)
    .map(c => ({
      title: c.title ?? "",
      percentage: c.customerGets!.value.__typename === "DiscountPercentage" ? c.customerGets!.value.percentage ?? null : null,
      collectionTitles: c.customerGets!.items.collections?.nodes.map(n => n.title) ?? [],
      combinesWith: c.combinesWith!,
      appliesOncePerCustomer: c.appliesOncePerCustomer ?? false,
      usageLimit: c.usageLimit ?? null,
      appliesOnOneTimePurchase: c.customerGets!.appliesOnOneTimePurchase,
      appliesOnSubscription: c.customerGets!.appliesOnSubscription,
    }));
}

export async function discountCodeTaken(port: ShopifyPort, code: string): Promise<boolean> {
  const r = await port.read<{ codeDiscountNodeByCode: { id: string } | null }>(
    `query($code: String!) { codeDiscountNodeByCode(code: $code) { id } }`, { code },
  );
  return r.codeDiscountNodeByCode != null;
}

/** discountCodeBasicCreate. Returns the new discount's numeric id, or
 *  "taken" when Shopify says the code already exists. */
export async function createDiscountCode(port: ShopifyPort, input: Record<string, unknown>): Promise<{ id: string } | "taken"> {
  const r = await port.write<{ discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: Array<{ field?: string[] | null; code?: string | null; message: string }> } }>(
    "discountCodeBasicCreate",
    `mutation($d: DiscountCodeBasicInput!) { discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field code message } } }`,
    { d: input },
  );
  const errs = r.discountCodeBasicCreate.userErrors;
  if (errs.some(e => e.code === "TAKEN" || /already|unique|taken/i.test(e.message))) return "taken";
  check("the discount code", errs);
  if (!r.discountCodeBasicCreate.codeDiscountNode) throw new Error("Shopify didn't return the new discount");
  return { id: numericId(r.discountCodeBasicCreate.codeDiscountNode.id) };
}
