/**
 * Test boxes ↔ the database: which suppliers a box's recipes depend on, the
 * box's schedule, and keeping its marketing-calendar event in step. The
 * scheduling rules themselves are pure and live in test-box-schedule.ts.
 *
 * The calendar event: one per box (marketing_events.test_box_id), type
 * "test_box", spanning the selling window to delivery. Whenever the box's
 * dates, name or status change, syncTestBoxEvent moves it and writes a
 * history line saying so — the calendar never drifts from the box.
 */
import { db, marketingEventsTable, marketingEventHistoryTable, testBoxesTable, testBoxRecipesTable, recipesTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { describeDateChange } from "@workspace/marketing-calendar";
import { intArrayLiteral } from "./int-array-literal";
import { buildTestBoxSchedule, calendarMilestones, type Audience, type SupplierLead, type TestBoxSchedule } from "./test-box-schedule";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;
type TestBoxRow = typeof testBoxesTable.$inferSelect;

export function londonToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}

/**
 * Every ingredient the recipes use — directly and through sub-recipes, however
 * deeply nested — grouped by its main supplier. Ingredients with no supplier
 * come back as one group with supplierId null.
 */
export async function loadSupplierLeads(conn: Db, recipeIds: number[]): Promise<SupplierLead[]> {
  if (recipeIds.length === 0) return [];
  const ids = intArrayLiteral(recipeIds);
  const rows = await conn.execute<{
    ingredient_name: string; supplier_id: number | null; supplier_name: string | null;
    lead_time_days: number | null; cutoff_time: string | null; order_frequency: string | null; order_days: string | null;
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
    )
    SELECT i.name AS ingredient_name, s.id AS supplier_id, s.name AS supplier_name,
           s.lead_time_days, s.cutoff_time, s.order_frequency, s.order_days
    FROM ings JOIN ingredients i ON i.id = ings.ingredient_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
    ORDER BY s.name NULLS LAST, i.name
  `);
  const groups = new Map<string, SupplierLead>();
  for (const r of rows.rows) {
    const key = r.supplier_id == null ? "none" : String(r.supplier_id);
    let g = groups.get(key);
    if (!g) {
      g = r.supplier_id == null
        ? { supplierId: null, name: "No supplier set", leadTimeDays: null, cutoffTime: null, orderFrequency: null, orderDays: null, items: [] }
        : {
          supplierId: Number(r.supplier_id), name: r.supplier_name ?? "Supplier",
          leadTimeDays: r.lead_time_days == null ? null : Number(r.lead_time_days),
          cutoffTime: r.cutoff_time, orderFrequency: r.order_frequency, orderDays: r.order_days, items: [],
        };
      groups.set(key, g);
    }
    if (!g.items.includes(r.ingredient_name)) g.items.push(r.ingredient_name);
  }
  return [...groups.values()];
}

export async function loadBoxRecipes(conn: Db, boxIds: number[]) {
  if (boxIds.length === 0) return new Map<number, Array<{ id: number; name: string }>>();
  const rows = await conn.select({
    boxId: testBoxRecipesTable.testBoxId, id: recipesTable.id, name: recipesTable.name,
  }).from(testBoxRecipesTable)
    .innerJoin(recipesTable, eq(recipesTable.id, testBoxRecipesTable.recipeId))
    .where(inArray(testBoxRecipesTable.testBoxId, boxIds))
    .orderBy(asc(testBoxRecipesTable.position), asc(testBoxRecipesTable.id));
  const out = new Map<number, Array<{ id: number; name: string }>>();
  for (const r of rows) {
    const list = out.get(r.boxId) ?? [];
    list.push({ id: r.id, name: r.name });
    out.set(r.boxId, list);
  }
  return out;
}

export async function scheduleForBox(conn: Db, box: TestBoxRow, recipes: Array<{ id: number; name: string }>): Promise<TestBoxSchedule> {
  const suppliers = await loadSupplierLeads(conn, recipes.map(r => r.id));
  return buildTestBoxSchedule({
    deliveryDate: box.deliveryDate,
    audience: box.audience as Audience,
    sellingDays: box.sellingDays,
    ordersCloseDays: box.ordersCloseDays,
    bufferDays: box.bufferDays,
    vipHeadStartDays: box.vipHeadStartDays,
    bufferPct: box.bufferPct,
    expectedBoxes: box.expectedBoxes,
    recipes: recipes.map(r => r.name),
    suppliers,
    today: londonToday(),
  });
}

/** Calendar status for a box status. A cancelled box's event comes off the calendar. */
function eventStatus(boxStatus: string): string {
  if (boxStatus === "delivered") return "done";
  if (boxStatus === "planning") return "planned";
  return "live";
}

/**
 * Create or move the box's calendar event so it spans selling start →
 * delivery. Writes a history line for every visible change, attributed to
 * the person who changed the box.
 */
export async function syncTestBoxEvent(
  tx: Tx,
  box: TestBoxRow,
  schedule: TestBoxSchedule,
  user: { id: number; name: string },
): Promise<number | null> {
  const title = `Test box: ${box.name}`;
  const startDate = schedule.sellingStart;
  const endDate = schedule.deliveryDate;
  const wantLive = box.deletedAt == null && box.status !== "cancelled";
  const [existing] = await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.testBoxId, box.id));

  if (!existing) {
    if (!wantLive) return null;
    const [created] = await tx.insert(marketingEventsTable).values({
      name: title, startDate, endDate, eventType: "test_box", status: eventStatus(box.status),
      audience: audienceLabel(box.audience),
      source: "manual", testBoxId: box.id,
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
  if (lines.length === 0) return existing.id;

  await tx.update(marketingEventsTable).set({
    name: title, startDate, endDate, status: wantLive ? status : existing.status,
    audience: audienceLabel(box.audience),
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

export function audienceLabel(a: string): string {
  if (a === "vip") return "VIPs only";
  if (a === "public") return "Everyone";
  return "VIPs first, then everyone";
}

/** Calendar extras for test-box events: the box's name, delivery date and milestones. */
export async function testBoxCalendarInfo(boxIds: number[]) {
  const out = new Map<number, { id: number; name: string; deliveryDate: string; milestones: ReturnType<typeof calendarMilestones> }>();
  if (boxIds.length === 0) return out;
  const boxes = await db.select().from(testBoxesTable).where(and(inArray(testBoxesTable.id, boxIds), isNull(testBoxesTable.deletedAt)));
  const recipes = await loadBoxRecipes(db, boxes.map(b => b.id));
  for (const b of boxes) {
    const schedule = await scheduleForBox(db, b, recipes.get(b.id) ?? []);
    out.set(b.id, { id: b.id, name: b.name, deliveryDate: b.deliveryDate, milestones: calendarMilestones(schedule) });
  }
  return out;
}
