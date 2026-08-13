import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { londonDateString } from "./london-time";

// ── Outstanding prep for TODAY, in raw ingredient units ────────────────────
//
// The ordering page predicts what a stock count will look like once today's
// prep is done: a shelf counted at 0 kg with 3 kg of red onions still to
// prep is effectively at −3 kg, so the order must cover the difference
// (Graeme, 2026-08-06). The stock-check flow itself is deliberately
// untouched — the team keeps counting what's physically there; only the
// ordering maths applies the deduction.
//
// Timing rule (avoids double-counting): a tin ticked BEFORE an ingredient's
// stock check has already left the shelf and is inside the counted figure,
// so it doesn't deduct again. A tin still open at count time — or ticked
// after — will consume counted stock, so it does. An ingredient with no
// recorded check gets the full non-deferred deduction (its baseline is
// yesterday's stock by definition).
//
// Deferred tins DEDUCT until they're completed (2026-08-13). They were
// originally excluded ("won't be prepped today"), but a deferral is an IOU:
// the tin gets prepped the NEXT day, from that day's counted stock — and by
// then its plan's prep day is yesterday, so the old logic couldn't see it
// from either direction. Real case: no beef on Wednesday → Thursday's beef
// trays deferred → 19 kg prepped Thursday morning was invisible, the orders
// page said 1.36 kg left to prep and suppressed the order. Plans from the
// last few prep days are now swept for deferred-and-uncompleted tins;
// non-deferred tins of past prep days stay excluded (an unticked tin from
// two days ago is a missed tick, not future consumption).
//
// Scope: tin-tracked prep only (main prep, veg and raw meat stations — the
// same reconstruction /prep-progress uses, plus raw_meat). Base/sauce
// sub-recipe production and dough are out: their raw consumption isn't
// tin-tracked, so there's nothing reliable to deduct from.

export interface OutstandingPrep {
  /** Plans whose prep day is today (usually one; empty when none). Deferral
   *  backlog plans are NOT listed here — their inclusion is tin-level. */
  prepPlanIds: number[];
  /** Raw native units still to be consumed by outstanding prep. */
  byIngredient: Record<number, number>;
  /** Each plan's share of byIngredient, so the caller can exclude exactly
   *  the plan whose own requirement already counts that consumption. */
  byPlan: Record<number, Record<number, number>>;
}

function calcTinCount(batchesTarget: number, maxBatchesPerTin: number | null): number | null {
  if (!maxBatchesPerTin || batchesTarget <= 0) return null;
  const raw = Math.ceil(batchesTarget / maxBatchesPerTin);
  return batchesTarget > 5 ? Math.max(2, raw) : raw;
}

