import { shouldSkipSideEffect, logSkippedSideEffect } from "../lib/app-env";
import { apcTrackingUrl } from "./apc";
// Circular at module level (orders-cache imports shopifyFetchRaw from here)
// but both sides only touch the other at call time, so ESM resolves it fine.
import { getCachedOrders } from "../lib/orders-cache";

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
// Exported for lib/orders-cache.ts (the incremental orders mirror).
export function parseNextPageInfo(linkHeader: string | null): string | null {
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

export async function shopifyFetchRaw(path: string, params?: Record<string, string>): Promise<Response> {
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

/**
 * Send a GraphQL query to Shopify Admin API.
 *
 * Shopify's REST `?tag=` filter is silently ignored on this store —
 * GraphQL is the only API surface that actually applies tag filtering
 * server-side. We use it specifically for small aggregate queries
 * (e.g. ordersCount) where pulling the full order list via REST would
 * waste memory. Throws on transport, HTTP, or GraphQL errors.
 *
 * Retries once on 429 / 5xx so a transient Shopify hiccup doesn't
 * 502 a user-facing endpoint. Not a general solution — heavy/frequent
 * callers should implement their own throttling.
 */
export async function shopifyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(`${API_BASE}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });

    if (!res.ok) {
      const retry = (res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt === 1;
      if (retry) {
        const ra = parseFloat(res.headers.get("Retry-After") || "");
        const waitMs = Math.min(Number.isFinite(ra) ? ra * 1000 : 500, 3_000);
        await res.text().catch(() => undefined);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      const text = await res.text();
      throw new Error(`Shopify GraphQL error ${res.status}: ${text}`);
    }

    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors && body.errors.length > 0) {
      throw new Error(`Shopify GraphQL: ${body.errors.map(e => e.message).join("; ")}`);
    }
    if (!body.data) {
      throw new Error("Shopify GraphQL: empty response");
    }
    return body.data;
  }
  throw new Error("Shopify GraphQL: retries exhausted");
}

/**
 * Shopify's OWN online-store conversion metric for the inclusive date range,
 * straight from ShopifyQL: `FROM sessions SHOW sessions, conversion_rate`.
 *
 * This is the exact number the Shopify Admin analytics home reports, so the
 * dashboard card can never disagree with what Graeme sees in Shopify. Being
 * session-based it inherently excludes subscription recurring orders — a
 * renewal charge never creates a storefront session.
 *
 * Schema notes (verified against API 2026-01 on 2026-08-09): the old
 * `... on TableResponse` union is gone — `shopifyqlQuery` now returns a plain
 * `ShopifyqlQueryResponse` with `parseErrors: [String]` and
 * `tableData { columns { name } rows }` where `rows` is a JSON array of
 * objects keyed by column name. Column names are `sessions` and
 * `conversion_rate` (`total_sessions` no longer exists). Failures degrade to
 * nulls so the card shows "—" rather than an error banner.
 */
export async function getOnlineStoreConversion(from: string, to: string): Promise<{ sessions: number | null; conversionRate: number | null }> {
  try {
    const shopifyql = `FROM sessions SHOW sessions, conversion_rate SINCE ${from} UNTIL ${to}`;
    const gql = `{
      shopifyqlQuery(query: ${JSON.stringify(shopifyql)}) {
        parseErrors
        tableData { columns { name } rows }
      }
    }`;
    const data = await shopifyGraphQL<{
      shopifyqlQuery: {
        parseErrors: string[] | null;
        tableData: { columns: Array<{ name: string }>; rows: Array<Record<string, unknown>> } | null;
      };
    }>(gql);
    const q = data.shopifyqlQuery;
    if (q.parseErrors && q.parseErrors.length > 0) {
      console.warn("[Shopify] conversion ShopifyQL parse error:", q.parseErrors.join("; "));
      return { sessions: null, conversionRate: null };
    }
    const row = q.tableData?.rows?.[0];
    if (!row) return { sessions: null, conversionRate: null };
    const sessions = Number(row.sessions);
    const rate = Number(row.conversion_rate);
    return {
      sessions: Number.isFinite(sessions) ? sessions : null,
      conversionRate: Number.isFinite(rate) ? rate : null,
    };
  } catch (err) {
    console.warn("[Shopify] conversion query unavailable (schema or scope mismatch):", err instanceof Error ? err.message : err);
    return { sessions: null, conversionRate: null };
  }
}

/**
 * Count orders matching a Shopify tag, optionally narrowed by
 * fulfillment status. Uses GraphQL's server-side filtering, so the
 * response is a single integer regardless of how many orders match.
 *
 * This is the safe way to read tag/status aggregates — it's cheap
 * in time, memory, and throttle budget. Use it in place of
 * `getOrdersByTag(...).length` anywhere you only need a count.
 *
 * Tags here aren't escaped for the search grammar beyond the string
 * interpolation; callers must pass tag values that don't contain
 * spaces, quotes, or boolean keywords like AND/OR.
 */
export async function countOrdersByTag(
  tag: string,
  fulfillmentStatus?: "fulfilled" | "unfulfilled" | "partial",
): Promise<number> {
  let searchQuery = `tag:${tag}`;
  if (fulfillmentStatus) {
    searchQuery += ` AND fulfillment_status:${fulfillmentStatus}`;
  }
  const gql = `{ ordersCount(query: "${searchQuery}") { count } }`;
  const data = await shopifyGraphQL<{ ordersCount: { count: number } }>(gql);
  return data.ordersCount.count;
}

export interface ShopifyLineItem {
  id: number;
  variant_id: number | null;
  product_id: number | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  /** Quantity AFTER refunds/order edits — 0 means the item was removed.
   *  Shopify keeps removed items in line_items with their original
   *  quantity, so operational reads must use this. Optional because
   *  older cached payloads may predate the field. */
  current_quantity?: number | null;
  /** False for digital products (gift cards etc.) — nothing to pack. */
  requires_shipping?: boolean;
  gift_card?: boolean;
  sku: string;
  price: string;
}

/**
 * Line items as the PACKING BENCH should see them:
 *
 * 1. Removed items are dropped. When an item is refunded or edited off an
 *    order, Shopify LEAVES it in line_items at its original quantity and
 *    only current_quantity tells the truth — which had the packing screen
 *    shipping items people had already been refunded for (found live
 *    2026-08-19, e.g. #132747's removed CarniZone). Partial removals
 *    shrink quantity to what's still owed.
 * 2. Digital items are dropped (gift cards etc., 2026-08-19) — anything
 *    Shopify says doesn't ship has no business on a packing list. The old
 *    Replit app had this filter; it never made the port.
 *
 * Fields are optional-defensive: an item missing them passes through.
 */
function toPackableLineItems(order: ShopifyOrder): ShopifyOrder {
  if (!Array.isArray(order.line_items)) return order;
  return {
    ...order,
    line_items: order.line_items
      .filter(li => li.current_quantity == null || li.current_quantity > 0)
      .filter(li => li.requires_shipping !== false && li.gift_card !== true)
      .map(li =>
        li.current_quantity != null && li.current_quantity < li.quantity
          ? { ...li, quantity: li.current_quantity }
          : li,
      ),
  };
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
    barcode: string | null;
    image_id: number | null;
  }>;
  images: Array<{ id: number; src: string }>;
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

  return allOrders
    .filter((o) => o.tags.split(",").map((t) => t.trim()).includes(tag))
    // Every consumer of tag reads is operational (packing queue, scan
    // queue, dispatch KPIs, stock decrement) — none should ever see an
    // item the customer was refunded for.
    .map(toPackableLineItems);
}

export async function getProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let pageInfo: string | null = null;

  while (true) {
    const params: Record<string, string> = {
      limit: "250",
      fields: "id,title,status,variants,image,images",
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
  variantId: number | null;
  quantity: number;
  orderCount: number;
  fulfilledQuantity: number;
  unfulfilledQuantity: number;
}

export interface ProductCount {
  productTitle: string;
  variants: VariantCount[];
  totalQuantity: number;
  orderCount: number;
  fulfilledQuantity: number;
  unfulfilledQuantity: number;
}

export async function countProductsByTag(tag: string): Promise<ProductCount[]> {
  const orders = await getOrdersByTag(tag);
  const counts = new Map<string, ProductCount>();

  for (const order of orders) {
    const isFulfilled = order.fulfillment_status === "fulfilled" || order.fulfillment_status === "shipped";

    for (const item of order.line_items) {
      const productKey = item.title;
      const variantKey = item.variant_title ?? "";
      const qty = item.quantity;

      const product = counts.get(productKey);
      if (product) {
        product.totalQuantity += qty;
        product.orderCount += 1;
        if (isFulfilled) product.fulfilledQuantity += qty;
        else product.unfulfilledQuantity += qty;

        const variant = product.variants.find(v => v.title === variantKey);
        if (variant) {
          variant.quantity += qty;
          variant.orderCount += 1;
          if (isFulfilled) variant.fulfilledQuantity += qty;
          else variant.unfulfilledQuantity += qty;
        } else if (variantKey) {
          product.variants.push({
            title: variantKey, variantId: item.variant_id, quantity: qty, orderCount: 1,
            fulfilledQuantity: isFulfilled ? qty : 0,
            unfulfilledQuantity: isFulfilled ? 0 : qty,
          });
        }
      } else {
        counts.set(productKey, {
          productTitle: item.title,
          variants: variantKey ? [{
            title: variantKey, variantId: item.variant_id, quantity: qty, orderCount: 1,
            fulfilledQuantity: isFulfilled ? qty : 0,
            unfulfilledQuantity: isFulfilled ? 0 : qty,
          }] : [],
          totalQuantity: qty,
          orderCount: 1,
          fulfilledQuantity: isFulfilled ? qty : 0,
          unfulfilledQuantity: isFulfilled ? 0 : qty,
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
    fulfillment_orders: Array<{ id: number; status: string; request_status?: string; line_items: unknown[] }>;
  };

  const pendingFulfillmentOrders = fulfillmentsRes.fulfillment_orders.filter(
    fo => fo.status === "open" || fo.status === "in_progress",
  );

  if (pendingFulfillmentOrders.length === 0) {
    // No open fulfillment_orders — could be a genuine "already fulfilled"
    // case, or could mean the order is in a state Shopify won't ship from
    // (cancelled, closed, on_hold, scheduled, incomplete). Distinguish by
    // re-fetching the order and checking its `fulfillment_status` directly:
    //   - "fulfilled" → soft success, kitchen state matches Shopify state
    //   - anything else → hard error with the FO statuses logged so the
    //     packer can see what's wrong instead of being told it succeeded.
    const orderRes = (await shopifyFetch(`/orders/${orderId}.json`, { fields: "id,name,fulfillment_status,cancelled_at" })) as {
      order: { id: number; name: string; fulfillment_status: string | null; cancelled_at: string | null };
    };
    const order = orderRes.order;
    const foSummary = fulfillmentsRes.fulfillment_orders
      .map(fo => `${fo.id}=${fo.status}${fo.request_status ? `/${fo.request_status}` : ""}`)
      .join(", ") || "(none)";

    if (order.fulfillment_status === "fulfilled") {
      console.warn(`[shopify.fulfillOrder] order ${orderId} (${order.name}) already fulfilled — skipping POST /fulfillments.json. FOs: ${foSummary}`);
      return;
    }

    const detail = order.cancelled_at
      ? `order is cancelled (cancelled_at=${order.cancelled_at})`
      : `order.fulfillment_status=${order.fulfillment_status ?? "null"}, fulfillment_orders=[${foSummary}]`;
    console.error(`[shopify.fulfillOrder] order ${orderId} (${order.name}) cannot be fulfilled — ${detail}`);
    throw new Error(`Shopify won't accept fulfilment for ${order.name}: no open fulfillment orders. ${detail}. Open the order in Shopify Admin to inspect.`);
  }

  // When the APC integration is off, fulfilment runs with no tracking
  // info — Shopify still marks the order shipped and emails the
  // customer, but without an APC consignment to point at. Skip the
  // tracking_info block entirely in that case so we don't ship a
  // broken https://apc.co.uk/tracking/ URL.
  //
  // A company WITHOUT a number (e.g. "TCK Local Delivery" for van orders)
  // sends carrier-only tracking_info: the customer's email names the
  // carrier but carries no tracking link.
  const trackingInfo = trackingNumber
    ? {
        number: trackingNumber,
        company: trackingCompany,
        // Callers pass the proper link (built by apcTrackingUrl, which adds
        // the consignee postcode so the customer skips APC's CAPTCHA). The
        // fallback is the same host without the postcode — the old
        // apc.co.uk/tracking/ path this used to emit is not a live URL.
        url: trackingUrl ?? apcTrackingUrl(trackingNumber, null),
      }
    : trackingCompany
      ? { company: trackingCompany }
      : null;
  await shopifyPost(`/fulfillments.json`, {
    fulfillment: {
      line_items_by_fulfillment_order: pendingFulfillmentOrders.map(fo => ({
        fulfillment_order_id: fo.id,
      })),
      ...(trackingInfo ? { tracking_info: trackingInfo } : {}),
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

  return allOrders.filter(o => o.fulfillment_status !== "fulfilled").map(toPackableLineItems);
}

/**
 * Fetch a single order by its Shopify order ID, including line items.
 * Used by the factory-number fulfilment decrement path — we need
 * line_items to know which recipes/quantities to remove from the
 * production fridge when Confirm & Complete fires. Removed items are
 * dropped so refunded packs neither ship nor decrement fridge stock.
 */
export async function getOrderById(orderId: number): Promise<ShopifyOrder | null> {
  try {
    const data = (await shopifyFetch(`/orders/${orderId}.json`, {
      fields: "id,name,tags,created_at,fulfillment_status,line_items",
    })) as { order: ShopifyOrder };
    return data.order ? toPackableLineItems(data.order) : null;
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
  return data.orders[0] ? toPackableLineItems(data.orders[0]) : null;
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
/** Fetch the Shopify SKU for each variant ID. Returns an entry only
 *  for variants Shopify accepted (silently drops 404s / errors).
 *  Used by the recipe_shopify_mappings backfill so the packing
 *  checklists can sort recipes in SKU order — the same order Easy
 *  Scan uses on the kitchen scanner. Batched in groups of 10 with
 *  a 250ms pause between batches to stay under Shopify's REST
 *  leaky-bucket rate limit. */
export async function getVariantSkus(variantIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (variantIds.length === 0) return result;

  for (let i = 0; i < variantIds.length; i += 10) {
    const batch = variantIds.slice(i, i + 10);
    await Promise.all(batch.map(async (vid) => {
      try {
        const data = (await shopifyFetch(`/variants/${vid}.json`)) as { variant: { sku: string | null } };
        const sku = (data.variant.sku ?? "").trim();
        if (sku) result.set(vid, sku);
      } catch (err) {
        // 404 / network blip — leave the entry empty so the
        // checklist falls back to name-sort for that recipe.
        console.warn(`[shopify] getVariantSkus: failed to fetch variant ${vid}:`, err instanceof Error ? err.message : err);
      }
    }));
    if (i + 10 < variantIds.length) await new Promise(r => setTimeout(r, 250));
  }
  return result;
}

/** Fetch the Shopify barcode (GTIN) for each variant ID. Same batched
 *  pattern as getVariantSkus. Used by the despatch scanner to match
 *  scanned barcodes against order line items without needing a local
 *  barcode mapping table — Shopify is the source of truth. */
export async function getVariantBarcodes(variantIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (variantIds.length === 0) return result;

  const unique = Array.from(new Set(variantIds));
  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    await Promise.all(batch.map(async (vid) => {
      try {
        const data = (await shopifyFetch(`/variants/${vid}.json`)) as { variant: { barcode: string | null } };
        const barcode = (data.variant.barcode ?? "").trim();
        if (barcode) result.set(vid, barcode);
      } catch (err) {
        console.warn(`[shopify] getVariantBarcodes: failed to fetch variant ${vid}:`, err instanceof Error ? err.message : err);
      }
    }));
    if (i + 10 < unique.length) await new Promise(r => setTimeout(r, 250));
  }
  return result;
}

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

// Fetch all orders created within a date range (YYYY-MM-DD).
// Served from the incremental Postgres mirror (lib/orders-cache.ts) since
// 2026-08-18 — same shape and range semantics as the old direct crawl, but
// only "what changed since last sync" hits the Shopify API.
export async function getOrdersByDateRange(
  fromDate: string,
  toDate: string,
): Promise<ShopifyOrder[]> {
  return getCachedOrders(fromDate, toDate);
}

// Orders with full line_items for P&L calculation. The mirror stores the
// superset of fields, so this is the same query as getOrdersByDateRange.
export async function getOrdersForPnl(
  fromDate: string,
  toDate: string,
): Promise<ShopifyOrder[]> {
  return getCachedOrders(fromDate, toDate);
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
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.addTagToOrder", { orderId, newTag });
    return;
  }
  const updated = [...existing, newTag].join(", ");
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
}

/** Add several tags to an order in a single write. Returns the updated tag string. */
export async function addTagsToOrder(orderId: number, currentTags: string, newTags: string[]): Promise<string> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of [...currentTags.split(","), ...newTags].map(t => t.trim()).filter(Boolean)) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
  }
  const updated = result.join(", ");
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.addTagsToOrder", { orderId, newTags });
    return updated;
  }
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
  return updated;
}

