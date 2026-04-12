import { shouldSkipSideEffect, logSkippedSideEffect } from "../lib/app-env";

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!;
const CLIENT_SECRET = process.env.SHOPIFY_APP_SHARED_SECRET2!;

const TOKEN_ENDPOINT = `https://${STORE_DOMAIN}/admin/oauth/access_token`;
const API_BASE = `https://${STORE_DOMAIN}/admin/api/2026-01`;

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = json.access_token;
  tokenExpiresAt = now + json.expires_in * 1000;
  return cachedToken;
}

async function shopifyPut(path: string, body: unknown) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function shopifyPost(path: string, body: unknown) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  return res.json();
}

// Parse the Shopify cursor from a `Link` response header.
// Returns the `page_info` value for rel="next", or null if absent.
function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Link header format: <url>; rel="next", <url>; rel="previous"
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      try {
        return new URL(match[1]).searchParams.get("page_info");
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function shopifyFetchRaw(path: string, params?: Record<string, string>): Promise<Response> {
  const token = await getAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }

  return res;
}

async function shopifyFetch(path: string, params?: Record<string, string>) {
  const res = await shopifyFetchRaw(path, params);
  return res.json();
}

export interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  sku: string;
  price: string;
}

export interface ShopifyFulfillment {
  id: number;
  created_at: string;
  updated_at: string;
  status: string;
  tracking_number: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  tags: string;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  subtotal_price: string;
  total_discounts: string;
  total_weight: number;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
  } | null;
  shipping_address: {
    name: string;
    company?: string;
    address1: string;
    address2?: string;
    city: string;
    zip: string;
    country_code?: string;
    phone?: string;
  } | null;
  line_items: ShopifyLineItem[];
  note: string | null;
  fulfillments?: ShopifyFulfillment[];
  refunds?: Array<{
    id: number;
    created_at: string;
    transactions: Array<{ amount: string; kind: string; status: string }>;
  }>;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  variants: Array<{
    id: number;
    title: string;
    sku: string;
    price: string;
    inventory_quantity: number;
  }>;
  image: { src: string } | null;
}

export async function getOrdersByTag(tag: string): Promise<ShopifyOrder[]> {
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;
  const limit = "250";

  do {
    const params: Record<string, string> = {
      limit,
      status: "any",
      fields:
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_weight,customer,shipping_address,line_items,note,fulfillments",
    };
    if (pageInfo) {
      params.page_info = pageInfo;
    } else {
      params.tag = tag;
    }

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);

    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders.filter((o) => o.tags.split(",").map((t) => t.trim()).includes(tag));
}

export async function getProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let pageInfo: string | null = null;

  while (true) {
    const params: Record<string, string> = {
      limit: "250",
      fields: "id,title,status,variants,image",
    };
    if (pageInfo) params.page_info = pageInfo;

    const token = await getAccessToken();
    const url = new URL(`${API_BASE}/products.json`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { products: ShopifyProduct[] };
    allProducts.push(...data.products);

    const linkHeader = res.headers.get("Link") ?? "";
    const nextMatch = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (!nextMatch || data.products.length < 250) break;
    pageInfo = nextMatch[1];
  }

  return allProducts;
}

const productsByTagCache = new Map<string, { data: Set<string>; expiry: number }>();
const PRODUCTS_BY_TAG_TTL_MS = 5 * 60 * 1000;

