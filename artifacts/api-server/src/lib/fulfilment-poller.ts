/**
 * Safety-net poller for the factory-number fulfilment decrement.
 *
 * Runs alongside the existing [backup] scheduler. Every 5 minutes it
 * asks Shopify for recent orders, filters for ones that are fulfilled
 * but haven't been seen by the `shopify_fulfilment_tracking` table,
 * and runs the shared decrement helper on each. Catches orders
 * fulfilled outside the TCK fulfilment UI (e.g. direct from the
 * Shopify admin during a test).
 *
 * The tracking table acts as an idempotency lock so the same order
 * never gets decremented twice even if both the immediate path (via
 * POST /orders/:id/complete) and this poller see the same order.
 *
 * On first boot the poller SEEDS the tracking table with every
 * already-fulfilled order from the last 14 days so the initial poll
 * cycle doesn't mass-decrement historical orders. This matters because
 * the loop is starting from a reset: we've zeroed the fridge via
 * /reset-fridge-stock, and from that moment on "fulfilled" orders
 * should only count towards decrements if they were fulfilled AFTER
 * the reset.
 */
import { db, shopifyFulfilmentTrackingTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { getOrdersByDateRange, getOrderById } from "../services/shopify";
import { decrementFridgeForShopifyOrder } from "./inventory-sync";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const LOOKBACK_DAYS = 14;

let timer: ReturnType<typeof setInterval> | null = null;

/** Returns a list of recently-fulfilled order IDs. The summary endpoint
 *  doesn't include `line_items` in its `fields`, so we get IDs here and
 *  fetch line items per-order via getOrderById() only when we need them
 *  (which is rare because the seed table skips the common case). */
async function fetchRecentFulfilledOrderIds(): Promise<number[]> {
  const toDate = new Date();
  const fromDate = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  try {
    const orders = await getOrdersByDateRange(
      fromDate.toISOString().slice(0, 10),
      toDate.toISOString().slice(0, 10),
    );
    return orders.filter(o => o.fulfillment_status === "fulfilled").map(o => o.id);
  } catch (err) {
    console.error("[fulfilment-poller] failed to fetch orders:", err);
    return [];
  }
}

/** Seed the tracking table with existing fulfilled order IDs so the
 *  first poll cycle doesn't backfill-decrement. Safe to call multiple
 *  times thanks to onConflictDoNothing. */
async function seedTracking(): Promise<void> {
  const ids = await fetchRecentFulfilledOrderIds();
  if (ids.length === 0) return;
  const rows = ids.map(id => ({
    shopifyOrderId: id,
    fulfilledAt: new Date(), // exact fulfilled_at isn't in the summary response
    source: "startup-seed",
  }));
  await db.insert(shopifyFulfilmentTrackingTable).values(rows).onConflictDoNothing();
  console.log(`[fulfilment-poller] seeded tracking table with ${rows.length} fulfilled orders`);
}

async function pollOnce(): Promise<void> {
  const ids = await fetchRecentFulfilledOrderIds();
  if (ids.length === 0) return;

  const seen = await db
    .select({ id: shopifyFulfilmentTrackingTable.shopifyOrderId })
    .from(shopifyFulfilmentTrackingTable)
    .where(inArray(shopifyFulfilmentTrackingTable.shopifyOrderId, ids));
  const seenSet = new Set(seen.map(s => s.id));

  const toProcess = ids.filter(id => !seenSet.has(id));
  if (toProcess.length === 0) return;

  console.log(`[fulfilment-poller] processing ${toProcess.length} newly-fulfilled orders`);

  for (const orderId of toProcess) {
    try {
      const order = await getOrderById(orderId);
      if (!order?.line_items) {
        await db.insert(shopifyFulfilmentTrackingTable).values({
          shopifyOrderId: orderId,
          fulfilledAt: new Date(),
          source: "poller",
        }).onConflictDoNothing();
        continue;
      }
      const result = await decrementFridgeForShopifyOrder(orderId, order.line_items);
      if (result.unmapped.length > 0) {
        console.warn(`[fulfilment-poller] order ${orderId} — unmapped variant ids:`, result.unmapped.join(", "));
      }
      if (result.decremented.length > 0) {
        console.log(`[fulfilment-poller] order ${orderId} — decremented`, result.decremented);
      }
      await db.insert(shopifyFulfilmentTrackingTable).values({
        shopifyOrderId: orderId,
        fulfilledAt: new Date(),
        source: "poller",
      }).onConflictDoNothing();
    } catch (err) {
      console.error(`[fulfilment-poller] failed to process order ${orderId}:`, err);
    }
  }
}

export async function startFulfilmentPoller(): Promise<void> {
  if (timer) return;
  try {
    await seedTracking();
  } catch (err) {
    console.error("[fulfilment-poller] seedTracking failed:", err);
  }
  timer = setInterval(() => {
    pollOnce().catch(err => console.error("[fulfilment-poller] pollOnce error:", err));
  }, POLL_INTERVAL_MS);
  console.log(`[fulfilment-poller] scheduler started — every ${POLL_INTERVAL_MS / 1000 / 60}m`);
}

export function stopFulfilmentPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