/** Replace a specific tag on an order. Removes oldTag and adds newTag. */
export async function replaceTagOnOrder(orderId: number, currentTags: string, oldTag: string, newTag: string): Promise<string> {
  const existing = currentTags.split(",").map(t => t.trim()).filter(Boolean);
  const filtered = existing.filter(t => t !== oldTag);
  if (!filtered.includes(newTag)) filtered.push(newTag);
  const updated = filtered.join(", ");
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.replaceTagOnOrder", { orderId, oldTag, newTag });
    return updated;
  }
  await shopifyPut(`/orders/${orderId}.json`, { order: { id: orderId, tags: updated } });
  return updated;
}

// ── Rescheduling a delivery ────────────────────────────────────────────────

/** Deep link to an order in the Shopify admin.
 *
 *  Built server-side because the store domain is a server env var — sending
 *  the finished URL saves leaking the domain into the browser bundle and
 *  saves every caller reconstructing it. The `/admin/orders/:id` form on the
 *  myshopify domain redirects to whichever admin host is current, so it keeps
 *  working when Shopify moves the console again. */
export function shopifyAdminOrderUrl(orderId: number): string {
  return `${shopifyAdminOrderBase()}${orderId}`;
}

/** The prefix an order id is appended to. Handed to the browser once, so a
 *  page rendering hundreds of order rows doesn't need a URL per row. */
