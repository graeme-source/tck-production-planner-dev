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
//  - Today's plan only takes new bags before 07:00 London (Graeme, 2026-08-25);
//    after the cutoff the earliest production day is tomorrow, and the proposed
//    delivery defaults to production + 2 (produce, despatch, deliver).
//  - We NEVER add a recipe to a plan. If an order's 8-pack recipe isn't already
//    on the target plan, the order is skipped with a reason and stays in the queue.
//  - If the target plan does not EXIST yet, the order is queued instead of
//    refused (Graeme, 2026-08-27). Plans are made a couple of days ahead, so an
//    order for a delivery three weeks out had nowhere to go and sat unprocessed
//    for a fortnight. Queueing tags the order immediately, exactly as processing
//    always did, and writes a queued_bag_orders row that lands the bags on the
//    plan for that date the moment it is created. See lib/queued-bags.ts.
//  - "Eight-pack bag" is detected by variant_title containing "8 pack bag".
//  - A line is mapped to a recipe by product title (the 8-pack is a variant of
//    the same Shopify product as the 2-pack), since eight_pack_variant_id is not
//    populated. Unmappable lines are skipped, never guessed.

import { Router, type IRouter } from "express";
import { db, productionPlanItemsTable, queuedBagOrdersTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import {
  earliestProductionDay,
  defaultDeliveryDay,
  earliestDespatchDay,
  earliestTagOnlyDeliveryDay,
  SAME_DAY_PRODUCTION_CUTOFF,
  DESPATCH_CUTOFF,
} from "../lib/production-cutoff";
import { getRecentUnfulfilledOrders, getOrderById, addTagsToOrder } from "../services/shopify";
import { queuedBagsBetween } from "../lib/queued-bags";
import {
  is8PackLine, loadTitleToRecipe, orderTags, hasProductionTag, firstDateTag,
  PRODUCTION_TAG, DATE_TAG_RE,
} from "../lib/eight-pack-orders";

const router: IRouter = Router();

const WHOLESALE_TAG = "wholesale";
const SCAN_DAYS_BACK = 30;
const QUEUE_TTL_MS = 60_000;

// ── calendar-date helpers (London-anchored "today", UTC-noon for day math) ──
function parseDay(s: string): Date { return new Date(`${s}T12:00:00Z`); }
function fmtDay(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(s: string, n: number): string { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return fmtDay(d); }
function weekday(s: string): number { return parseDay(s).getUTCDay(); } // 0 Sun … 6 Sat
function isDeliveryDay(s: string): boolean { const w = weekday(s); return w >= 2 && w <= 6; } // Tue–Sat
function despatchDateFor(deliveryDay: string): string { return addDays(deliveryDay, -1); }
// Options start the day after the given earliest working day (production day
// for 8-pack orders, despatch day for tag-only wholesale): working and
// despatching on the same day is the tightest turnaround we ever offer.
function deliveryDateOptions(earliestWorkDay: string, count: number): string[] {
  const out: string[] = [];
  let d = addDays(earliestWorkDay, 1);
  let guard = 0;
  while (out.length < count && guard++ < count * 3 + 14) {
    if (isDeliveryDay(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function hasWholesaleTag(tags: string): boolean {
  return orderTags(tags).map(t => t.toLowerCase()).includes(WHOLESALE_TAG);
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
    // Before the 7 a.m. London cutoff orders may still join today's plan; after
    // it the earliest production day is tomorrow, and the proposed delivery
    // allows two days from production (produce, despatch, deliver).
    const earliestProductionDate = earliestProductionDay();
    // Tag-only wholesale (2-pack) orders need no production — for them the
    // binding rule is the 14:00 despatch cutoff: processed after 2 p.m. means
    // the earliest despatch is tomorrow, so the earliest delivery is the day
    // after.
    const wholesaleEarliestDelivery = earliestTagOnlyDeliveryDay();
    const [orders, titleToRecipe] = await Promise.all([
      getRecentUnfulfilledOrders(SCAN_DAYS_BACK),
      loadTitleToRecipe(),
    ]);

    const deliveryDates = deliveryDateOptions(earliestProductionDate, 18); // ~3 weeks of Tue–Sat
    const wholesaleDeliveryDates = deliveryDateOptions(earliestDespatchDay(), 18);
    const plansByDate = await loadPlansByDate(addDays(today, -2), addDays(today, 25));

    const mapLine = (li: { id: number; title: string | null; variant_title: string | null; quantity: number }) => {
      const m = titleToRecipe.get((li.title ?? "").trim().toLowerCase()) ?? null;
      return {
        lineId: li.id,
        productTitle: li.title,
        variantTitle: li.variant_title,
        quantity: li.quantity,
        recipeId: m?.recipeId ?? null,
        recipeName: m?.recipeName ?? null,
      };
    };

    const queueOrders = orders
      .filter(o => !hasProductionTag(o.tags))
      .flatMap(o => {
        const eightPackLines = (o.line_items ?? []).filter(is8PackLine);
        // An order qualifies if it contains 8-pack bags, OR it's tagged "wholesale".
        // Orders that are wholesale AND have 8-pack bags are treated as 8-pack orders;
        // the wholesale-only group is wholesale orders with NO 8-pack bags (2-packs etc).
        if (eightPackLines.length === 0 && !hasWholesaleTag(o.tags)) return [];
        const kind = eightPackLines.length > 0 ? ("eight_pack" as const) : ("wholesale_2pack" as const);
        // 8-pack orders list only their 8-pack lines (those drive the plan). Wholesale-only
        // orders list every line — they're tag-only, so we just show what's in the order.
        const sourceLines = kind === "eight_pack" ? eightPackLines : (o.line_items ?? []);
        return [{ o, kind, lines: sourceLines.map(mapLine) }];
      })
      .map(({ o, kind, lines }) => {
        const existingDateTag = firstDateTag(o.tags);
        // A customer-requested date is respected only when it's still feasible
        // from now — otherwise we propose the kind's own default: 8-pack bags
        // get production + 2, tag-only wholesale gets the earliest despatchable
        // delivery.
        const kindEarliest = kind === "wholesale_2pack" ? wholesaleEarliestDelivery : addDays(earliestProductionDate, 1);
        const kindDefault = kind === "wholesale_2pack" ? wholesaleEarliestDelivery : defaultDeliveryDay();
        const proposedDeliveryDate = existingDateTag && isDeliveryDay(existingDateTag) && existingDateTag >= kindEarliest
          ? existingDateTag
          : kindDefault;
        const customerName = o.shipping_address?.name
          || (o.customer ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim() : "")
          || "";
        return { orderId: o.id, name: o.name, customerName, tags: o.tags, kind, existingDateTag, proposedDeliveryDate, lines };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1)); // newest order name first

    // Keyed by DESPATCH date (= plan_date). UI: for delivery D, look up [D−1].
    const plansByDespatchDate: Record<string, PlanInfo> = {};
    for (const [date, p] of plansByDate) plansByDespatchDate[date] = p;

    // Bags already queued against a future date, so the dialog can show what
    // is waiting rather than leaving a processed order looking like it
    // vanished.
    const pendingBags = await queuedBagsBetween(addDays(today, -2), addDays(today, 60));

    const payload = {
      generatedAt: new Date().toISOString(),
      today,
      earliestProductionDate,
      deliveryDates,
      wholesaleDeliveryDates,
      plansByDespatchDate,
      orders: queueOrders,
      pendingBags,
    };
    queueCache = { at: Date.now(), payload };
    res.json(payload);
  } catch (err) {
    console.error("[wholesale-bags] queue failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to load queue" });
  }
});

// ── POST /process — { orderId, deliveryDate, productionDate? } ──
// Adds bags to a plan + tags the order. productionDate (optional) picks WHICH
// plan gets the bags — it defaults to the despatch day (delivery − 1) but can
// be any earlier plan, so bags can be made days ahead of a delivery (Graeme,
// 2026-08: deliver the 13th, make on the 10th). The order tag is always the
// DELIVERY date, so despatch routing is untouched by the override.
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
  const rawProductionDate = req.body?.productionDate;
  if (rawProductionDate != null && rawProductionDate !== "" && !DATE_TAG_RE.test(String(rawProductionDate))) {
    res.status(400).json({ error: "productionDate must be YYYY-MM-DD when supplied" });
    return;
  }
  const requestedProductionDate: string | null =
    rawProductionDate != null && rawProductionDate !== "" ? String(rawProductionDate) : null;
  if (requestedProductionDate && requestedProductionDate > despatchDateFor(deliveryDate)) {
    res.status(400).json({ error: `Production day must be on or before the despatch day (${despatchDateFor(deliveryDate)} for delivery ${deliveryDate}) — bags must exist before they ship.` });
    return;
  }
  // No more than three days ahead of delivery (Graeme, 2026-08): bags made
  // earlier than that arrive with too little life left.
  if (requestedProductionDate && requestedProductionDate < addDays(deliveryDate, -3)) {
    res.status(400).json({ error: `Production day can be at most 3 days before delivery (${addDays(deliveryDate, -3)} at the earliest for delivery ${deliveryDate}).` });
    return;
  }

  try {
    // Re-fetch live so we tag against current tags and current line items.
    const order = await getOrderById(orderId);
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (hasProductionTag(order.tags)) { res.status(409).json({ error: "Order is already tagged 'production'." }); return; }

    const lines = (order.line_items ?? []).filter(is8PackLine);
    if (lines.length === 0) {
      // No 8-pack bags → this is a wholesale tag-only order. Just tag it with the
      // delivery date + production so it routes into the right despatch run. The 2-packs
      // already reach the plan via the normal order sync, so we make no plan changes and
      // don't require a plan to exist (per Graeme, 2026-06).
      if (!hasWholesaleTag(order.tags)) {
        res.status(409).json({ error: "Order has no eight-pack bag lines and is not tagged wholesale." });
        return;
      }
      // 14:00 rule: the delivery's despatch day (delivery − 1) must still be
      // reachable — despatch closes at 2 p.m., so an order processed after
      // that can't go out until tomorrow.
      if (despatchDateFor(deliveryDate) < earliestDespatchDay()) {
        res.status(409).json({
          error: `Too late to despatch for delivery ${deliveryDate} — despatch closes at ${DESPATCH_CUTOFF}, so the earliest delivery is now ${earliestTagOnlyDeliveryDay()}.`,
        });
        return;
      }
      let updatedTags: string;
      try {
        updatedTags = await addTagsToOrder(orderId, order.tags, [deliveryDate, PRODUCTION_TAG]);
      } catch (err) {
        res.status(502).json({ error: `Failed to tag Shopify order — no changes made, safe to retry. (${err instanceof Error ? err.message : String(err)})` });
        return;
      }
      queueCache = null; // reflect the change on the next poll
      res.json({ ok: true, orderId, deliveryDate, tagOnly: true, tags: updatedTags, added: [] });
      return;
    }

    const despatchDate = despatchDateFor(deliveryDate);
    // The plan that gets the bags: the override when given, else the despatch day.
    const productionDate = requestedProductionDate ?? despatchDate;
    // 7 a.m. rule: today's plan only takes new bags before the cutoff — after
    // that the earliest production day is tomorrow.
    const earliestAllowed = earliestProductionDay();
    if (productionDate < earliestAllowed) {
      res.status(409).json({
        error: `Too late to add bags to the ${productionDate} plan — after the ${SAME_DAY_PRODUCTION_CUTOFF} cutoff the earliest production day is ${earliestAllowed}. Choose a later production or delivery day.`,
        despatchDate,
        productionDate,
      });
      return;
    }
    const plan = (await loadPlansByDate(productionDate, productionDate)).get(productionDate);
    const titleToRecipe = await loadTitleToRecipe();

    // ── No plan yet for the chosen production day ──────────────────────────
    // Plans are made a couple of days ahead, so an order for a delivery three
    // weeks out has no plan to go on and used to be unprocessable — it just
    // sat in this queue (Graeme, 2026-08-27). Now it is QUEUED instead: the
    // order is tagged exactly as always (which is what routes despatch), and
    // the bags land on the plan for that date the moment it is created.
    if (!plan) {
      // Recipes still have to resolve. Queueing a bag we can't name would
      // just move the problem three weeks down the line.
      const queueResolved: Array<{ recipeId: number; recipeName: string; quantity: number }> = [];
      const queueUnmapped: string[] = [];
      for (const li of lines) {
        const m = titleToRecipe.get((li.title ?? "").trim().toLowerCase());
        if (!m) { queueUnmapped.push(li.title ?? "(untitled)"); continue; }
        queueResolved.push({ recipeId: m.recipeId, recipeName: m.recipeName, quantity: li.quantity || 0 });
      }
      if (queueUnmapped.length || queueResolved.length === 0) {
        res.status(409).json({
          error: "Cannot queue this order — some products don't map to a recipe.",
          unmappedProducts: queueUnmapped,
          despatchDate,
          productionDate,
        });
        return;
      }

      // Tag first, as in the with-a-plan path below: if this fails nothing
      // else has changed and the order is safe to retry.
      let queueTags: string;
      try {
        queueTags = await addTagsToOrder(orderId, order.tags, [deliveryDate, PRODUCTION_TAG]);
      } catch (err) {
        res.status(502).json({ error: `Failed to tag Shopify order — no changes made, safe to retry. (${err instanceof Error ? err.message : String(err)})` });
        return;
      }

      const byRecipeQueued = new Map<number, { recipeName: string; bags: number }>();
      for (const r of queueResolved) {
        const prior = byRecipeQueued.get(r.recipeId);
        byRecipeQueued.set(r.recipeId, { recipeName: r.recipeName, bags: (prior?.bags ?? 0) + r.quantity });
      }
      const queued: Array<{ recipeId: number; recipeName: string; bags: number }> = [];
      for (const [recipeId, { recipeName, bags }] of byRecipeQueued) {
        if (bags <= 0) continue;
        await db.insert(queuedBagOrdersTable).values({
          productionDate,
          deliveryDate,
          recipeId,
          bags,
          shopifyOrderId: String(orderId),
          shopifyOrderName: order.name ?? null,
          createdByUserId: req.session.userId ?? null,
        }).onConflictDoUpdate({
          // Re-processing the same order for the same day replaces the bag
          // count rather than doubling it.
          target: [queuedBagOrdersTable.shopifyOrderId, queuedBagOrdersTable.recipeId, queuedBagOrdersTable.productionDate],
          set: { bags, deliveryDate, status: "queued", planId: null, landedAt: null },
        });
        queued.push({ recipeId, recipeName, bags });
      }

      queueCache = null;
      res.json({ ok: true, queued: true, orderId, deliveryDate, despatchDate, productionDate, tags: queueTags, queuedBags: queued });
      return;
    }

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
        orderId, deliveryDate, despatchDate, productionDate, planId: plan.planId, tags: updatedTags, added, failedToAdd,
      });
      return;
    }
    res.json({ ok: true, orderId, deliveryDate, despatchDate, productionDate, planId: plan.planId, tags: updatedTags, added });
  } catch (err) {
    console.error("[wholesale-bags] process failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to process order" });
  }
});

export default router;
