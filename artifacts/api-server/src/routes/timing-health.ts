/**
 * GET /api/timing-health — every timing input the day schedule needs that is
 * missing (or no longer matches the floor), each with a suggested value from
 * real history. Feeds the "Timing data" card on the Recipes page.
 *
 * Read-only. Saving a suggestion goes through PUT /api/recipes/:id/build-time
 * or PUT /api/ingredients/:id/meat-timing when a manager taps "Use suggested".
 * Rules: lib/timing-health.ts (what counts as a gap) and
 * lib/timing-suggestions.ts (how history becomes a suggestion).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  db, recipesTable, ingredientsTable, productionPlansTable, productionPlanItemsTable,
  ovenEventsTable, timingSuggestionReviewsTable, usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { validate } from "../middleware/validate";
import { dismissalStillHolds, reviewTodoTitle, type TimingKind } from "../lib/timing-review-rules";
import { requireManagerOrAdmin } from "../middleware/roles";
import { rawMeatsForRecipe } from "../lib/day-schedule";
import { assembleTimingHealth, isOnDayTimeline, type HealthMeatInput } from "../lib/timing-health";
import { suggestCookMinutes } from "../lib/timing-suggestions";
import { BUILD_HISTORY_DAYS, loadBuildSuggestions } from "../services/build-time-history";
import { isOnMenu } from "../lib/recipe-archive-rules";

const router: IRouter = Router();

/** Build-time history window: recent enough to reflect today's team and recipes
 *  (one figure, shared with the batch-profit report). */
export const BUILD_WINDOW_DAYS = BUILD_HISTORY_DAYS;
/** Meat cooks are fewer per day, so look back further for enough trays. */
export const COOK_WINDOW_DAYS = 84;