export function shopifyAdminOrderBase(): string {
  return `https://${STORE_DOMAIN}/admin/orders/`;
}

export interface ShopifyNoteAttribute { name: string; value: string }

export interface ShopifyOrderForReschedule {
  id: number;
  name: string;
  tags: string;
  email: string | null;
  customerFirstName: string | null;
  shippingName: string | null;
  noteAttributes: ShopifyNoteAttribute[];
}

/**
 * The fields rescheduling needs, which the ordinary order fetches don't carry.
 *
 * `note_attributes` in particular is absent from both `getOrderById` and the
 * local orders cache, and it holds Zapiet's `Delivery-Date` — the
 * customer-facing copy of the date. Anything that moves a delivery has to read
 * it from here, not from the cache.
 */
export async function getOrderForReschedule(orderId: number): Promise<ShopifyOrderForReschedule | null> {
  try {
    const data = (await shopifyFetch(`/orders/${orderId}.json`, {
      fields: "id,name,tags,email,contact_email,customer,shipping_address,note_attributes",
    })) as {
      order?: {
        id: number; name: string; tags: string;
        email?: string | null; contact_email?: string | null;
        customer?: { first_name?: string | null } | null;
        shipping_address?: { name?: string | null } | null;
        note_attributes?: ShopifyNoteAttribute[] | null;
      };
    };
    const o = data.order;
    if (!o) return null;
    return {
      id: o.id,
      name: o.name,
      tags: o.tags ?? "",
      email: o.email ?? o.contact_email ?? null,
      customerFirstName: o.customer?.first_name ?? null,
      shippingName: o.shipping_address?.name ?? null,
      noteAttributes: o.note_attributes ?? [],
    };
  } catch (err) {
    console.error(`[shopify] getOrderForReschedule(${orderId}) failed:`, err);
    return null;
  }
}

