/**
 * Incremental Shopify orders mirror.
 *
 * The order-heavy pages (founder Numbers, P&L, surveys audience, delivery
 * planning) used to re-crawl the entire requested range from Shopify's REST
 * API on every load — 250 orders a page, several endpoints in parallel, ~10s
 * for a month. This module keeps a Postgres mirror (shopify_orders_cache)
 * and, per request, asks Shopify only "what changed since last sync?" via
 * the updated_at cursor — which catches refunds, cancellations and tag edits
 * as well as new orders, because Shopify bumps updated_at for all of them.
 *
 * Shape guarantee: the payload column stores the order JSON exactly as the
 * REST API returned it, fetched with the UNION of the field lists the old
 * direct fetchers used — so getOrdersByDateRange / getOrdersForPnl callers
 * see identical data, just ~100x faster after first warm.
 *
 * Coverage: shopify_orders_sync.coverage_start marks how far back the
 * mirror is complete. A request whose range starts earlier triggers a
 * one-off backfill of the missing older span, then coverage extends
 * permanently. last_synced_at is the incremental cursor; syncs overlap it
 * by 10 minutes so clock skew between us and Shopify can't drop an order.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { shopifyFetchRaw, parseNextPageInfo, type ShopifyOrder } from "../services/shopify";

// Union of getOrdersByDateRange + getOrdersForPnl field lists, plus
// updated_at (the sync cursor) and shipping_address/note for future callers.
const CACHE_FIELDS =
  "id,name,tags,created_at,updated_at,cancelled_at,financial_status,fulfillment_status," +
  "total_price,subtotal_price,total_discounts,total_weight,customer,shipping_address," +
  "line_items,refunds,note";

interface CachedOrder extends ShopifyOrder {
  updated_at: string;
}

// Skip the network entirely when the mirror was synced this recently — four
// Numbers endpoints land within milliseconds of each other and only the
// first should pay for the sync.
const FRESH_WINDOW_MS = 30_000;
const SYNC_OVERLAP_MS = 10 * 60_000;

interface SyncState {
  lastSyncedAt: Date | null;
  coverageStart: string | null; // YYYY-MM-DD
}

let inFlight: Promise<void> | null = null;

async function readState(): Promise<SyncState> {
  const rows = await db.execute<{ last_synced_at: string | null; coverage_start: string | null }>(
    sql`SELECT last_synced_at, coverage_start FROM shopify_orders_sync WHERE id = 1`,
  );
  const row = rows.rows[0];
  return {
    lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at) : null,
    coverageStart: row?.coverage_start ? String(row.coverage_start).slice(0, 10) : null,
  };
}

async function writeState(state: SyncState): Promise<void> {
  await db.execute(sql`
    INSERT INTO shopify_orders_sync (id, last_synced_at, coverage_start)
    VALUES (1, ${state.lastSyncedAt}, ${state.coverageStart})
    ON CONFLICT (id) DO UPDATE
      SET last_synced_at = ${state.lastSyncedAt}, coverage_start = ${state.coverageStart}
  `);
}

async function fetchOrdersPaged(firstPageParams: Record<string, string>): Promise<CachedOrder[]> {
  const all: CachedOrder[] = [];
  let pageInfo: string | null = null;
  do {
    // Shopify cursor pagination: page_info must be the ONLY filter param.
    const params: Record<string, string> = pageInfo
      ? { limit: "250", page_info: pageInfo }
      : { limit: "250", status: "any", fields: CACHE_FIELDS, ...firstPageParams };
    const res = await shopifyFetchRaw("/orders.json", params);
    const data = (await res.json()) as { orders: CachedOrder[] };
    all.push(...data.orders);
    pageInfo = parseNextPageInfo(res.headers.get("Link"));
  } while (pageInfo);
  return all;
}

async function upsertOrders(orders: CachedOrder[]): Promise<void> {
  // Chunked multi-row upserts: a month is ~1200 orders, payloads a few KB.
  const CHUNK = 100;
  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const values = chunk.map(o =>
      sql`(${o.id}, ${o.created_at}::timestamptz, ${o.updated_at}::timestamptz, ${JSON.stringify(o)}::jsonb, NOW())`,
    );
    await db.execute(sql`
      INSERT INTO shopify_orders_cache (id, created_at, updated_at, payload, synced_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (id) DO UPDATE SET
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `);
  }
}

/**
 * Bring the mirror up to date and make sure coverage reaches back to
 * fromDate. Concurrent callers share one in-flight sync.
 */