router.get("/", requireManagerOrAdmin, async (_req, res) => {
  const buildSince = new Date(Date.now() - BUILD_WINDOW_DAYS * 86_400_000);
  const cookSince = new Date(Date.now() - COOK_WINDOW_DAYS * 86_400_000);
  const planSince = buildSince.toISOString().slice(0, 10);

  const recipes = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      category: recipesTable.category,
      targetBuildSeconds: recipesTable.targetBuildSeconds,
      portionsPerBatch: recipesTable.portionsPerBatch,
      archivedAt: recipesTable.archivedAt,
      isDraft: recipesTable.isDraft,
    })
    .from(recipesTable);

  const plannedRows = await db
    .select({ recipeId: productionPlanItemsTable.recipeId, n: sql<number>`count(*)::int` })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .where(gte(productionPlansTable.planDate, planSince))
    .groupBy(productionPlanItemsTable.recipeId);
  const timesPlanned = new Map(plannedRows.map(r => [r.recipeId, Number(r.n)]));
  // Archived (migration 0141) and draft (0142) recipes only count while
  // they're on a plan in the window — no nagging for a build time on one we
  // don't (or don't yet) make.
  const liveRecipes = recipes.filter(r => isOnMenu(r) || timesPlanned.has(r.id));
  const timelineRecipes = liveRecipes.filter(r => isOnDayTimeline(r.category));

  // Measured build pace (services/build-time-history.ts — shared with the
  // batch-profit report so both read the floor's history the same way).
  const buildSuggestions = await loadBuildSuggestions(buildSince);

  // Raw meats the timeline depends on, from each timeline recipe's full tree.
  const usedBy = new Map<number, string[]>();
  for (const r of timelineRecipes) {
    for (const m of await rawMeatsForRecipe(r.id, r.portionsPerBatch ?? 10)) {
      const list = usedBy.get(m.rawMeatIngredientId) ?? [];
      if (!list.includes(r.name)) list.push(r.name);
      usedBy.set(m.rawMeatIngredientId, list);
    }
  }
  const meatIds = [...usedBy.keys()];
  const meatRows = meatIds.length
    ? await db
        .select({
          id: ingredientsTable.id,
          name: ingredientsTable.name,
          cook: ingredientsTable.estimatedCookTimeMin,
          process: ingredientsTable.meatProcessMinutes,
        })
        .from(ingredientsTable)
        .where(inArray(ingredientsTable.id, meatIds))
    : [];
  const ovenRows = meatIds.length
    ? await db
        .select({
          ingredientId: ovenEventsTable.ingredientId,
          ovenInAt: ovenEventsTable.ovenInAt,
          ovenOutAt: ovenEventsTable.ovenOutAt,
        })
        .from(ovenEventsTable)
        .where(and(
          inArray(ovenEventsTable.ingredientId, meatIds),
          isNotNull(ovenEventsTable.ovenOutAt),
          gte(ovenEventsTable.ovenInAt, cookSince),
        ))
    : [];
  const durationsByMeat = new Map<number, number[]>();
  for (const o of ovenRows) {
    if (o.ingredientId == null || !o.ovenOutAt) continue;
    const list = durationsByMeat.get(o.ingredientId) ?? [];
    list.push((o.ovenOutAt.getTime() - o.ovenInAt.getTime()) / 60_000);
    durationsByMeat.set(o.ingredientId, list);
  }
  const cookSuggestions = new Map(
    [...durationsByMeat]
      .map(([id, d]) => [id, suggestCookMinutes(d)] as const)
      .filter((e): e is readonly [number, NonNullable<ReturnType<typeof suggestCookMinutes>>] => e[1] != null),
  );

  const meats: HealthMeatInput[] = meatRows.map(m => ({
    ingredientId: m.id,
    name: m.name,
    cookMinutes: m.cook,
    processMinutes: m.process,
    usedBy: usedBy.get(m.id) ?? [],
  }));

  const health = assembleTimingHealth({
    recipes: liveRecipes.map(r => ({
      recipeId: r.id,
      name: r.name,
      category: r.category,
      targetBuildSeconds: r.targetBuildSeconds,
      timesPlanned: timesPlanned.get(r.id) ?? 0,
    })),
    buildSuggestions,
    meats,
    cookSuggestions,
  });

  // Dismissed / sent to someone (migration 0195). A dismissal hides a
  // "check against the floor" card while it still holds; the latest send
  // shows on the card as "Sent to <name> to review".
  const reviews = await db.select().from(timingSuggestionReviewsTable)
    .where(isNull(timingSuggestionReviewsTable.restoredAt))
    .orderBy(desc(timingSuggestionReviewsTable.createdAt), desc(timingSuggestionReviewsTable.id));
  const latest = (kind: TimingKind, id: number, action: "dismissed" | "sent") =>
    reviews.find(r => r.kind === kind && r.targetId === id && r.action === action) ?? null;
  const sentInfo = (kind: TimingKind, id: number) => {
    const r = latest(kind, id, "sent");
    return r ? { assigneeName: r.assigneeName, by: r.actorName, at: r.createdAt } : null;
  };
  const dismissed: Array<{ kind: TimingKind; targetId: number; name: string; setValue: number | null; suggestedValue: number | null; by: string | null; at: Date }> = [];
  const recipesShown = health.recipes.filter(r => {
    const d = r.kind === "check" ? latest("build", r.recipeId, "dismissed") : null;
    if (d && dismissalStillHolds("build", d, { setValue: r.currentSeconds, suggestedValue: r.suggestion?.value ?? null })) {
      dismissed.push({ kind: "build", targetId: r.recipeId, name: r.name, setValue: r.currentSeconds, suggestedValue: r.suggestion?.value ?? null, by: d.actorName, at: d.createdAt });
      return false;
    }
    return true;
  }).map(r => ({ ...r, sent: sentInfo("build", r.recipeId) }));
  const meatsShown = health.meats.filter(m => {
    const d = m.kind === "check" ? latest("cook", m.ingredientId, "dismissed") : null;
    if (d && dismissalStillHolds("cook", d, { setValue: m.cookMinutes, suggestedValue: m.cookSuggestion?.value ?? null })) {
      dismissed.push({ kind: "cook", targetId: m.ingredientId, name: m.name, setValue: m.cookMinutes, suggestedValue: m.cookSuggestion?.value ?? null, by: d.actorName, at: d.createdAt });
      return false;
    }
    return true;
  }).map(m => ({ ...m, sent: sentInfo("cook", m.ingredientId) }));

  res.json({
    buildWindowDays: BUILD_WINDOW_DAYS,
    cookWindowDays: COOK_WINDOW_DAYS,
    ...health,
    recipes: recipesShown,
    meats: meatsShown,
    dismissed,
  });
});

// ── Dismiss / restore / send to someone (Graeme, 2026-10-15) ───────────────