export async function getProductsByTag(productTag: string): Promise<Set<string>> {
  const cacheKey = productTag.toLowerCase();
  const cached = productsByTagCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.data;

  const titleSet = new Set<string>();
  let pageInfo: string | null = null;

  do {
    const params: Record<string, string> = { limit: "250" };
    if (pageInfo) {
      params.page_info = pageInfo;
    } else {
      params.fields = "id,title,tags";
    }

    const res = await shopifyFetchRaw("/products.json", params);
    const data = (await res.json()) as { products: Array<{ id: number; title: string; tags: string }> };

    for (const p of data.products) {
      const tags = p.tags.split(",").map(t => t.trim().toLowerCase());
      if (tags.includes(cacheKey)) {
        titleSet.add(p.title);
      }
    }

    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  productsByTagCache.set(cacheKey, { data: titleSet, expiry: Date.now() + PRODUCTS_BY_TAG_TTL_MS });
  return titleSet;
}

export interface VariantCount {
  title: string;
  quantity: number;
  orderCount: number;
}

export interface ProductCount {
  productTitle: string;
  variants: VariantCount[];
  totalQuantity: number;
  orderCount: number;
}

export async function countProductsByTag(tag: string): Promise<ProductCount[]> {
  const orders = await getOrdersByTag(tag);
  const counts = new Map<string, ProductCount>();

  for (const order of orders) {
    for (const item of order.line_items) {
      const productKey = item.title;
      const variantKey = item.variant_title ?? "";

      const product = counts.get(productKey);
      if (product) {
        product.totalQuantity += item.quantity;
        product.orderCount += 1;
        const variant = product.variants.find(v => v.title === variantKey);
        if (variant) {
          variant.quantity += item.quantity;
          variant.orderCount += 1;
        } else if (variantKey) {
          product.variants.push({ title: variantKey, quantity: item.quantity, orderCount: 1 });
        }
      } else {
        counts.set(productKey, {
          productTitle: item.title,
          variants: variantKey ? [{ title: variantKey, quantity: item.quantity, orderCount: 1 }] : [],
          totalQuantity: item.quantity,
          orderCount: 1,
        });
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) =>
    a.productTitle.localeCompare(b.productTitle)
  );
}

export async function fulfillOrder(
  orderId: number,
  trackingNumber: string,
  trackingCompany: string = "APC Overnight",
  trackingUrl?: string,
): Promise<void> {
  // Staging: never fulfil real Shopify orders. The staging DB may have
  // been seeded from production, so every orderId here corresponds to a
  // real customer's real order — fulfilling it would send them an APC
  // tracking email and mark the order shipped in the real store.
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.fulfillOrder", { orderId, trackingNumber, trackingCompany });
    return;
  }

  const fulfillmentsRes = (await shopifyFetch(`/orders/${orderId}/fulfillment_orders.json`)) as {
    fulfillment_orders: Array<{ id: number; status: string; line_items: unknown[] }>;
  };

  const pendingFulfillmentOrders = fulfillmentsRes.fulfillment_orders.filter(
    fo => fo.status === "open" || fo.status === "in_progress",
  );

  if (pendingFulfillmentOrders.length === 0) {
    throw new Error("No open fulfillment orders found for this order — it may already be fulfilled.");
  }

  await shopifyPost(`/fulfillments.json`, {
    fulfillment: {
      line_items_by_fulfillment_order: pendingFulfillmentOrders.map(fo => ({
        fulfillment_order_id: fo.id,
      })),
      tracking_info: {
        number: trackingNumber,
        company: trackingCompany,
        url: trackingUrl ?? `https://apc.co.uk/tracking/${trackingNumber}`,
      },
      notify_customer: true,
    },
  });
}

export async function getUnfulfilledOrdersByTag(tag: string): Promise<ShopifyOrder[]> {
  const orders = await getOrdersByTag(tag);
  return orders.filter(o => o.fulfillment_status !== "fulfilled");
}

// Returns fulfilled orders within a date range (UTC), including their fulfillment timestamps.
// Uses updated_at_min/max because the fulfillment event updates the order's updated_at.
export async function getFulfilledOrdersForDateRange(
  fromDate: string, // YYYY-MM-DD
  toDate: string,   // YYYY-MM-DD
): Promise<ShopifyOrder[]> {
  // Convert YYYY-MM-DD to ISO8601 with UTC day boundaries
  const min = `${fromDate}T00:00:00Z`;
  const max = `${toDate}T23:59:59Z`;

  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;

  do {
    const params: Record<string, string> = {
      limit: "250",
      status: "any",
      fulfillment_status: "shipped",
      updated_at_min: min,
      updated_at_max: max,
      fields:
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,customer,fulfillments",
    };
    if (pageInfo) params.page_info = pageInfo;

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  // Only return orders that are definitively fulfilled
  return allOrders.filter(o => o.fulfillment_status === "fulfilled" || o.fulfillment_status === "shipped");
}

// Returns recent unfulfilled orders (last N days) to derive all active dispatch tags.
// Shopify API doesn't support querying by tag-pattern, so we fetch recent open orders.
export async function getRecentUnfulfilledOrders(daysBack = 30): Promise<ShopifyOrder[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;

  do {
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo }
      : {
          limit: "250",
          status: "open",
          fulfillment_status: "unfulfilled",
          created_at_min: since,
          fields:
            "id,name,tags,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_weight,customer,shipping_address,line_items,note",
        };

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders.filter(o => o.fulfillment_status !== "fulfilled");
}

/**
 * Fetch a single order by its Shopify order ID, including line items.
 * Used by the factory-number fulfilment decrement path — we need
 * line_items to know which recipes/quantities to remove from the
 * production fridge when Confirm & Complete fires.
 */
export async function getOrderById(orderId: number): Promise<ShopifyOrder | null> {
  try {
    const data = (await shopifyFetch(`/orders/${orderId}.json`, {
      fields: "id,name,tags,created_at,fulfillment_status,line_items",
    })) as { order: ShopifyOrder };
    return data.order ?? null;
  } catch (err) {
    console.error(`[shopify] getOrderById(${orderId}) failed:`, err);
    return null;
  }
}

// Find a single order by its Shopify order name (e.g. "#1234" or "1234").
export async function findOrderByName(name: string): Promise<ShopifyOrder | null> {
  const searchName = name.startsWith("#") ? name : `#${name}`;
  const data = (await shopifyFetch("/orders.json", {
    name: searchName,
    status: "any",
    fields: "id,name,tags,created_at,financial_status,fulfillment_status,total_price,customer,shipping_address,line_items,note",
  })) as { orders: ShopifyOrder[] };
  return data.orders[0] ?? null;
}

// Adjust inventory level for a Shopify variant by delta (positive = add, negative = remove).
// Resolves the variant → inventory_item_id → location_id chain automatically.
export async function adjustInventoryLevel(variantId: string, delta: number): Promise<{ newQuantity: number }> {
  // Staging: don't touch the real Shopify inventory. Report the delta
  // as if it succeeded (returning newQuantity: 0 is fine because the
  // caller only uses it for logging, not for business logic).
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.adjustInventoryLevel", { variantId, delta });
    return { newQuantity: 0 };
  }

  const variantData = (await shopifyFetch(`/variants/${variantId}.json`)) as {
    variant: { inventory_item_id: number };
  };
  const inventoryItemId = variantData.variant.inventory_item_id;

  const locsData = (await shopifyFetch("/inventory_levels.json", {
    inventory_item_ids: String(inventoryItemId),
    limit: "1",
  })) as { inventory_levels: Array<{ location_id: number; available: number }> };

  if (locsData.inventory_levels.length === 0) {
    throw new Error(`No inventory level found for Shopify variant ${variantId}`);
  }
  const locationId = locsData.inventory_levels[0].location_id;

  const result = (await shopifyPost("/inventory_levels/adjust.json", {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available_adjustment: delta,
  })) as { inventory_level: { available: number } };

  return { newQuantity: result.inventory_level.available };
}

// ── Inventory item costs (for COGS fallback on unmapped products) ────────────

let variantCostCache: { data: Map<string, number>; expiry: number } | null = null;
const COST_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Shopify cost-of-goods for a set of variant IDs.
 * Returns a Map of variant_id → cost (number in shop currency).
 * Results are cached for 1 hour.
 */
export async function getVariantCosts(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();

  // Return from cache if still fresh
  if (variantCostCache && Date.now() < variantCostCache.expiry) {
    const cached = new Map<string, number>();
    for (const vid of variantIds) {
      const cost = variantCostCache.data.get(vid);
      if (cost !== undefined) cached.set(vid, cost);
    }
    if (cached.size === variantIds.length) return cached;
  }

  const result = new Map<string, number>();

  // Step 1: Get inventory_item_id for each variant (batch in groups of 10 to avoid rate limits)
  const inventoryItemMap = new Map<string, number>(); // variant_id → inventory_item_id
  for (let i = 0; i < variantIds.length; i += 10) {
    const batch = variantIds.slice(i, i + 10);
    await Promise.all(batch.map(async (vid) => {
      try {
        const data = (await shopifyFetch(`/variants/${vid}.json`)) as {
          variant: { inventory_item_id: number };
        };
        inventoryItemMap.set(vid, data.variant.inventory_item_id);
      } catch (err) {
        console.warn(`[shopify] Failed to fetch variant ${vid} for cost lookup:`, err);
      }
    }));
    if (i + 10 < variantIds.length) await new Promise(r => setTimeout(r, 250));
  }

  // Step 2: Batch-fetch inventory items (up to 100 IDs per request)
  const invItemIds = [...inventoryItemMap.values()];
  const invItemToVariant = new Map<number, string>();
  for (const [vid, iid] of inventoryItemMap) invItemToVariant.set(iid, vid);

  for (let i = 0; i < invItemIds.length; i += 100) {
    const batch = invItemIds.slice(i, i + 100);
    try {
      const data = (await shopifyFetch("/inventory_items.json", {
        ids: batch.join(","),
        limit: "100",
      })) as { inventory_items: Array<{ id: number; cost: string | null }> };

      for (const item of data.inventory_items) {
        const vid = invItemToVariant.get(item.id);
        if (vid && item.cost != null) {
          const cost = parseFloat(item.cost);
          if (!isNaN(cost) && cost > 0) result.set(vid, cost);
        }
      }
    } catch (err) {
      console.warn("[shopify] Failed to fetch inventory item costs:", err);
    }
    if (i + 100 < invItemIds.length) await new Promise(r => setTimeout(r, 250));
  }

  // Update cache
  if (!variantCostCache) variantCostCache = { data: new Map(), expiry: 0 };
  for (const [k, v] of result) variantCostCache.data.set(k, v);
  variantCostCache.expiry = Date.now() + COST_CACHE_TTL;

  return result;
}

// Fetch all orders created within a date range (YYYY-MM-DD), paginating fully.
export async function getOrdersByDateRange(
  fromDate: string,
  toDate: string,
): Promise<ShopifyOrder[]> {
  const min = `${fromDate}T00:00:00Z`;
  const max = `${toDate}T23:59:59Z`;

  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;

  do {
    // Shopify cursor pagination: page_info must be the ONLY filter param.
    // All other filters (status, created_at_min/max, fields) are only sent on the first page.
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo }
      : {
          limit: "250",
          status: "any",
          created_at_min: min,
          created_at_max: max,
          fields:
            "id,name,tags,created_at,cancelled_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,customer,refunds",
        };

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders;
}

// Fetch orders with full line_items for P&L calculation.
// Separate from getOrdersByDateRange to avoid bloating the sales-summary endpoint.
export async function getOrdersForPnl(
  fromDate: string,
  toDate: string,
): Promise<ShopifyOrder[]> {
  const min = `${fromDate}T00:00:00Z`;
  const max = `${toDate}T23:59:59Z`;

  const allOrders: ShopifyOrder[] = [];
  let pageInfo: string | null = null;

  do {
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo }
      : {
          limit: "250",
          status: "any",
          created_at_min: min,
          created_at_max: max,
          fields:
            "id,name,tags,created_at,cancelled_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_weight,customer,line_items,refunds",
        };

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders;
}

// Fetch transaction fees for a batch of order IDs from Shopify Transactions API.
// Returns a map of orderId → total fee amount (GBP).
export async function getOrderTransactionFees(
  orderIds: number[],
): Promise<Record<number, number>> {
  const fees: Record<number, number> = {};
  // Process in batches of 10 with a small delay to respect rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
    const batch = orderIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (orderId) => {
        try {
          const data = (await shopifyFetch(`/orders/${orderId}/transactions.json`)) as {
            transactions: Array<{
              kind: string;
              status: string;
              fee: string;
            }>;
          };
          const totalFee = data.transactions.reduce((sum, t) => {
            if (t.status === "success" && t.fee) {
              return sum + Math.abs(parseFloat(t.fee));
            }
            return sum;
          }, 0);
          return { orderId, fee: totalFee };
        } catch {
          return { orderId, fee: 0 };
        }
      }),
    );
    for (const r of results) {
      fees[r.orderId] = r.fee;
    }
    // Small delay between batches to stay within Shopify rate limits
    if (i + BATCH_SIZE < orderIds.length) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  return fees;
}

// Add a tag to a Shopify order. No-op if the tag is already present.
export async function addTagToOrder(orderId: number, currentTags: string, newTag: string): Promise<void> {
  const existing = currentTags.split(",").map(t => t.trim()).filter(Boolean);
  if (existing.includes(newTag)) return;
  const updated = [...existing, newTag].join(", ");
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
}

/** Replace a specific tag on an order. Removes oldTag and adds newTag. */
export async function replaceTagOnOrder(orderId: number, currentTags: string, oldTag: string, newTag: string): Promise<string> {
  const existing = currentTags.split(",").map(t => t.trim()).filter(Boolean);
  const filtered = existing.filter(t => t !== oldTag);
  if (!filtered.includes(newTag)) filtered.push(newTag);
  const updated = filtered.join(", ");
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
  return updated;
}
