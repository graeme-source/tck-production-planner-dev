/**
 * Test-box production from sales — the database side (Graeme, 2026-10-08).
 * The rules are pure and tested in test-box-production.ts; this file reads
 * the orders mirror and the box's links, and writes Queued production.
 *
 *   productionPreview()  what closing (or recounting) WOULD queue — read only.
 *   queueFromSales()     write it: the delivery's own Queued production rows
 *                        are brought in step (update in place, never
 *                        duplicate) and the delivery becomes "Production
 *                        queued". Refuses while a recipe is still a draft.
 *   unqueueDelivery()    reopening / cancelling / removing the delivery takes
 *                        its queued rows off (status 'cancelled'); rows a plan
 *                        already took stay, with a warning.
 *   closeAndQueue() / reopenDelivery()  the close button, the close tick and
 *                        the close to-do all go through these.
 *
 * Queued production for a day lands on that day's plan when the plan is
 * created (production-plans calculate / create read queued_production), so
 * prep and dough follow automatically. If the plan already exists, the
 * preview says so — the queue can't reach it and the plan must be changed.
 *
 * Nothing here talks to Shopify except refreshOrdersMirror(), which only
 * READS orders into the local mirror (lib/orders-cache.ts).
 */
import { db, queuedProductionTable, recipesTable, testBoxDeliveriesTable } from "@workspace/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { ensureOrdersFresh } from "./orders-cache";
import { intArrayLiteral } from "./int-array-literal";
import { addDays, productionDateFor, shortDay } from "./test-box-schedule";
import {
  batchesFor, packsSoldByRecipe, planQueueDiff, planUnqueue,
  type BoxRecipeLinks, type MatchedBy, type QueueRow, type QueueWarning, type SalesOrder,
} from "./test-box-production";
import { setDeliveryClosed } from "./test-box-todos";
import type { Actor, DeliveryRow, TestBoxRow, Tx } from "./test-box-data";

type Db = typeof db | Tx;

export interface PreviewLine {
  recipeId: number;
  name: string;
  isDraft: boolean;
  packs: number;
  packSize: number;
  calzones: number;
  portionsPerBatch: number;
  batches: number;
  matchedBy: MatchedBy;
  /** What the delivery has queued for it now (null = nothing). */
  queuedBatches: number | null;
  queuedStatus: "queued" | "planned" | null;
}

export interface ProductionPreview {
  deliveryId: number;
  deliveryDate: string;
  productionDate: string;
  status: string;
  safetyBatch: boolean;
  /** Orders for this date that contain the box's products. */
  orders: number;
  lines: PreviewLine[];
  totalBatches: number;
  /** Recipes that can't be queued yet (drafts) — queueing refuses until fixed. */
  blockers: Array<{ recipeId: number; name: string }>;
  /** True when queueing now would change what's queued. */
  changes: boolean;
  /** The plan for the production day already exists — the queue won't reach it. */
  planExists: boolean;
  warnings: string[];
  /** When the orders mirror last synced from Shopify. */
  ordersSyncedAt: string | null;
  /** Set when a refresh was asked for and Shopify couldn't be reached. */
  refreshError: string | null;
  queuedAt: string | null;
  queuedBy: string | null;
}

/** Pull the latest orders into the local mirror (READ only). Never throws:
 *  the error is returned so the preview can say it counted an older copy. */
export async function refreshOrdersMirror(fromDate: string): Promise<string | null> {
  try {
    await ensureOrdersFresh(fromDate);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[test-boxes] couldn't refresh orders from Shopify before counting:", msg);
    return msg;
  }
}

async function ordersSyncedAt(conn: Db): Promise<string | null> {
  try {
    const r = await conn.execute<{ at: Date | string | null }>(sql`SELECT last_synced_at AS at FROM shopify_orders_sync WHERE id = 1`);
    const at = r.rows[0]?.at;
    return at ? new Date(at).toISOString() : null;
  } catch {
    // The sync table is made by the orders cache on first use; no row yet = never synced.
    return null;
  }
}