const targetBody = z.object({
  kind: z.enum(["build", "cook"]),
  targetId: z.number().int().positive(),
});
const dismissBody = targetBody.extend({
  setValue: z.number().int().nullable(),
  suggestedValue: z.number().int().nullable(),
});
const sendBody = dismissBody.extend({
  assigneeId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).optional(),
});

async function actorOf(req: Request): Promise<{ id: number; name: string }> {
  const id = req.session.userId!;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? "Someone" };
}

// POST /dismiss — "the set value stands". Hidden until the set value
// changes or the floor's suggestion moves well away (timing-review-rules).
router.post("/dismiss", requireManagerOrAdmin, validate(dismissBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof dismissBody>;
  const actor = await actorOf(req);
  const [row] = await db.insert(timingSuggestionReviewsTable).values({
    kind: b.kind, targetId: b.targetId, action: "dismissed",
    setValue: b.setValue, suggestedValue: b.suggestedValue,
    actorUserId: actor.id, actorName: actor.name,
  }).returning();
  res.status(201).json({ review: row });
});

// POST /restore — bring a dismissed card back.
router.post("/restore", requireManagerOrAdmin, validate(targetBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof targetBody>;
  const actor = await actorOf(req);
  const rows = await db.update(timingSuggestionReviewsTable)
    .set({ restoredAt: new Date(), restoredByName: actor.name })
    .where(and(
      eq(timingSuggestionReviewsTable.kind, b.kind),
      eq(timingSuggestionReviewsTable.targetId, b.targetId),
      eq(timingSuggestionReviewsTable.action, "dismissed"),
      isNull(timingSuggestionReviewsTable.restoredAt),
    ))
    .returning({ id: timingSuggestionReviewsTable.id });
  res.json({ restored: rows.length });
});

// POST /send — put it on someone's to-do list to review, with a bell. The
// to-do links back to the Timing data card on the Recipes page.
router.post("/send", requireManagerOrAdmin, validate(sendBody), async (req: Request, res: Response) => {
  const b = req.body as z.infer<typeof sendBody>;
  const actor = await actorOf(req);
  const [assignee] = await db.select({ id: usersTable.id, name: usersTable.name, isActive: usersTable.isActive })
    .from(usersTable).where(eq(usersTable.id, b.assigneeId));
  if (!assignee || !assignee.isActive) { res.status(404).json({ error: "That person isn't on the team any more" }); return; }
  const title = reviewTodoTitle(b.kind, b.name, b.setValue, b.suggestedValue);
  const notes = [
    b.note?.trim() || null,
    `Sent by ${actor.name}. Open the link: it's on the Timing data card on the Recipes page — use the suggested time, enter your own, or dismiss it if the set time is right.`,
  ].filter(Boolean).join("\n\n");
  const out = await db.transaction(async tx => {
    const rows = await tx.execute<{ id: number }>(sql`
      INSERT INTO todo_tasks (assignee_id, created_by, created_by_name, title, notes, url, priority)
      VALUES (${assignee.id}, ${actor.id}, ${actor.name}, ${title}, ${notes.slice(0, 5000)}, ${"/recipes#timing-data"}, 'normal')
      RETURNING id
    `);
    const todoId = Number(rows.rows[0]!.id);
    await tx.execute(sql`
      INSERT INTO todo_task_comments (task_id, user_id, user_name, kind, body)
      VALUES (${todoId}, ${actor.id}, ${actor.name}, 'event', ${"Sent from the Timing data card on Recipes"})
    `);
    const [row] = await tx.insert(timingSuggestionReviewsTable).values({
      kind: b.kind, targetId: b.targetId, action: "sent",
      setValue: b.setValue, suggestedValue: b.suggestedValue,
      assigneeId: assignee.id, assigneeName: assignee.name, todoTaskId: todoId, note: b.note?.trim() || null,
      actorUserId: actor.id, actorName: actor.name,
    }).returning();
    return { todoId, review: row };
  });
  if (assignee.id !== actor.id) {
    try {
      await db.execute(sql`
        INSERT INTO notifications (user_id, type, message, read)
        VALUES (${assignee.id}, ${"todo"}, ${`${actor.name} asked you to review: ${title}`.slice(0, 500)}, false)
      `);
    } catch (err) {
      console.warn("[timing-health] notification failed:", err instanceof Error ? err.message : err);
    }
  }
  res.status(201).json(out);
});

export default router;
