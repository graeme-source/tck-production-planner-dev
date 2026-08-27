// GET /bag-cover — will the 8-pack bags exist in time for the next three
// despatches?
//
// Asked by Graeme on 2026-08-27, while making production plans: for every
// 8-pack order going out on the next three vans, do we have the bags —
// counting what's in the fridge and what's planned between now and then, and
// NOT counting production scheduled after the van would have to leave.
//
// This route only gathers facts. The arithmetic, and the reasoning about what
// may and may not count as cover, lives in lib/bag-cover.ts where it is
// tested. The facts come from the same places everything else reads:
//   • demand   — Shopify orders tagged "production" with a delivery date, via
//                the shared 8-pack line reader (lib/eight-pack-orders.ts), so
//                this can't disagree with the processing queue about what a
//                bag order is.
//   • plans    — production_plan_items.eight_pack_bag_count.
//   • queue    — queued_bag_orders whose plan doesn't exist yet.
//   • fridge   — today's 8-pack stock entries, the same reading the fulfilment
//                pick list gates on.

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "../lib/london-time";
import { getRecentUnfulfilledOrders } from "../services/shopify";
import {
  is8PackLine, loadTitleToRecipe, recipeForLine, hasProductionTag, firstDateTag,
} from "../lib/eight-pack-orders";
import { computeBagCover, dispatchDayFor, nextDispatchDays, type BagDemand, type BagSupply } from "../lib/bag-cover";

const router: IRouter = Router();

const SCAN_DAYS_BACK = 30;
/** How many despatches ahead to check. Three was the ask; it's a query param
 *  so the Create Plan screen can widen it without a deploy. */
const DEFAULT_DISPATCHES = 3;
const MAX_DISPATCHES = 10;
/** Bags may be made at most three days before delivery, so nothing older than
 *  this can legitimately be cover — it's the window we look back over when
 *  reporting "there was production before today, go and check the fridge". */
const EARLIER_PRODUCTION_LOOKBACK_DAYS = 3;
const CACHE_TTL_MS = 60_000;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

let cache: { at: number; key: string; payload: unknown } | null = null;