export async function ensureOrdersFresh(fromDate: string): Promise<void> {
  // Two rounds at most: after sharing someone else's sync, our own fromDate
  // may still predate coverage (their range was narrower) — then we run our
  // own round. A second shared wait can't still be uncovered after that.
  for (let round = 0; round < 3; round++) {
    if (inFlight) {
      await inFlight.catch(() => {});
      continue;
    }
    const state = await readState();
    const now = Date.now();
    const fresh = state.lastSyncedAt != null && now - state.lastSyncedAt.getTime() < FRESH_WINDOW_MS;
    const covered = state.coverageStart != null && fromDate >= state.coverageStart;
    if (fresh && covered) return;

    inFlight = (async () => {
      try {
        const syncStart = new Date();
        if (state.coverageStart == null) {
          // First ever sync: backfill the whole requested range.
          console.log(`[orders-cache] initial backfill from ${fromDate}`);
          const orders = await fetchOrdersPaged({ created_at_min: `${fromDate}T00:00:00Z` });
          await upsertOrders(orders);
          await writeState({ lastSyncedAt: syncStart, coverageStart: fromDate });
          console.log(`[orders-cache] initial backfill done: ${orders.length} orders`);
          return;
        }

        if (fromDate < state.coverageStart) {
          // Extend coverage back to fromDate (one-off for this older span).
          console.log(`[orders-cache] extending coverage ${state.coverageStart} -> ${fromDate}`);
          const orders = await fetchOrdersPaged({
            created_at_min: `${fromDate}T00:00:00Z`,
            // Overlap one day into existing coverage; upsert dedupes.
            created_at_max: `${state.coverageStart}T23:59:59Z`,
          });
          await upsertOrders(orders);
          state.coverageStart = fromDate;
        }

        if (!fresh) {
          const cursor = new Date((state.lastSyncedAt?.getTime() ?? Date.now()) - SYNC_OVERLAP_MS);
          const changed = await fetchOrdersPaged({ updated_at_min: cursor.toISOString() });
          await upsertOrders(changed);
          state.lastSyncedAt = syncStart;
          if (changed.length > 0) console.log(`[orders-cache] incremental sync: ${changed.length} changed orders`);
        }
        await writeState(state);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
    return;
  }
}

/**
 * Drop-in replacement backing getOrdersByDateRange / getOrdersForPnl:
 * sync incrementally, then serve the range from Postgres. Range semantics
 * match the old direct fetch exactly (UTC day bounds on created_at).
 */
export async function getCachedOrders(fromDate: string, toDate: string): Promise<ShopifyOrder[]> {
  await ensureOrdersFresh(fromDate);
  const rows = await db.execute<{ payload: ShopifyOrder }>(sql`
    SELECT payload FROM shopify_orders_cache
    WHERE created_at >= ${`${fromDate}T00:00:00Z`}::timestamptz
      AND created_at <= ${`${toDate}T23:59:59Z`}::timestamptz
    ORDER BY created_at
  `);
  return rows.rows.map(r => r.payload);
}

/**
 * Boot-time warm (fire and forget): pre-cover from the 1st of last month so
 * the first founder page load after a deploy doesn't pay the backfill.
 */
export function warmOrdersCache(): void {
  const now = new Date();
  const firstOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
  ensureOrdersFresh(firstOfPrevMonth).catch(err => {
    console.error("[orders-cache] warm failed (will retry on first request):", err instanceof Error ? err.message : String(err));
  });
}