/** Orders in the mirror tagged with this delivery date (the pure rule re-checks the tag exactly). */
export async function loadOrdersForDate(conn: Db, deliveryDate: string): Promise<SalesOrder[]> {
  const rows = await conn.execute<{
    id: string; name: string | null; tags: string | null; cancelled_at: string | null;
    line_items: Array<Record<string, unknown>> | null; refund_lines: Array<Record<string, unknown>> | null;
  }>(sql`
    SELECT c.id::text AS id, c.payload->>'name' AS name, c.payload->>'tags' AS tags,
           c.payload->>'cancelled_at' AS cancelled_at, c.payload->'line_items' AS line_items,
           (SELECT jsonb_agg(rli) FROM jsonb_array_elements(COALESCE(c.payload->'refunds', '[]'::jsonb)) rf,
                   jsonb_array_elements(COALESCE(rf->'refund_line_items', '[]'::jsonb)) rli) AS refund_lines
    FROM shopify_orders_cache c
    WHERE c.payload->>'tags' LIKE ${`%${deliveryDate}%`}
  `);
  const str = (v: unknown) => (v == null ? null : String(v));
  return rows.rows.map(r => ({
    id: r.id,
    name: r.name,
    tags: r.tags,
    cancelledAt: r.cancelled_at,
    lineItems: (r.line_items ?? []).map(li => ({
      id: String(li["id"]),
      variantId: str(li["variant_id"]),
      productId: str(li["product_id"]),
      title: str(li["title"]),
      variantTitle: str(li["variant_title"]),
      quantity: Number(li["quantity"]) || 0,
    })),
    refunds: (r.refund_lines ?? []).map(rl => ({ lineItemId: String(rl["line_item_id"]), quantity: Number(rl["quantity"]) || 0 })),
  }));
}

/** The box's recipes with their Shopify links (mapped variants + products the box made). */
async function loadRecipeLinks(conn: Db, boxId: number) {
  const recipes = await conn.execute<{
    id: number; name: string; is_draft: boolean; archived_at: string | null; pack_size: string | null; portions_per_batch: string | null;
  }>(sql`
    SELECT r.id, r.name, r.is_draft, r.archived_at, r.pack_size, r.portions_per_batch
    FROM test_box_recipes t JOIN recipes r ON r.id = t.recipe_id
    WHERE t.test_box_id = ${boxId}
    ORDER BY t.position, t.id
  `);
  const ids = recipes.rows.map(r => Number(r.id));
  if (ids.length === 0) return { recipes: recipes.rows, links: [] as BoxRecipeLinks[] };
  const variants = await conn.execute<{ recipe_id: number; v: string }>(sql`
    SELECT recipe_id, shopify_variant_id AS v FROM recipe_shopify_mappings
    WHERE recipe_id = ANY(${intArrayLiteral(ids)}::int[]) AND shopify_variant_id IS NOT NULL AND shopify_variant_id <> ''
  `);
  const products = await conn.execute<{ recipe_id: number; p: string }>(sql`
    SELECT recipe_id, shopify_product_id AS p FROM test_box_shopify_products
    WHERE test_box_id = ${boxId} AND recipe_id = ANY(${intArrayLiteral(ids)}::int[])
  `);
  const links: BoxRecipeLinks[] = recipes.rows.map(r => ({
    recipeId: Number(r.id),
    name: r.name,
    variantIds: variants.rows.filter(v => Number(v.recipe_id) === Number(r.id)).map(v => String(v.v)),
    productIds: products.rows.filter(p => Number(p.recipe_id) === Number(r.id)).map(p => String(p.p)),
  }));
  return { recipes: recipes.rows, links };
}

async function queueRowsForDay(conn: Db, productionDate: string): Promise<QueueRow[]> {
  const rows = await conn.select({
    id: queuedProductionTable.id, recipeId: queuedProductionTable.recipeId, batches: queuedProductionTable.batches,
    status: queuedProductionTable.status, testBoxDeliveryId: queuedProductionTable.testBoxDeliveryId,
  }).from(queuedProductionTable)
    .where(and(eq(queuedProductionTable.productionDate, productionDate), ne(queuedProductionTable.status, "cancelled")));
  return rows;
}