router.get("/", async (req, res) => {
  const requested = Number(req.query.dispatches);
  const count = Number.isFinite(requested)
    ? Math.min(MAX_DISPATCHES, Math.max(1, Math.trunc(requested)))
    : DEFAULT_DISPATCHES;
  try {
    const today = londonDateString();
    const cacheKey = `${today}:${count}`;
    if (cache && cache.key === cacheKey && Date.now() - cache.at < CACHE_TTL_MS) {
      res.json(cache.payload);
      return;
    }

    const dispatchDates = nextDispatchDays(today, count);
    const lastDispatch = dispatchDates[dispatchDates.length - 1] ?? today;
    const earliestLookback = addDays(today, -EARLIER_PRODUCTION_LOOKBACK_DAYS);

    const [orders, titleToRecipe] = await Promise.all([
      getRecentUnfulfilledOrders(SCAN_DAYS_BACK),
      loadTitleToRecipe(),
    ]);

    // ── Demand ────────────────────────────────────────────────────────────
    // Only PROCESSED orders (tagged "production" with a delivery date) are
    // committed to a van. Anything still unprocessed is the planner's job in
    // the 8-pack queue and would be double-counted once they deal with it.
    const demand: BagDemand[] = [];
    const unmappedProducts = new Set<string>();
    for (const o of orders) {
      if (!hasProductionTag(o.tags)) continue;
      const deliveryDate = firstDateTag(o.tags);
      if (!deliveryDate) continue;
      const dispatchDate = dispatchDayFor(deliveryDate);
      if (!dispatchDates.includes(dispatchDate)) continue;
      for (const li of (o.line_items ?? []).filter(is8PackLine)) {
        const m = recipeForLine(li, titleToRecipe);
        if (!m) { unmappedProducts.add(li.title ?? "(untitled)"); continue; }
        if ((li.quantity || 0) <= 0) continue;
        demand.push({
          dispatchDate,
          deliveryDate,
          recipeId: m.recipeId,
          recipeName: m.recipeName,
          bags: li.quantity,
          orderName: o.name ?? null,
        });
      }
    }

    // ── Supply on real production plans ───────────────────────────────────
    const planRows = await db.execute<{ plan_date: string; recipe_id: number; bags: number }>(sql`
      SELECT p.plan_date::text AS plan_date, i.recipe_id, i.eight_pack_bag_count AS bags
      FROM production_plan_items i
      JOIN production_plans p ON p.id = i.plan_id
      WHERE i.recipe_id IS NOT NULL
        AND COALESCE(i.eight_pack_bag_count, 0) > 0
        AND p.plan_date BETWEEN ${earliestLookback} AND ${lastDispatch}
    `);
    const supply: BagSupply[] = planRows.rows.map(r => ({
      productionDate: r.plan_date,
      recipeId: Number(r.recipe_id),
      bags: Number(r.bags) || 0,
      queued: false,
    }));

    // ── Supply still sitting in the queue ─────────────────────────────────
    // A queued row only counts when the plan for its date DOESN'T EXIST yet —
    // that's the mechanism working normally, and it lands when the plan is
    // made. A row still queued for a date that HAS a plan means the recipe
    // isn't on that plan and the bags cannot land, so it must NOT count as
    // cover: it should show up as the shortfall it is.
    const planDatesRes = await db.execute<{ plan_date: string }>(sql`
      SELECT DISTINCT plan_date::text AS plan_date
      FROM production_plans
      WHERE plan_date BETWEEN ${today} AND ${lastDispatch}
    `);
    const datesWithPlans = new Set(planDatesRes.rows.map(r => r.plan_date));
    const queuedRows = await db.execute<{ production_date: string; recipe_id: number; recipe_name: string; bags: number; order_name: string | null }>(sql`
      SELECT q.production_date::text AS production_date, q.recipe_id, r.name AS recipe_name,
             q.bags, q.shopify_order_name AS order_name
      FROM queued_bag_orders q
      JOIN recipes r ON r.id = q.recipe_id
      WHERE q.status = 'queued'
        AND q.production_date BETWEEN ${today} AND ${lastDispatch}
    `);
    const strandedQueued: Array<{ productionDate: string; recipeId: number; recipeName: string; bags: number; orderName: string | null }> = [];
    for (const r of queuedRows.rows) {
      const row = { productionDate: r.production_date, recipeId: Number(r.recipe_id), bags: Number(r.bags) || 0 };
      if (datesWithPlans.has(row.productionDate)) {
        strandedQueued.push({ ...row, recipeName: r.recipe_name, orderName: r.order_name ?? null });
        continue;
      }
      supply.push({ ...row, queued: true });
    }

    // ── Bags in the fridge ────────────────────────────────────────────────
    // Today's entries only. Nothing decrements a bag reading, so an older one
    // is a high-water mark rather than a stock level — the same line the
    // fulfilment pick list takes.
    const bagRes = await db.execute<{ recipe_id: number; bags: string }>(sql`
      SELECT DISTINCT ON (se.recipe_id) se.recipe_id, se.quantity AS bags
      FROM stock_entries se
      WHERE se.recipe_id IS NOT NULL
        AND se.location = 'production_fridge'
        AND se.pack_size = 8
        AND se.checked_at >= ${`${today}T00:00:00`}::timestamp
      ORDER BY se.recipe_id, se.checked_at DESC
    `);
    const wrappedToday: Record<number, number> = {};
    for (const r of bagRes.rows) {
      wrappedToday[Number(r.recipe_id)] = Math.max(0, Math.floor(Number(r.bags) || 0));
    }

    const result = computeBagCover({ today, dispatchDates, demand, supply, wrappedToday });

    const payload = {
      generatedAt: new Date().toISOString(),
      today,
      dispatchDates,
      ...result,
      // Queued bags for a date whose plan exists but doesn't carry the recipe.
      // They cannot land on their own and need a human.
      strandedQueued,
      // 8-pack lines we couldn't map to a recipe. Reported rather than
      // silently dropped: an unmapped bag is invisible demand.
      unmappedProducts: [...unmappedProducts],
    };
    cache = { at: Date.now(), key: cacheKey, payload };
    res.json(payload);
  } catch (err) {
    console.error("[bag-cover] failed:", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Could not check bag cover" });
  }
});

export default router;
