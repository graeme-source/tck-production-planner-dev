/**
 * Move production — whole plan or one line of it — to another date
 * (Graeme, 2026-09-16). "We didn't make the mac cheese today" → push just
 * the mac cheese onto another day's plan, or onto a standalone plan of its
 * own; same for fried chicken, calzones, or the whole plan.
 *
 * Managers and admins only. Lives in its own file — the charter forbids
 * growing routes/production-plans.ts — but reuses its exported date
 * resolvers so a moved plan's prep/dough dates follow the same rules as a
 * created one.
 *
 * Scope semantics:
 * - "all": the plan itself changes date (prep/dough dates and the julian
 *   batch number are recomputed for the new date). Everything hanging off
 *   the plan follows automatically.
 * - "calzones" | "mac_cheese" | "fried_chicken": the matching items are
 *   re-parented onto the plan on the target date (created as an active
 *   standalone plan when none exists). Rows keyed by BOTH plan and
 *   item/recipe move too: batch weight records, prep completions and tin
 *   overrides for the moved recipes, and (for fried chicken) the prep
 *   ticks. Batch completions key off the item alone, so they follow.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, productionPlansTable, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { resolveDefaultPrepDate, resolveDefaultDoughDate } from "./production-plans";
import { FRIED_CHICKEN_CATEGORY } from "./fried-chicken";

const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

const router: IRouter = Router();

const MoveBody = z.object({
  scope: z.enum(["all", "calzones", "mac_cheese", "fried_chicken"]),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD"),
});

// "Friday 19 Sep 2026" — matches the created-plan naming convention.
// (No date-fns in the api workspace; hand-rolled from fixed English names.)
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatPlanDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function julianBatchNumber(date: Date): number {
  const year = date.getFullYear() % 100;
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return year * 1000 + dayOfYear;
}

const SCOPE_LABELS: Record<string, string> = {
  calzones: "Calzones",
  mac_cheese: "Mac Cheese",
  fried_chicken: "Fried Chicken",
};

router.post("/:planId", requireManagerOrAdmin, validate(MoveBody), async (req, res) => {
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId)) { res.status(400).json({ error: "Invalid plan id" }); return; }
  const { scope, targetDate } = req.body as z.infer<typeof MoveBody>;

  const [plan] = await db.select().from(productionPlansTable).where(eq(productionPlansTable.id, planId));
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  if (plan.planDate === targetDate) {
    res.status(400).json({ error: "That plan is already on that date." });
    return;
  }

  // ── Whole plan: just re-date it; children follow via plan_id. ──────────
  if (scope === "all") {
    const [prepDate, doughDate] = await Promise.all([
      resolveDefaultPrepDate(targetDate),
      resolveDefaultDoughDate(targetDate),
    ]);
    // Auto-generated names carry the day ("… – Monday 7 Sep 2026") — keep
    // them honest when the day changes. Hand-typed names are left alone.
    const oldDay = formatPlanDay(plan.planDate);
    const name = plan.name.includes(oldDay)
      ? plan.name.replace(oldDay, formatPlanDay(targetDate))
      : plan.name;
    await db.update(productionPlansTable)
      .set({
        planDate: targetDate,
        prepDate,
        doughDate,
        name,
        batchNumber: julianBatchNumber(new Date(`${targetDate}T12:00:00Z`)),
      })
      .where(eq(productionPlansTable.id, planId));
    res.json({ moved: "plan", planId, targetDate });
    return;
  }

  // ── One line of the plan. ───────────────────────────────────────────────
  const items = await db
    .select({
      id: productionPlanItemsTable.id,
      recipeId: productionPlanItemsTable.recipeId,
      category: recipesTable.category,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const inScope = (category: string | null) => {
    if (scope === "mac_cheese") return category === MAC_CHEESE_CATEGORY;
    if (scope === "fried_chicken") return category === FRIED_CHICKEN_CATEGORY;
    // calzones = the core line: everything that isn't one of the other lines
    return category !== MAC_CHEESE_CATEGORY && category !== FRIED_CHICKEN_CATEGORY;
  };
  const moving = items.filter(i => inScope(i.category));
  if (moving.length === 0) {
    res.status(400).json({ error: `This plan has no ${SCOPE_LABELS[scope]} items to move.` });
    return;
  }
  if (moving.length === items.length) {
    res.status(400).json({
      error: "That's every item on the plan — use 'Whole plan' instead, so the plan itself (and its batch number) moves.",
    });
    return;
  }
  const movingItemIds = moving.map(i => i.id);
  const movingRecipeIds = [...new Set(moving.map(i => i.recipeId).filter((x): x is number => x != null))];

  // Target: an existing plan on that date, else a fresh standalone plan.
  // Skip drafts as merge targets — landing real production inside a draft
  // would hide it from every station until someone activates the draft.
  const targets = await db.select().from(productionPlansTable)
    .where(and(eq(productionPlansTable.planDate, targetDate), sql`${productionPlansTable.status} <> 'draft'`))
    .orderBy(productionPlansTable.id);
  let target = targets[0] ?? null;
  let createdPlan = false;
  if (!target) {
    const [prepDate, doughDate] = await Promise.all([
      resolveDefaultPrepDate(targetDate),
      resolveDefaultDoughDate(targetDate),
    ]);
    const label = SCOPE_LABELS[scope];
    const dayName = formatPlanDay(targetDate);
    const [created] = await db.insert(productionPlansTable).values({
      planDate: targetDate,
      prepDate,
      doughDate,
      name: `${label} – ${dayName}`,
      notes: `Moved from ${plan.name} (${plan.planDate}).`,
      status: "active",
      batchNumber: julianBatchNumber(new Date(`${targetDate}T12:00:00Z`)),
    }).returning();
    target = created;
    createdPlan = true;
  }

  // Merge after the target's existing items so its production order stays.
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${productionPlanItemsTable.orderPosition}), 0)` })
    .from(productionPlanItemsTable)
    .where(eq(productionPlanItemsTable.planId, target.id));

  await db.transaction(async (tx) => {
    for (let i = 0; i < movingItemIds.length; i++) {
      await tx.update(productionPlanItemsTable)
        .set({ planId: target!.id, orderPosition: Number(maxPos) + i + 1 })
        .where(eq(productionPlanItemsTable.id, movingItemIds[i]));
    }
    // Rows keyed by plan AND item/recipe — carry them to the new plan so
    // progress and prep state stay attached to the work they describe.
    await tx.execute(sql`
      UPDATE batch_weight_records SET plan_id = ${target!.id}
      WHERE plan_id = ${planId} AND plan_item_id IN (${sql.join(movingItemIds.map(id => sql`${id}`), sql`, `)})
    `);
    if (movingRecipeIds.length > 0) {
      const recipeList = sql.join(movingRecipeIds.map(id => sql`${id}`), sql`, `);
      await tx.execute(sql`
        UPDATE prep_completions SET plan_id = ${target!.id}
        WHERE plan_id = ${planId} AND recipe_id IN (${recipeList})
      `);
      await tx.execute(sql`
        UPDATE prep_tin_overrides SET plan_id = ${target!.id}
        WHERE plan_id = ${planId} AND recipe_id IN (${recipeList})
      `);
    }
    if (scope === "fried_chicken") {
      // The fried-chicken prep sheet is plan-scoped and only ever concerns
      // fried chicken, so its ticks travel with the line.
      await tx.execute(sql`
        UPDATE fried_chicken_prep_ticks SET plan_id = ${target!.id} WHERE plan_id = ${planId}
      `);
    }
  });

  res.json({
    moved: scope,
    movedItemCount: movingItemIds.length,
    sourcePlanId: planId,
    targetPlanId: target.id,
    targetPlanName: target.name,
    targetDate,
    createdPlan,
  });
});

export default router;