async function planExistsFor(conn: Db, productionDate: string): Promise<boolean> {
  const r = await conn.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM production_plans WHERE plan_date = ${productionDate}`);
  return Number(r.rows[0]?.n ?? 0) > 0;
}

function describeWarning(w: QueueWarning, name: string, productionDate: string): string {
  if (w.kind === "adopted") {
    return `${name} already had ${w.was} batch${w.was === 1 ? "" : "es"} queued by hand for ${shortDay(productionDate)} — the box now keeps that row at ${w.want}.`;
  }
  return w.want === 0
    ? `${name} (${w.was} batch${w.was === 1 ? "" : "es"}) is already on the ${shortDay(productionDate)} plan and no longer sold for this date — take it off the plan by hand if needed.`
    : `${name} is already on the ${shortDay(productionDate)} plan at ${w.was} batch${w.was === 1 ? "" : "es"}; sales now say ${w.want} — change it on the plan.`;
}

/** What queueing the delivery's production would do now. Read only. */
export async function productionPreview(
  conn: Db, box: TestBoxRow, delivery: DeliveryRow,
  opts: { safetyBatch?: boolean; refreshError?: string | null } = {},
): Promise<ProductionPreview> {
  const productionDate = productionDateFor(delivery.deliveryDate);
  const safetyBatch = opts.safetyBatch ?? delivery.safetyBatch;
  const { recipes, links } = await loadRecipeLinks(conn, box.id);
  const orders = await loadOrdersForDate(conn, delivery.deliveryDate);
  const sold = packsSoldByRecipe(orders, delivery.deliveryDate, links);
  const rows = await queueRowsForDay(conn, productionDate);
  const own = rows.filter(r => r.testBoxDeliveryId === delivery.id);

  const lines: PreviewLine[] = recipes.map(r => {
    const id = Number(r.id);
    const packs = sold.packs.get(id) ?? 0;
    const packSize = Number(r.pack_size) || 1;
    const portionsPerBatch = Number(r.portions_per_batch) || 10;
    const { calzones, batches } = batchesFor({ packs, packSize, portionsPerBatch, safetyBatch });
    const q = own.find(x => x.recipeId === id && x.status === "planned") ?? own.find(x => x.recipeId === id);
    return {
      recipeId: id, name: r.name, isDraft: r.is_draft === true,
      packs, packSize, calzones, portionsPerBatch, batches,
      matchedBy: sold.matchedBy.get(id) ?? "none",
      queuedBatches: q ? q.batches : null,
      queuedStatus: q ? (q.status === "planned" ? "planned" : "queued") : null,
    };
  });

  const wanted = lines.map(l => ({ recipeId: l.recipeId, batches: l.batches }));
  const diff = planQueueDiff(wanted, rows, delivery.id);
  const nameOf = (id: number) => lines.find(l => l.recipeId === id)?.name ?? `Recipe ${id}`;
  const planExists = await planExistsFor(conn, productionDate);
  const warnings: string[] = diff.warnings.map(w => describeWarning(w, nameOf(w.recipeId), productionDate));
  if (planExists && diff.actions.some(a => a.kind !== "cancel")) {
    warnings.push(`The ${shortDay(productionDate)} plan has already been made, so newly queued batches won't land on it — add them on the plan.`);
  }
  const titleMatched = lines.filter(l => l.matchedBy === "title").map(l => l.name);
  if (titleMatched.length) {
    warnings.push(`${titleMatched.join(", ")} ${titleMatched.length === 1 ? "isn't" : "aren't"} linked to a Shopify product, so sales were matched by product title — link ${titleMatched.length === 1 ? "it" : "them"} on the recipe so a renamed product can't stop counting.`);
  }
  const unmatched = lines.filter(l => l.matchedBy === "none").map(l => l.name);
  if (unmatched.length) {
    warnings.push(`No sales found for ${unmatched.join(", ")} and ${unmatched.length === 1 ? "it isn't" : "they aren't"} linked to a Shopify product — check the link on the recipe.`);
  }
  if (opts.refreshError) warnings.push("Couldn't fetch the newest orders from Shopify — counted from the last synced copy.");

  return {
    deliveryId: delivery.id,
    deliveryDate: delivery.deliveryDate,
    productionDate,
    status: delivery.status,
    safetyBatch,
    orders: sold.orders,
    lines,
    totalBatches: lines.reduce((s, l) => s + l.batches, 0),
    blockers: lines.filter(l => l.isDraft && l.batches > 0).map(l => ({ recipeId: l.recipeId, name: l.name })),
    changes: diff.actions.length > 0,
    planExists,
    warnings,
    ordersSyncedAt: await ordersSyncedAt(conn),
    refreshError: opts.refreshError ?? null,
    queuedAt: delivery.queuedAt ? delivery.queuedAt.toISOString() : null,
    queuedBy: delivery.queuedByName ?? null,
  };
}

export type QueueResult =
  | { ok: true; preview: ProductionPreview; queued: boolean }
  | { ok: false; reason: "drafts"; preview: ProductionPreview };

/**
 * Bring the delivery's Queued production rows in step with its sales and
 * mark it "Production queued" (or back to "Closed" if nothing sold). Call
 * inside the transaction holding the box lock. Refuses while any recipe that
 * sold is a draft — drafts can't go on a plan.
 */
