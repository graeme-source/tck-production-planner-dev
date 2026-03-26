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
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_weight,customer,shipping_address,line_items,note",
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
    const params: Record<string, string> = {
      limit: "250",
      status: "open",
      fulfillment_status: "unshipped",
      created_at_min: since,
      fields:
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,total_weight,customer,shipping_address,line_items,note",
    };
    if (pageInfo) params.page_info = pageInfo;

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders.filter(o => o.fulfillment_status !== "fulfilled");
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
    const params: Record<string, string> = {
      limit: "250",
      status: "any",
      created_at_min: min,
      created_at_max: max,
      fields:
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,customer",
    };
    if (pageInfo) {
      params.page_info = pageInfo;
    }

    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);

  return allOrders;
}

// Add a tag to a Shopify order. No-op if the tag is already present.
export async function addTagToOrder(orderId: number, currentTags: string, newTag: string): Promise<void> {
  const existing = currentTags.split(",").map(t => t.trim()).filter(Boolean);
  if (existing.includes(newTag)) return;
  const updated = [...existing, newTag].join(", ");
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
}
