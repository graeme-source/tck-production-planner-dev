/**
 * Queued test production — packs sold for a delivery date, per recipe, and
 * the batches that covers (Graeme, 30 Oct 2026; rules in
 * queued-production-rules.ts). Reads the Shopify orders mirror only; the
 * counting is the test boxes' own (packsSoldByRecipe: the delivery-date
 * tag, cancelled orders out, refunds netted), over every recipe not
 * archived, with 8-pack bags as 4 packs.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { addDays, addWorkingDays, prevWorkingDay, subtractWorkingDays } from "./test-box-schedule";
import { loadOrdersForDate, refreshOrdersMirror } from "./test-box-production-data";
import { packsSoldByRecipe, type BoxRecipeLinks, type MatchedBy } from "./test-box-production";
import { PRODUCTION_TO_DELIVERY_WORKING_DAYS, suggestQueueBatches, type BatchSuggestion } from "./queued-production-rules";

/** Orders for a delivery are placed up to about six weeks ahead. */
const ORDER_LOOKBACK_DAYS = 42;

export interface SalesLine extends BatchSuggestion {
  recipeId: number;
  name: string;
  packSize: number;
  portionsPerBatch: number;
  matchedBy: MatchedBy;
}

export interface QueueSales {
  productionDate: string;
  deliveryDate: string;
  /** Recipes that sold, most sold first. */
  lines: SalesLine[];
  orders: number;
  ordersSyncedAt: string | null;
  refreshError: string | null;
}

/** Ingredients arrive the day before prep, prep is the day before
 *  production: made Wednesday → delivered Monday. */
export function deliverByFor(productionDate: string): string {
  return prevWorkingDay(prevWorkingDay(productionDate));
}

/** Last day to order for that delivery, by the supplier's lead time (1 day if unset). */
export function orderByFor(deliverBy: string, leadTimeDays: number | null): string {
  return subtractWorkingDays(deliverBy, Math.max(0, leadTimeDays ?? 1));
}

/** Made Wednesday → delivered Friday. */
export function deliveryDateFor(productionDate: string): string {
  return addWorkingDays(productionDate, PRODUCTION_TO_DELIVERY_WORKING_DAYS);
}

async function recipeLinks(): Promise<{ links: BoxRecipeLinks[]; info: Map<number, { name: string; packSize: number; portionsPerBatch: number }> }> {
  const recipes = await db.execute<{ id: number; name: string; pack_size: string | null; portions_per_batch: number | null }>(sql`
    SELECT id, name, pack_size, portions_per_batch FROM recipes WHERE archived_at IS NULL
  `);
  const maps = await db.execute<{ recipe_id: number; v: string | null; w: string | null; e: string | null }>(sql`
    SELECT recipe_id, shopify_variant_id AS v, wonky_variant_id AS w, eight_pack_variant_id AS e FROM recipe_shopify_mappings
  `);
  const products = await db.execute<{ recipe_id: number; p: string }>(sql`
    SELECT recipe_id, shopify_product_id AS p FROM test_box_shopify_products
    UNION SELECT recipe_id, shopify_product_id FROM recipe_shopify_products
  `);
  const info = new Map<number, { name: string; packSize: number; portionsPerBatch: number }>();
  const links = recipes.rows.map((r): BoxRecipeLinks => {
    const id = Number(r.id);
    info.set(id, { name: r.name, packSize: Number(r.pack_size) || 1, portionsPerBatch: Number(r.portions_per_batch) || 10 });
    const mine = maps.rows.filter(m => Number(m.recipe_id) === id);
    const ids = (pick: (m: typeof mine[number]) => string | null) => mine.map(pick).filter((v): v is string => !!v).map(String);
    return {
      recipeId: id,
      name: r.name,
      variantIds: [...ids(m => m.v), ...ids(m => m.w)],
      eightPackVariantIds: ids(m => m.e),
      productIds: products.rows.filter(p => Number(p.recipe_id) === id).map(p => String(p.p)),
    };
  });
  return { links, info };
}

export async function queueSales(productionDate: string, deliveryDate: string | null, refresh: boolean): Promise<QueueSales> {
  const delivery = deliveryDate ?? deliveryDateFor(productionDate);
  const refreshError = refresh ? await refreshOrdersMirror(addDays(delivery, -ORDER_LOOKBACK_DAYS)) : null;
  const [orders, { links, info }, synced] = await Promise.all([
    loadOrdersForDate(db, delivery),
    recipeLinks(),
    db.execute<{ at: Date | string | null }>(sql`SELECT last_synced_at AS at FROM shopify_orders_sync WHERE id = 1`).catch(() => ({ rows: [] as Array<{ at: Date | string | null }> })),
  ]);
  const count = packsSoldByRecipe(orders, delivery, links);
  const lines: SalesLine[] = [];
  for (const [recipeId, packs] of count.packs) {
    if (packs <= 0) continue;
    const r = info.get(recipeId)!;
    lines.push({
      recipeId, name: r.name, packSize: r.packSize, portionsPerBatch: r.portionsPerBatch,
      matchedBy: count.matchedBy.get(recipeId) ?? "none",
      ...suggestQueueBatches({ packsSold: packs, packSize: r.packSize, portionsPerBatch: r.portionsPerBatch }),
    });
  }
  lines.sort((a, b) => b.packsSold - a.packsSold || a.name.localeCompare(b.name));
  const at = synced.rows[0]?.at;
  return {
    productionDate, deliveryDate: delivery, lines, orders: count.orders,
    ordersSyncedAt: at ? new Date(at).toISOString() : null, refreshError,
  };
}