export async function queueFromSales(tx: Tx, box: TestBoxRow, delivery: DeliveryRow, user: Actor, opts: { safetyBatch?: boolean } = {}): Promise<QueueResult> {
  if (opts.safetyBatch !== undefined && opts.safetyBatch !== delivery.safetyBatch) {
    await tx.update(testBoxDeliveriesTable).set({ safetyBatch: opts.safetyBatch }).where(eq(testBoxDeliveriesTable.id, delivery.id));
    delivery = { ...delivery, safetyBatch: opts.safetyBatch };
  }
  const preview = await productionPreview(tx, box, delivery);
  if (preview.blockers.length > 0) return { ok: false, reason: "drafts", preview };

  const rows = await queueRowsForDay(tx, preview.productionDate);
  const { actions } = planQueueDiff(preview.lines.map(l => ({ recipeId: l.recipeId, batches: l.batches })), rows, delivery.id);
  const note = `Test box “${box.name}” — ${shortDay(delivery.deliveryDate)} delivery, from sales`.slice(0, 500);
  for (const a of actions) {
    if (a.kind === "insert") {
      await tx.insert(queuedProductionTable).values({
        productionDate: preview.productionDate, recipeId: a.recipeId, batches: a.batches,
        notes: note, createdByUserId: user.id, testBoxDeliveryId: delivery.id,
      });
    } else if (a.kind === "update") {
      await tx.update(queuedProductionTable)
        .set({ batches: a.batches, testBoxDeliveryId: delivery.id, ...(a.adopt ? { notes: note } : {}) })
        .where(and(eq(queuedProductionTable.id, a.id), eq(queuedProductionTable.status, "queued")));
    } else {
      await tx.update(queuedProductionTable).set({ status: "cancelled" })
        .where(and(eq(queuedProductionTable.id, a.id), eq(queuedProductionTable.status, "queued")));
    }
  }

  const queued = preview.totalBatches > 0;
  const summary = preview.lines.map(l => ({ recipeId: l.recipeId, name: l.name, packs: l.packs, batches: l.batches }));
  await tx.update(testBoxDeliveriesTable).set({
    status: queued ? "queued" : "closed",
    queuedAt: queued ? new Date() : null,
    queuedByName: queued ? user.name : null,
    queuedSummary: queued ? summary : null,
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(testBoxDeliveriesTable.id, delivery.id));
  return { ok: true, preview, queued };
}

/** Take the delivery's queued rows off. Returns warnings for rows a plan already took. */
export async function unqueueDelivery(tx: Tx, delivery: DeliveryRow): Promise<string[]> {
  const productionDate = productionDateFor(delivery.deliveryDate);
  const own = await tx.select({
    id: queuedProductionTable.id, recipeId: queuedProductionTable.recipeId, batches: queuedProductionTable.batches,
    status: queuedProductionTable.status, testBoxDeliveryId: queuedProductionTable.testBoxDeliveryId,
  }).from(queuedProductionTable).where(eq(queuedProductionTable.testBoxDeliveryId, delivery.id));
  const { cancel, onPlan } = planUnqueue(own, delivery.id);
  if (cancel.length) {
    await tx.update(queuedProductionTable).set({ status: "cancelled" })
      .where(and(inArray(queuedProductionTable.id, cancel), eq(queuedProductionTable.status, "queued")));
  }
  await tx.update(testBoxDeliveriesTable).set({ queuedAt: null, queuedByName: null, queuedSummary: null })
    .where(eq(testBoxDeliveriesTable.id, delivery.id));
  if (onPlan.length === 0) return [];
  const names = await tx.select({ id: recipesTable.id, name: recipesTable.name }).from(recipesTable)
    .where(inArray(recipesTable.id, onPlan.map(r => r.recipeId)));
  const nameOf = (id: number) => names.find(n => n.id === id)?.name ?? `Recipe ${id}`;
  return [`Already on the ${shortDay(productionDate)} plan, so left there: ${onPlan.map(r => `${r.batches} × ${nameOf(r.recipeId)}`).join(", ")} — change the plan by hand if they shouldn't be made.`];
}

/**
 * "Close orders for <date>" — from the button, the tick on the box or the
 * to-do. Closes, then queues the production from sales. If a recipe is
 * still a draft the delivery stays Closed and the card shows the blocker.
 * Returns false when the delivery wasn't open.
 */
export async function closeAndQueue(tx: Tx, box: TestBoxRow, delivery: DeliveryRow, user: Actor, opts: { safetyBatch?: boolean } = {}): Promise<{ changed: boolean; result: QueueResult | null }> {
  const changed = await setDeliveryClosed(tx, delivery, true, user);
  if (!changed) return { changed: false, result: null };
  const [fresh] = await tx.select().from(testBoxDeliveriesTable).where(eq(testBoxDeliveriesTable.id, delivery.id));
  return { changed: true, result: await queueFromSales(tx, box, fresh, user, opts) };
}

/** Reopen orders: the delivery's queued production comes off (plan rows stay, warned). */
export async function reopenDelivery(tx: Tx, delivery: DeliveryRow, user: Actor): Promise<{ changed: boolean; warnings: string[] }> {
  if (delivery.status !== "closed" && delivery.status !== "queued") return { changed: false, warnings: [] };
  const warnings = await unqueueDelivery(tx, delivery);
  await setDeliveryClosed(tx, { ...delivery, status: "closed" }, false, user);
  return { changed: true, warnings };
}

/** The orders mirror only needs to reach back to the box's launch. */
export function mirrorFromDate(box: TestBoxRow): string {
  return addDays(box.launchDate, -1);
}