/**
 * Write tags and note_attributes in ONE request.
 *
 * Deliberately a single PUT: the date lives in both fields, and two separate
 * writes could half-apply — leaving the planner and the customer looking at
 * different dates, which is the exact failure this feature exists to prevent.
 *
 * The caller must pass the COMPLETE note_attributes array. Shopify replaces it
 * wholesale rather than merging, so a partial array silently deletes whatever
 * it omits (Zapiet's location id, the checkout method, another app's keys).
 */
export async function updateOrderTagsAndAttributes(
  orderId: number,
  tags: string,
  noteAttributes: ShopifyNoteAttribute[],
): Promise<void> {
  if (shouldSkipSideEffect()) {
    logSkippedSideEffect("shopify.updateOrderTagsAndAttributes", { orderId, tags, noteAttributes });
    return;
  }
  await shopifyPut(`/orders/${orderId}.json`, {
    order: { id: orderId, tags, note_attributes: noteAttributes },
  });
}

// ── Collections (survey builder) ───────────────────────────────────────────

export interface ShopifyCollectionSummary {
  id: number;
  title: string;
}

/**
 * All collections, custom (manual) and smart (rule-based) alike — the
 * survey "build from collection" picker doesn't care which kind a
 * collection is, only what's in it.
 */
export async function getCollections(): Promise<ShopifyCollectionSummary[]> {
  const [custom, smart] = await Promise.all([
    shopifyFetch("/custom_collections.json", { limit: "250", fields: "id,title" }) as Promise<{ custom_collections: ShopifyCollectionSummary[] }>,
    shopifyFetch("/smart_collections.json", { limit: "250", fields: "id,title" }) as Promise<{ smart_collections: ShopifyCollectionSummary[] }>,
  ]);
  return [...(custom.custom_collections ?? []), ...(smart.smart_collections ?? [])]
    .map(c => ({ id: c.id, title: c.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Products in a collection (works for both custom and smart collections). */
export async function getCollectionProducts(collectionId: number): Promise<Array<{ id: number; title: string }>> {
  const products: Array<{ id: number; title: string }> = [];
  let pageInfo: string | null = null;
  do {
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo }
      : { limit: "250", fields: "id,title" };
    const res = await shopifyFetchRaw(`/collections/${collectionId}/products.json`, params);
    const data = (await res.json()) as { products: Array<{ id: number; title: string }> };
    products.push(...(data.products ?? []));
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);
  return products;
}
