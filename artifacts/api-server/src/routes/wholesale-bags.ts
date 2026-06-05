// Wholesale / eight-pack bag processing.
//
// Finds open Shopify orders that contain "8 Pack Bag" calzone variants and are
// NOT yet tagged "production", lets a manager confirm a delivery date per order,
// then (a) adds those bags to the relevant production plan using the same
// eight_pack_bag_count field the production-overview +/- buttons drive, and
// (b) tags the order with the delivery-date tag + "production" (which drops it
// off this queue and routes it into the right despatch run automatically).
//
// Rules baked in (from Graeme, 2026-06):
//  - Delivery days are Tue–Sat. Despatch happens the day before delivery, so
//    bags go on the plan dated (deliveryDate − 1). Deliver tomorrow ⇒ today's plan.
//  - We NEVER add a recipe to a plan. If an order's 8-pack recipe isn't already
//    on the target plan, the order is skipped with a reason and stays in the queue.
//  - "Eight-pack bag" is detected by variant_title containing "8 pack bag".
//  - A line is mapped to a recipe by product title (the 8-pack is a variant of
//    the same Shopify product as the 2-pack), since eight_pack_variant_id is not
//    populated. Unmappable lines are skipped, never guessed.

import { Router, type IRouter } from "express";
import { db, productionPlanItemsTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import { getRecentUnfulfilledOrders, getOrderById, addTagsToOrder } from "../services/shopify";

const router: IRouter = Router();

const EIGHT_PACK_MATCH = "8 pack bag";
const PRODUCTION_TAG = "production";
const DATE_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCAN_DAYS_BACK = 30;
const QUEUE_TTL_MS = 60_000;

// ── calendar-date helpers (London-anchored "today", UTC-noon for day math) ──
function parseDay(s: string): Date { return new Date(`${s}T12:00:00Z`); }
function fmtDay(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtDay(d); }
function weekday(s: string): number { return parseDay(s).getUTCDay(); } // 0 Sun … 6 Sat
function isDeliveryDay(s: string): boolean { const w = weekday(s); return w >= 2 && w <= 6; } // Tue–Sat
function despatchDateFor(deliveryDay: string): string { return addDays(deliveryDay, -1); }
function nextDeliveryDay(todayStr: string): string {
  let d = addDays(todayStr, 1);
  for (let i = 0; i < 14 && !isDeliveryDay(d); i++) d = addDays(d, 1);
  return d;
}
function deliveryDateOptions(todayStr: string, count: number): string[] {
  const out: string[] = [];
  let d = addDays(todayStr, 1);
  let guard = 0;
  while (out.length < count && guard++ < count * 3 + 14) {
    if (isDeliveryDay(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function firstDateTag(tags: string): string | null {
  for (const t of tags.split(",").map(t => t.trim())) if (DATE_TAG_RE.test(t)) return t;
  return null;
}
function hasProductionTag(tags: string): boolean {
  return tags.split(",").map(t => t.trim().toLowerCase()).includes(PRODUCTION_TAG);
}
function is8PackLine(li: { variant_title: string | null }): boolean {
  return (li.variant_title ?? "").toLowerCase().includes(EIGHT_PACK_MATCH);
}

/** Map normalised product title → recipe. The 8-pack is a variant of the same
 *  product as the 2-pack, so the product title resolves the recipe. */
async function loadTitleToRecipe(): Promise<Map<string, { recipeId: number; recipeName: string }>> {
  const rows = await db.execute<{ title: string; recipe_id: number; name: string }>(sql`
    SELECT DISTINCT m.shopify_product_title AS title, m.recipe_id, r.name
    FROM recipe_shopify_mappings m
    JOIN recipes r ON r.id = m.recipe_id
    WHERE m.shopify_product_title IS NOT NULL
  `);
  const map = new Map<string, { recipeId: number; recipeName: string }>();
  for (const row of rows.rows) {
    const key = (row.title ?? "").trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, { recipeId: row.recipe_id, recipeName: row.name });
  }
  return map;
}

interface PlanInfo { planId: number; planDate: string; status: string; recipeIds: number[]; }

/** Production plans within [fromDay, toDay], keyed by plan_date (= despatch date). */
async function loadPlansByDate(fromDay: string, toDay: string): Promise<Map<string, PlanInfo>> {
  const planRows = await db.execute<{ id: number; plan_date: string; status: string }>(sql`
    SELECT id, plan_date::text AS plan_date, status
    FROM production_plans
    WHERE plan_date BETWEEN ${fromDay} AND ${toDay}
  `);
  const plans = planRows.rows;
  const planIds = plans.map(p => p.id);
  const itemRows = planIds.length
    ? await db
        .select({ planId: productionPlanItemsTable.planId, recipeId: productionPlanItemsTable.recipeId })
        .from(productionPlanItemsTable)
        .where(inArray(productionPlanItemsTable.planId, planIds))
    : [];
  const recipesByPlan = new Map<number, Set<number>>();
  for (const it of itemRows) {
    if (it.recipeId == null) continue;
    if (!recipesByPlan.has(it.planId)) recipesByPlan.set(it.planId, new Set());
    recipesByPlan.get(it.planId)!.add(it.recipeId);
  }
  const byDate = new Map<string, PlanInfo>();
  for (const p of plans) {
    byDate.set(p.plan_date, { planId: p.id, planDate: p.plan_date, status: p.status, recipeIds: [...(recipesByPlan.get(p.id) ?? [])] });
  }
  return byDate;
}

// ── GET /queue — unprocessed eight-pack orders + plan recipe sets for validation ──
let queueCache: { at: number; payload: unknown } | null = null;

router.get("/queue", async (_req, res) => {
  try {
    if (queueCache && Date.now() - queueCache.at < QUEUE_TTL_MS) {
      res.json(queueCache.payload);
      return;
    }
    const today = londonDateString();
    const [orders, titleToRecipe] = await Promise.all([
      getRecentUnfulfilledOrders(SCAN_DAYS_BACK),
      loadTitleToRecipe(),
    ]);

    const deliveryDates = deliveryDateOptions(today, 18); // ~3 weeks of Tue–Sat
    const plansByDate = await loadPlansByDate(addDays(today, -2), addDays(today, 25));

    const queueOrders = orders
      .filter(o => !hasProductionTag(o.tags))
      .map(o => {
        const lines = (o.line_items ?? []).filter(is8PackLine).map(li => {
          const m = titleToRecipe.get((li.title ?? "").trim().toLowerCase()) ?? null;
          return {
            lineId: li.id,
            productTitle: li.title,
            variantTitle: li.variant_title,
            quantity: li.quantity,
            recipeId: m?.recipeId ?? null,
            recipeName: m?.recipeName ?? null,
          };
        });
        return { o, lines };
      })
      .filter(x => x.lines.length > 0)
      .map(({ o, lines }) => {
        const existingDateTag = firstDateTag(o.tags);
        const proposedDeliveryDate = existingDateTag && isDeliveryDay(existingDateTag)
          ? existingDateTag
          : nextDeliveryDay(today);
        const customerName = o.shipping_address?.name
          || (o.customer ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim() : "")
          || "";
        return { orderId: o.id, name: o.name, customerName, tags: o.tags, existingDateTag, proposedDeliveryDate, lines };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest order name first

    // Keyed by DESPATCH date (= plan_date). UI: for delivery D, look up [D−1].
    const plansByDespatchDate: Record<string, PlanInfo> = {};
    for (const [date, p] of plansByDate) plansByDespatchDate[date] = p;

    const payload = {
      generatedAt: new Date().toISOString(),
      today,
      deliveryDates,
      plansByDespatchDate,
      orders: queueOrders,
    };
    queueCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error("[wholesale-bags] queue failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to load queue" });
  }
});

// ── POST /process — { orderId, deliveryDate } — add bags to plan + tag order ──
router.post("/process", async (req, res) => {
  const orderId = Number(req.body?.orderId);
  const deliveryDate = String(req.body?.deliveryDate ?? "");
  if (!Number.isFinite(orderId) || !DATE_TAG_RE.test(deliveryDate)) {
    res.status(400).json({ error: "Body must contain { orderId: number, deliveryDate: 'YYYY-MM-DD' }" });
    return;
  }
  if (!isDeliveryDay(deliveryDate)) {
    res.status(400).json({ error: "Delivery date must be a Tue–Sat" });
    return;
  }

  try {
    // Re-fetch live so we tag against current tags and current line items.
    const order = await getOrderById(orderId);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (hasProductionTag(order.tags)) { res.status(409).json({ error: "Order is already tagged 'production'." }); return; }

    const lines = (order.line_items ?? []).filter(is8PackLine);
    if (lines.length === 0) { res.status(409).json({ error: "Order has no eight-pack bag lines." }); return; }

    const despatchDate = despatchDateFor(deliveryDate);
    const plan = (await loadPlansByDate(despatchDate, despatchDate)).get(despatchDate);
    if (!plan) {
      res.status(409).json({ error: `No production plan exists for ${despatchDate} (despatch day for delivery ${deliveryDate}).`, despatchDate });
      return;
    }

    const titleToRecipe = await loadTitleToRecipe();
    const planRecipes = new Set(plan.recipeIds);
    const resolved: Array<{ recipeId: number; recipeName: string; quantity: number }> = [];
    const unmappedProducts: string[] = [];
    const recipesNotOnPlan: string[] = [];
    for (const li of lines) {
      const m = titleToRecipe.get((li.title ?? "").trim().toLowerCase());
      if (!m) { unmappedProducts.push(li.title ?? "(untitled)"); continue; }
      if (!planRecipes.has(m.recipeId)) { recipesNotOnPlan.push(m.recipeName); continue; }
      resolved.push({ recipeId: m.recipeId, recipeName: m.recipeName, quantity: li.quantity || 0 });
    }
    if (unmappedProducts.length || recipesNotOnPlan.length) {
      res.status(409).json({
        error: "Cannot process this order onto the target plan.",
        unmappedProducts,
        recipesNotOnPlan,
        despatchDate,
        planDate: plan.planDate,
      });
      return;
    }

    // 1) Tag first. If this fails nothing else has changed → safe to retry.
    let updatedTags: string;
    try {
      updatedTags = await addTagsToOrder(orderId, order.tags, [deliveryDate, PRODUCTION_TAG]);
    } catch (err) {
      res.status(502).json({ error: `Failed to tag Shopify order — no changes made, safe to retry. (${err instanceof Error ? err.message : String(err)})` });
      return;
    }

    // 2) Add bags to the plan (reuses the eight_pack_bag_count field). Group by
    //    recipe so duplicate lines sum. An under-add here is caught at packing by
    //    the existing "short on the pack" warning; a double-add is prevented by
    //    the production-tag guard above on any retry.
    const byRecipe = new Map<number, number>();
    for (const r of resolved) byRecipe.set(r.recipeId, (byRecipe.get(r.recipeId) ?? 0) + r.quantity);
    const added: Array<{ recipeId: number; recipeName: string; bagsAdded: number }> = [];
    const failedToAdd: string[] = [];
    for (const [recipeId, qty] of byRecipe) {
      if (qty <= 0) continue;
      const recipeName = resolved.find(r => r.recipeId === recipeId)?.recipeName ?? String(recipeId);
      try {
        await db.execute(sql`
          UPDATE production_plan_items
          SET eight_pack_bag_count = eight_pack_bag_count + ${qty}
          WHERE plan_id = ${plan.planId} AND recipe_id = ${recipeId}
        `);
        added.push({ recipeId, recipeName, bagsAdded: qty });
      } catch (err) {
        console.error(`[wholesale-bags] failed adding ${qty} bags for recipe ${recipeId} on plan ${plan.planId}:`, err);
        failedToAdd.push(recipeName);
      }
    }

    queueCache = null; // reflect the change on the next poll

    if (failedToAdd.length) {
      res.status(207).json({
        warning: "Order tagged, but some bags couldn't be added — add these manually on the production overview.",
        orderId, deliveryDate, despatchDate, planId: plan.planId, tags: updatedTags, added, failedToAdd,
      });
      return;
    }
    res.json({ ok: true, orderId, deliveryDate, despatchDate, planId: plan.planId, tags: updatedTags, added });
  } catch (err) {
    console.error("[wholesale-bags] process failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to process order" });
  }
});

export default router;
