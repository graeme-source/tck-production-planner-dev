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
// yesterday's stock by definition). Deferred tins won't be prepped today at
// all and never deduct.
//
// Scope: tin-tracked prep only (main prep, veg and raw meat stations — the
// same reconstruction /prep-progress uses, plus raw_meat). Base/sauce
// sub-recipe production and dough are out: their raw consumption isn't
// tin-tracked, so there's nothing reliable to deduct from.

export interface OutstandingPrep {
  /** Plans whose prep day is today (usually one; empty when none). */
  prepPlanIds: number[];
  /** Raw native units still to be consumed by today's outstanding prep. */
  byIngredient: Record<number, number>;
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

  const plansRes = await db.execute(sql`
    SELECT id FROM production_plans
    WHERE status IN ('draft', 'active')
      AND COALESCE(prep_date, plan_date) = ${today}
  `);
  const planIds = (plansRes.rows as Array<{ id: number }>).map(r => r.id);
  if (planIds.length === 0) return { prepPlanIds: [], byIngredient: {} };

  const idList = sql.join(planIds.map(id => sql`${id}`), sql`, `);

  const itemsRes = await db.execute(sql`
    SELECT plan_id, recipe_id, batches_target, max_batches_per_tin, mixing_tin_override
    FROM production_plan_items
    WHERE plan_id IN (${idList}) AND recipe_id IS NOT NULL AND batches_target > 0
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
  for (const d of deferralsRes.rows as any[]) {
    deferredTins.add(`${d.plan_id}_${d.recipe_id}_${d.ingredient_id}_${d.tin_number}`);
  }

  const byIngredient: Record<number, number> = {};

  for (const item of itemsRes.rows as any[]) {
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

      const cookedQty = (Number(row.quantity) || 0) * batches;
      const ratio = Number(row.processing_ratio) || 1;
      const rawQty = ratio > 0 ? cookedQty / ratio : cookedQty;
      if (rawQty <= 0) continue;
      const perTin = rawQty / tinCount;

      const checkedAtStr = checkedAtByIngredient[row.ingredient_id];
      const checkedAt = checkedAtStr ? new Date(checkedAtStr) : null;

      for (let tin = 1; tin <= tinCount; tin++) {
        const key = `${item.plan_id}_${item.recipe_id}_${row.ingredient_id}_${tin}`;
        if (deferredTins.has(key)) continue;
        const doneAt = completedAtByTin.get(key);
        if (doneAt && checkedAt && doneAt.getTime() <= checkedAt.getTime()) continue;
        byIngredient[row.ingredient_id] = (byIngredient[row.ingredient_id] ?? 0) + perTin;
      }
    }
  }

  for (const k of Object.keys(byIngredient)) {
    byIngredient[Number(k)] = Math.round(byIngredient[Number(k)] * 100) / 100;
  }

  return { prepPlanIds: planIds, byIngredient };
}
