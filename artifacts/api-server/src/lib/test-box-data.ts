/**
 * Test boxes ↔ the database: which suppliers (and specialist ingredients) a
 * box's recipes depend on, its deliveries, its schedule, and keeping
 * everything that hangs off a box in step with it. The scheduling rules
 * themselves are pure and live in test-box-schedule.ts.
 *
 * syncTestBox() is the one call every change makes, inside its transaction:
 *   - the box's calendar event (marketing_events.test_box_id, type
 *     "test_box") spans VIP launch → last live delivery, with a history line
 *     for every visible change;
 *     — on the calendar it is just a phase.
 * Since 2026-10-20 it no longer plans a VIP launch email or puts tasks on
 * the owner's to-do list (the checklist lives on the box page).
 * Nothing here talks to Shopify, Zapiet or Klaviyo, and no email is sent.
 */
import {
  db, marketingEventsTable, marketingEventHistoryTable,
  testBoxesTable, testBoxRecipesTable, testBoxDeliveriesTable, testBoxTasksTable, recipesTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { describeDateChange } from "@workspace/marketing-calendar";
import { intArrayLiteral } from "./int-array-literal";
import {
  buildTestBoxSchedule, calendarSpan,
  type DeliveryStatus, type ProductionMix, type SpecialistIngredient, type TestBoxSchedule,
} from "./test-box-schedule";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;
export type TestBoxRow = typeof testBoxesTable.$inferSelect;
export type DeliveryRow = typeof testBoxDeliveriesTable.$inferSelect;
export interface Actor { id: number; name: string }

export function londonToday(): string {
  return londonDay(new Date());
}
export function londonDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/**
 * The box's NEW ("specialist") ingredients — the only ones the box asks
 * anyone to order (Graeme, 2026-10-08: "only specialist ingredients need
 * ordering"). An ingredient counts when it is:
 *
 *   1. used by one of the box's recipes — directly or through sub-recipes,
 *      however deeply nested; AND
 *   2. NOT used by any CORE-MENU recipe (recipes.is_core_menu, and not
 *      archived or a draft — a core recipe always is both, but the check is
 *      kept so an odd row can't make a new ingredient look ordinary). The
 *      box's own recipes are left out of that side: a test recipe ticked
 *      core menu would otherwise make its own new ingredient look ordinary.
 *      Core menu rather than "on the menu": the old rule counted every
 *      published recipe, so an ingredient that one special happened to
 *      share stayed off the list even though normal ordering (which follows
 *      the core plan) wouldn't cover it; AND
 *   3. NOT on a kanban (ingredients.kanban_enabled) — a kanban ingredient
 *      reorders itself whatever uses it.
 *
 * Each comes with its main supplier's lead time / order days and where to
 * order it (the ingredient's ordering link, else the supplier's website).
 */
export async function loadSpecialistIngredients(conn: Db, recipeIds: number[]): Promise<SpecialistIngredient[]> {
  if (recipeIds.length === 0) return [];
  const ids = intArrayLiteral(recipeIds);
  const rows = await conn.execute<{
    ingredient_id: number; ingredient_name: string; supplier_id: number | null; supplier_name: string | null;
    lead_time_days: number | null; cutoff_time: string | null; order_frequency: string | null; order_days: string | null;
    ordering_url: string | null;
  }>(sql`
    WITH RECURSIVE subs(sub_recipe_id) AS (
      SELECT sub_recipe_id FROM recipe_sub_recipes WHERE recipe_id = ANY(${ids}::int[])
      UNION
      SELECT ssr.component_sub_recipe_id FROM sub_recipe_sub_recipes ssr JOIN subs s ON ssr.sub_recipe_id = s.sub_recipe_id
    ),
    ings(ingredient_id) AS (
      SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = ANY(${ids}::int[])
      UNION
      SELECT ingredient_id FROM sub_recipe_ingredients WHERE sub_recipe_id IN (SELECT sub_recipe_id FROM subs)
    ),
    core_subs(sub_recipe_id) AS (
      SELECT rsr.sub_recipe_id FROM recipe_sub_recipes rsr JOIN recipes r ON r.id = rsr.recipe_id
       WHERE r.is_core_menu = TRUE AND r.archived_at IS NULL AND r.is_draft = FALSE
         AND r.id <> ALL(${ids}::int[])
      UNION
      SELECT ssr.component_sub_recipe_id FROM sub_recipe_sub_recipes ssr JOIN core_subs m ON ssr.sub_recipe_id = m.sub_recipe_id
    ),
    core_ings(ingredient_id) AS (
      SELECT ri.ingredient_id FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id
       WHERE r.is_core_menu = TRUE AND r.archived_at IS NULL AND r.is_draft = FALSE
         AND r.id <> ALL(${ids}::int[])
      UNION
      SELECT ingredient_id FROM sub_recipe_ingredients WHERE sub_recipe_id IN (SELECT sub_recipe_id FROM core_subs)
    )
    SELECT i.id AS ingredient_id, i.name AS ingredient_name, s.id AS supplier_id, s.name AS supplier_name,
           s.lead_time_days, s.cutoff_time, s.order_frequency, s.order_days,
           COALESCE(NULLIF(TRIM(i.ordering_url), ''), NULLIF(TRIM(s.website), '')) AS ordering_url
    FROM ings JOIN ingredients i ON i.id = ings.ingredient_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    WHERE COALESCE(i.kanban_enabled, FALSE) = FALSE
      AND NOT EXISTS (SELECT 1 FROM core_ings c WHERE c.ingredient_id = ings.ingredient_id)
    ORDER BY i.name
  `);
  return rows.rows.map(r => ({
    ingredientId: Number(r.ingredient_id),
    name: r.ingredient_name,
    supplierId: r.supplier_id == null ? null : Number(r.supplier_id),
    supplierName: r.supplier_name,
    leadTimeDays: r.lead_time_days == null ? null : Number(r.lead_time_days),
    cutoffTime: r.cutoff_time,
    orderFrequency: r.order_frequency,
    orderDays: r.order_days,
    orderingUrl: r.ordering_url,
  }));
}

export async function loadBoxRecipes(conn: Db, boxIds: number[]) {
  if (boxIds.length === 0) return new Map<number, Array<{ id: number; name: string; isDraft: boolean }>>();
  const rows = await conn.select({
    boxId: testBoxRecipesTable.testBoxId, id: recipesTable.id, name: recipesTable.name, isDraft: recipesTable.isDraft,
  }).from(testBoxRecipesTable)
    .innerJoin(recipesTable, eq(recipesTable.id, testBoxRecipesTable.recipeId))
    .where(inArray(testBoxRecipesTable.testBoxId, boxIds))
    .orderBy(asc(testBoxRecipesTable.position), asc(testBoxRecipesTable.id));
  const out = new Map<number, Array<{ id: number; name: string; isDraft: boolean }>>();
  for (const r of rows) {
    const list = out.get(r.boxId) ?? [];
    list.push({ id: r.id, name: r.name, isDraft: r.isDraft === true });
    out.set(r.boxId, list);
  }
  return out;
}

/** Live (not deleted) deliveries per box, earliest first. */
export async function loadBoxDeliveries(conn: Db, boxIds: number[]): Promise<Map<number, DeliveryRow[]>> {
  const out = new Map<number, DeliveryRow[]>();
  if (boxIds.length === 0) return out;
  const rows = await conn.select().from(testBoxDeliveriesTable)
    .where(and(inArray(testBoxDeliveriesTable.testBoxId, boxIds), isNull(testBoxDeliveriesTable.deletedAt)))
    .orderBy(asc(testBoxDeliveriesTable.deliveryDate), asc(testBoxDeliveriesTable.id));
  for (const r of rows) {
    const list = out.get(r.testBoxId) ?? [];
    list.push(r);
    out.set(r.testBoxId, list);
  }
  return out;
}

export async function loadDoneKeys(conn: Db, boxId: number): Promise<string[]> {
  const rows = await conn.select({ key: testBoxTasksTable.taskKey }).from(testBoxTasksTable)
    .where(and(eq(testBoxTasksTable.testBoxId, boxId), eq(testBoxTasksTable.done, true)));
  return rows.map(r => r.key);
}

export function scheduleFrom(
  box: TestBoxRow,
  recipes: Array<{ name: string }>,
  deliveries: DeliveryRow[],
  specialists: SpecialistIngredient[],
  doneKeys: string[],
): TestBoxSchedule {
  return buildTestBoxSchedule({
    boxName: box.name,
    launchDate: box.launchDate,
    publicLaunchDate: box.publicLaunchDate,
    plannedOn: londonDay(box.createdAt),
    ordersCloseDays: box.ordersCloseDays,
    bufferDays: box.bufferDays,
    bufferPct: box.bufferPct,
    recipes: recipes.map(r => r.name),
    specialists,
    deliveries: deliveries.map(d => ({
      id: d.id,
      deliveryDate: d.deliveryDate,
      expectedBoxes: d.expectedBoxes,
      status: d.status as DeliveryStatus,
      addedOn: londonDay(d.createdAt),
      closedOn: d.closedAt ? londonDay(d.closedAt) : null,
      productionMix: (d.productionMix as ProductionMix | null) ?? null,
    })),
    doneKeys,
    today: londonToday(),
  });
}

export async function scheduleForBox(conn: Db, box: TestBoxRow): Promise<TestBoxSchedule> {
  const recipes = (await loadBoxRecipes(conn, [box.id])).get(box.id) ?? [];
  const deliveries = (await loadBoxDeliveries(conn, [box.id])).get(box.id) ?? [];
  const specialists = await loadSpecialistIngredients(conn, recipes.map(r => r.id));
  return scheduleFrom(box, recipes, deliveries, specialists, await loadDoneKeys(conn, box.id));
}

/** Calendar status for a box status. A cancelled box's event comes off the calendar. */
function eventStatus(boxStatus: string): string {
  if (boxStatus === "delivered") return "done";
  if (boxStatus === "planning") return "planned";
  return "live";
}

const isLive = (box: TestBoxRow) => box.deletedAt == null && box.status !== "cancelled";

/**
 * Create or move the box's calendar event so it spans VIP launch → last
 * live delivery. Writes a history line for every visible change, attributed
 * to the person who changed the box.
 */
export async function syncTestBoxEvent(tx: Tx, box: TestBoxRow, schedule: TestBoxSchedule, user: Actor): Promise<number | null> {
  const title = `Test box: ${box.name}`;
  const { startDate, endDate } = calendarSpan(schedule);
  const audience = schedule.publicLaunchDate ? "VIPs first, then everyone" : "VIP Calzoney Club";
  const wantLive = isLive(box);
  const [existing] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.testBoxId, box.id));

  if (!existing) {
    if (!wantLive) return null;
    const [created] = await tx.insert(marketingEventsTable).values({
      name: title, startDate, endDate, eventType: "test_box", status: eventStatus(box.status),
      audience, source: "manual", testBoxId: box.id,
      createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    }).returning();
    await tx.insert(marketingEventHistoryTable).values({
      eventId: created.id, userId: user.id, userName: user.name, action: "created", summary: "added this test box",
    });
    return created.id;
  }

  const lines: Array<{ action: "edited" | "moved" | "resized" | "deleted"; summary: string }> = [];
  const dateChange = describeDateChange(existing, { startDate, endDate });
  if (dateChange) lines.push({ action: dateChange.action, summary: `${dateChange.summary} (test box dates changed)` });
  if (existing.name !== title) lines.push({ action: "edited", summary: `renamed it to “${title}”` });
  const status = eventStatus(box.status);
  if (wantLive && existing.status !== status) lines.push({ action: "edited", summary: `changed the status to ${status}` });
  if (!wantLive && existing.deletedAt == null) lines.push({ action: "deleted", summary: box.deletedAt ? "deleted this (test box removed)" : "took this off the calendar (test box cancelled)" });
  if (wantLive && existing.deletedAt != null) lines.push({ action: "edited", summary: "put this back on the calendar (test box reinstated)" });
  if (lines.length === 0 && existing.audience === audience) return existing.id;

  await tx.update(marketingEventsTable).set({
    name: title, startDate, endDate, status: wantLive ? status : existing.status, audience,
    deletedAt: wantLive ? null : (existing.deletedAt ?? new Date()),
    deletedById: wantLive ? null : (existing.deletedById ?? user.id),
    deletedByName: wantLive ? null : (existing.deletedByName ?? user.name),
    updatedById: user.id, updatedByName: user.name, updatedAt: new Date(),
  }).where(eq(marketingEventsTable.id, existing.id));
  for (const l of lines) {
    await tx.insert(marketingEventHistoryTable).values({
      eventId: existing.id, userId: user.id, userName: user.name, action: l.action, summary: l.summary,
    });
  }
  return existing.id;
}

/**
 * Bring what hangs off a box in step with it: its phase on the marketing
 * calendar. Call inside the transaction that changed the box (or its
 * deliveries / ticks).
 *
 * Since 2026-10-20 (Graeme) a box no longer plans a VIP launch email (emails
 * are built in Klaviyo only) or puts its tasks on the owner's to-do list.
 * Launch emails and to-dos made before then are left untouched.
 */
export async function syncTestBox(tx: Tx, boxId: number, user: Actor): Promise<TestBoxSchedule | null> {
  const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, boxId));
  if (!box) return null;
  const recipes = (await loadBoxRecipes(tx, [box.id])).get(box.id) ?? [];
  const deliveries = (await loadBoxDeliveries(tx, [box.id])).get(box.id) ?? [];
  const specialists = await loadSpecialistIngredients(tx, recipes.map(r => r.id));
  const schedule = scheduleFrom(box, recipes, deliveries, specialists, await loadDoneKeys(tx, box.id));
  await syncTestBoxEvent(tx, box, schedule, user);
  return schedule;
}