export async function computeOutstandingPrepRaw(
  /** Latest stock check/entry timestamp per ingredient (ISO), from the
   *  orders merge — decides which completed tins are already inside the
   *  counted stock figure. */
  checkedAtByIngredient: Record<number, string | undefined>,
): Promise<OutstandingPrep> {
  const today = londonDateString();
  // Deferral look-back: how many prep days behind we sweep for deferred,
  // still-uncompleted tins. 5 covers a weekend plus a bank holiday.
  const backlogFrom = londonDateString(new Date(Date.now() - 5 * 86_400_000));

  // 'prep' and 'building' are legal mid-day statuses — a plan mustn't drop
  // out of the ordering maths the moment a station moves it forward.
  const plansRes = await db.execute(sql`
    SELECT id, COALESCE(prep_date, plan_date) AS prep_day FROM production_plans
    WHERE status IN ('draft', 'active', 'prep', 'building')
      AND COALESCE(prep_date, plan_date) BETWEEN ${backlogFrom} AND ${today}
  `);
  const planRows = plansRes.rows as Array<{ id: number; prep_day: string }>;
  const todayPlanIds = planRows.filter(r => String(r.prep_day).slice(0, 10) === today).map(r => r.id);
  const backlogPlanIds = new Set(planRows.filter(r => String(r.prep_day).slice(0, 10) !== today).map(r => r.id));
  const planIds = planRows.map(r => r.id);
  if (planIds.length === 0) return { prepPlanIds: [], byIngredient: {}, byPlan: {} };

  const idList = sql.join(planIds.map(id => sql`${id}`), sql`, `);

  // portions_per_batch is essential: recipe_ingredients.quantity is PER
  // PORTION, so a batch consumes quantity × portionsPerBatch — same as
  // resolveRecipeIngredients. Multiplying by batches alone understated every
  // deduction 10× (the 2026-08-13 burger beef bug: 19 kg of prep reported
  // as 1.36 kg outstanding, which suppressed the order suggestion).
  const itemsRes = await db.execute(sql`
    SELECT pi.plan_id, pi.recipe_id, pi.batches_target, pi.max_batches_per_tin,
           pi.mixing_tin_override, COALESCE(r.portions_per_batch, 10) AS portions_per_batch
    FROM production_plan_items pi
    LEFT JOIN recipes r ON r.id = pi.recipe_id
    WHERE pi.plan_id IN (${idList}) AND pi.recipe_id IS NOT NULL AND pi.batches_target > 0
  `);

  const overridesRes = await db.execute(sql`
    SELECT plan_id, recipe_id, ingredient_id, tin_count
    FROM prep_tin_overrides
    WHERE plan_id IN (${idList})
  `);
  const overrideMap = new Map<string, number>();
  for (const ov of overridesRes.rows as any[]) {
    if (ov.ingredient_id != null) overrideMap.set(`${ov.plan_id}_${ov.recipe_id}_${ov.ingredient_id}`, ov.tin_count);
  }

  // A tin ticked under any sub-recipe origin counts once — mirror
  // /prep-progress's dedupe, keeping the EARLIEST tick for the timing rule.
  const completionsRes = await db.execute(sql`
    SELECT plan_id, recipe_id, ingredient_id, tin_number, MIN(completed_at) AS completed_at
    FROM prep_completions
    WHERE plan_id IN (${idList}) AND ingredient_id IS NOT NULL
    GROUP BY plan_id, recipe_id, ingredient_id, tin_number
  `);
  const completedAtByTin = new Map<string, Date>();
  for (const c of completionsRes.rows as any[]) {
    completedAtByTin.set(`${c.plan_id}_${c.recipe_id}_${c.ingredient_id}_${c.tin_number}`, new Date(c.completed_at));
  }

  const deferralsRes = await db.execute(sql`
    SELECT plan_id, recipe_id, ingredient_id, tin_number
    FROM prep_deferrals
    WHERE plan_id IN (${idList})
  `);
  const deferredTins = new Set<string>();
  const deferredPlanRecipes = new Set<string>();
  for (const d of deferralsRes.rows as any[]) {
    deferredTins.add(`${d.plan_id}_${d.recipe_id}_${d.ingredient_id}_${d.tin_number}`);
    deferredPlanRecipes.add(`${d.plan_id}_${d.recipe_id}`);
  }

  const byIngredient: Record<number, number> = {};
  const byPlan: Record<number, Record<number, number>> = {};

  for (const item of itemsRes.rows as any[]) {
    const isBacklog = backlogPlanIds.has(item.plan_id);
    // Backlog plans only ever contribute deferred tins — skip recipes with
    // no deferrals at all rather than resolving their whole ingredient tree.
    if (isBacklog && !deferredPlanRecipes.has(`${item.plan_id}_${item.recipe_id}`)) continue;
    const batches = Number(item.batches_target) || 0;
    if (batches <= 0) continue;
    const defaultTinCount = calcTinCount(batches, item.max_batches_per_tin ?? null) ?? 1;

    const rowsRes = await db.execute(sql`
      SELECT ri.ingredient_id, ri.quantity, ri.include_in_filling_mix, ri.is_topping,
             i.name AS ingredient_name, i.category, i.processing_ratio
      FROM recipe_ingredients ri
      LEFT JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id = ${item.recipe_id}
        AND ri.marinade_for_ingredient_id IS NULL
    `);

    for (const row of rowsRes.rows as any[]) {
      if (row.is_topping) continue;
      const cat = row.category ?? "";
      // Toppings and dough are consumed on the production day, not prep day;
      // base/sauce raw usage runs through the sub-recipe flow, not tins.
      if (["base", "sauce", "dough"].includes(cat)) continue;
      const nameLc = (row.ingredient_name ?? "").toLowerCase();
      const isMozz = nameLc.includes("mozzarella") || nameLc.includes("fior di latte");
      if (isMozz && !row.include_in_filling_mix) continue;

      const isFillingMix = row.include_in_filling_mix ?? false;
      let tinCount = defaultTinCount;
      if (isFillingMix && item.mixing_tin_override != null) {
        tinCount = item.mixing_tin_override;
      } else if (!isFillingMix) {
        const ov = overrideMap.get(`${item.plan_id}_${item.recipe_id}_${row.ingredient_id}`);
        if (ov != null) tinCount = ov;
      }
      if (tinCount <= 0) continue;

      const cookedQty = (Number(row.quantity) || 0) * (Number(item.portions_per_batch) || 10) * batches;
      const ratio = Number(row.processing_ratio) || 1;
      const rawQty = ratio > 0 ? cookedQty / ratio : cookedQty;
      if (rawQty <= 0) continue;
      const perTin = rawQty / tinCount;

      const checkedAtStr = checkedAtByIngredient[row.ingredient_id];
      const checkedAt = checkedAtStr ? new Date(checkedAtStr) : null;

      for (let tin = 1; tin <= tinCount; tin++) {
        const key = `${item.plan_id}_${item.recipe_id}_${row.ingredient_id}_${tin}`;
        // Backlog plans: only tins the team explicitly deferred are still
        // owed. Today's plans: every tin counts, deferred included — a
        // deferred tin is prepped tomorrow from stock counted today, so the
        // order still has to cover it.
        if (isBacklog && !deferredTins.has(key)) continue;
        const doneAt = completedAtByTin.get(key);
        if (doneAt && checkedAt && doneAt.getTime() <= checkedAt.getTime()) continue;
        byIngredient[row.ingredient_id] = (byIngredient[row.ingredient_id] ?? 0) + perTin;
        (byPlan[item.plan_id] ??= {})[row.ingredient_id] =
          ((byPlan[item.plan_id] ?? {})[row.ingredient_id] ?? 0) + perTin;
      }
    }
  }

  for (const k of Object.keys(byIngredient)) {
    byIngredient[Number(k)] = Math.round(byIngredient[Number(k)] * 100) / 100;
  }
  for (const plan of Object.values(byPlan)) {
    for (const k of Object.keys(plan)) {
      plan[Number(k)] = Math.round(plan[Number(k)] * 100) / 100;
    }
  }

  return { prepPlanIds: todayPlanIds, byIngredient, byPlan };
}
