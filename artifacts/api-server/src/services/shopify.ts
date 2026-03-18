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

async function shopifyFetch(path: string, params?: Record<string, string>) {
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
  customer: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  shipping_address: {
    name: string;
    address1: string;
    city: string;
    zip: string;
  } | null;
  line_items: ShopifyLineItem[];
  note: string | null;
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
        "id,name,tags,created_at,financial_status,fulfillment_status,total_price,subtotal_price,total_discounts,customer,shipping_address,line_items,note",
    };
    if (pageInfo) {
      params.page_info = pageInfo;
    } else {
      params.tag = tag;
    }

    const data = (await shopifyFetch("/orders.json", params)) as { orders: ShopifyOrder[] };
    allOrders.push(...data.orders);

    pageInfo = null;
  } while (pageInfo);

  return allOrders.filter((o) => o.tags.split(",").map((t) => t.trim()).includes(tag));
}

export async function getProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let page = 1;
  const limit = 250;

  while (true) {
    const data = (await shopifyFetch("/products.json", {
      limit: String(limit),
      page: String(page),
      fields: "id,title,status,variants,image",
    })) as { products: ShopifyProduct[] };

    allProducts.push(...data.products);
    if (data.products.length < limit) break;
    page++;
  }

  return allProducts;
}

export interface ProductCount {
  productTitle: string;
  variantTitle: string | null;
  sku: string;
  totalQuantity: number;
  orderCount: number;
}

export async function countProductsByTag(tag: string): Promise<ProductCount[]> {
  const orders = await getOrdersByTag(tag);
  const counts = new Map<string, ProductCount>();

  for (const order of orders) {
    for (const item of order.line_items) {
      const key = `${item.title}||${item.variant_title || ""}||${item.sku}`;
      const existing = counts.get(key);
      if (existing) {
        existing.totalQuantity += item.quantity;
        existing.orderCount += 1;
      } else {
        counts.set(key, {
          productTitle: item.title,
          variantTitle: item.variant_title,
          sku: item.sku,
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
