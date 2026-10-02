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
 *   - ONE planned VIP launch email (marketing_emails, stage Planned) and ONE
 *     (no social-post note any more — it is a launch-checklist to-do), remembered on the box so a re-save
 *     never duplicates them, and moved with the launch while still only a
 *     plan (an email linked to Klaviyo or past Planned is left alone);
 *   - every task as a to-do on the owner's list (test-box-todos.ts).
 * Nothing here talks to Shopify, Zapiet or Klaviyo, and no email is sent.
 */
import {
  db, marketingEventsTable, marketingEventHistoryTable, marketingEmailsTable, marketingEmailHistoryTable,
  testBoxesTable, testBoxRecipesTable, testBoxDeliveriesTable, testBoxTasksTable, recipesTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { describeDateChange, describeEmailMove } from "@workspace/marketing-calendar";
import { intArrayLiteral } from "./int-array-literal";
import {
  buildTestBoxSchedule, calendarMilestones, calendarSpan,
  type DeliveryStatus, type ProductionMix, type SupplierLead, type TestBoxSchedule,
} from "./test-box-schedule";
import { syncTestBoxTodos } from "./test-box-todos";

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
 * Every ingredient the recipes use — directly and through sub-recipes, however
 * deeply nested — grouped by its main supplier, split into normal and
 * SPECIALIST (not used by any recipe on the menu: not archived, not a draft —
 * same rule as isOnMenu in recipe-archive-rules.ts — OTHER than the box's own
 * recipes: a test recipe on the menu would otherwise make its own new
 * ingredient look ordinary. Fixed 2026-10-02 on the Properoni box, whose
 * Hot Paprika Crumble is used by nothing else). Ingredients with no
 * supplier come back as one group with supplierId null.
 */
export async function loadSupplierLeads(conn: Db, recipeIds: number[]): Promise<SupplierLead[]> {
  if (recipeIds.length === 0) return [];
  const ids = intArrayLiteral(recipeIds);
  const rows = await conn.execute<{
    ingredient_name: string; supplier_id: number | null; supplier_name: string | null;
    lead_time_days: number | null; cutoff_time: string | null; order_frequency: string | null; order_days: string | null;
    specialist: boolean;
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
    menu_subs(sub_recipe_id) AS (
      SELECT rsr.sub_recipe_id FROM recipe_sub_recipes rsr JOIN recipes r ON r.id = rsr.recipe_id
       WHERE r.archived_at IS NULL AND r.is_draft = FALSE
         AND r.id <> ALL(${ids}::int[])
      UNION
      SELECT ssr.component_sub_recipe_id FROM sub_recipe_sub_recipes ssr JOIN menu_subs m ON ssr.sub_recipe_id = m.sub_recipe_id
    ),
    menu_ings(ingredient_id) AS (
      SELECT ri.ingredient_id FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id
       WHERE r.archived_at IS NULL AND r.is_draft = FALSE
         AND r.id <> ALL(${ids}::int[])
      UNION
      SELECT ingredient_id FROM sub_recipe_ingredients WHERE sub_recipe_id IN (SELECT sub_recipe_id FROM menu_subs)
    )
    SELECT i.name AS ingredient_name, s.id AS supplier_id, s.name AS supplier_name,
           s.lead_time_days, s.cutoff_time, s.order_frequency, s.order_days,
           NOT EXISTS (SELECT 1 FROM menu_ings mi WHERE mi.ingredient_id = ings.ingredient_id) AS specialist
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
        ? { supplierId: null, name: "No supplier set", leadTimeDays: null, cutoffTime: null, orderFrequency: null, orderDays: null, items: [], specialistItems: [] }
        : {
          supplierId: Number(r.supplier_id), name: r.supplier_name ?? "Supplier",
          leadTimeDays: r.lead_time_days == null ? null : Number(r.lead_time_days),
          cutoffTime: r.cutoff_time, orderFrequency: r.order_frequency, orderDays: r.order_days, items: [], specialistItems: [],
        };
      groups.set(key, g);
    }
    const list = r.specialist ? g.specialistItems : g.items;
    if (!list.includes(r.ingredient_name)) list.push(r.ingredient_name);
  }
  return [...groups.values()];
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
  suppliers: SupplierLead[],
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
    suppliers,
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
  const suppliers = await loadSupplierLeads(conn, recipes.map(r => r.id));
  return scheduleFrom(box, recipes, deliveries, suppliers, await loadDoneKeys(conn, box.id));
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

export const launchEmailSubject = (boxName: string) => `${boxName} — VIP launch`;

/**
 * The box's ONE planned VIP launch email, on the launch day (the social
 * post is a to-do on the launch checklist, not a separate note). Created once (ids remembered on the box); afterwards only moved
 * / renamed while still the box's own plan. A person deleting either is
 * respected — it isn't recreated. A removed or cancelled box takes them off
 * (soft) while they're still unsent plans.
 */
export async function syncLaunchMarketing(tx: Tx, box: TestBoxRow, user: Actor): Promise<void> {
  const live = isLive(box);
  const subject = launchEmailSubject(box.name);
  const patch: Partial<Pick<TestBoxRow, "launchEmailId" | "socialNoteEventId">> = {};

  // ── The email ──
  const [email] = box.launchEmailId != null
    ? await tx.select().from(marketingEmailsTable).where(eq(marketingEmailsTable.id, box.launchEmailId))
    : [];
  const stillOurPlan = email && email.deletedAt == null && email.status === "planned" && email.klaviyoCampaignId == null;
  if (!email && box.launchEmailId == null && live) {
    const [created] = await tx.insert(marketingEmailsTable).values({
      sendDate: box.launchDate, subject, audiences: ["vip"], status: "planned",
      coreMessage: `Launch of the ${box.name} to VIP Calzoney Club members — they get it first, for at least 48 hours.`,
      notes: `Planned by the test box “${box.name}” (/test-boxes/${box.id}). Nothing is sent from here: write it in Klaviyo and link it.`,
      createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name,
    }).returning();
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: created.id, userId: user.id, userName: user.name, action: "created",
      summary: `added this (VIP launch email for the test box “${box.name}”)`,
    });
    patch.launchEmailId = created.id;
  } else if (stillOurPlan && live) {
    const set: Partial<typeof marketingEmailsTable.$inferInsert> = {};
    const lines: string[] = [];
    if (email.sendDate !== box.launchDate) {
      set.sendDate = box.launchDate;
      lines.push(describeEmailMove(email.sendDate, box.launchDate, null, null) ?? "moved it");
    }
    if (email.subject !== subject && / — VIP launch$/.test(email.subject)) {
      set.subject = subject;
      lines.push(`changed the subject line to “${subject}”`);
    }
    if (lines.length) {
      await tx.update(marketingEmailsTable).set({ ...set, updatedById: user.id, updatedByName: user.name, updatedAt: new Date() })
        .where(eq(marketingEmailsTable.id, email.id));
      await tx.insert(marketingEmailHistoryTable).values({
        emailId: email.id, userId: user.id, userName: user.name, action: set.sendDate ? "moved" : "edited",
        summary: `${lines.join(" and ")} (test box launch changed)`,
      });
    }
  } else if (stillOurPlan && !live) {
    await tx.update(marketingEmailsTable).set({ deletedAt: new Date(), deletedById: user.id, deletedByName: user.name, updatedAt: new Date() })
      .where(eq(marketingEmailsTable.id, email.id));
    await tx.insert(marketingEmailHistoryTable).values({
      emailId: email.id, userId: user.id, userName: user.name, action: "deleted",
      summary: box.deletedAt ? "deleted this (test box removed)" : "deleted this (test box cancelled)",
    });
  }

  // ── The social-post note ── no longer made (Graeme, 2026-10-02): the
  // launch checklist's "Post on social media" to-do already shows on the
  // calendar, so a note too was a duplicate. Any note made before is taken
  // off (soft) the next time the box is saved.
  const [note] = box.socialNoteEventId != null
    ? await tx.select().from(marketingEventsTable).where(eq(marketingEventsTable.id, box.socialNoteEventId))
    : [];
  if (note && note.deletedAt == null) {
    await tx.update(marketingEventsTable).set({ deletedAt: new Date(), deletedById: user.id, deletedByName: user.name, updatedAt: new Date() })
      .where(eq(marketingEventsTable.id, note.id));
    await tx.insert(marketingEventHistoryTable).values({
      eventId: note.id, userId: user.id, userName: user.name, action: "deleted",
      summary: "took this off the calendar (the box's 'Post on social media' to-do replaces it)",
    });
  }

  if (Object.keys(patch).length) await tx.update(testBoxesTable).set(patch).where(eq(testBoxesTable.id, box.id));
}

/**
 * Bring everything hanging off a box in step with it: calendar bar, launch
 * email + social note, and the owner's to-dos. Call inside the transaction
 * that changed the box (or its deliveries / ticks).
 */
export async function syncTestBox(tx: Tx, boxId: number, user: Actor): Promise<TestBoxSchedule | null> {
  const [box] = await tx.select().from(testBoxesTable).where(eq(testBoxesTable.id, boxId));
  if (!box) return null;
  const recipes = (await loadBoxRecipes(tx, [box.id])).get(box.id) ?? [];
  const deliveries = (await loadBoxDeliveries(tx, [box.id])).get(box.id) ?? [];
  const suppliers = await loadSupplierLeads(tx, recipes.map(r => r.id));
  const schedule = scheduleFrom(box, recipes, deliveries, suppliers, await loadDoneKeys(tx, box.id));
  await syncTestBoxEvent(tx, box, schedule, user);
  await syncLaunchMarketing(tx, box, user);
  await syncTestBoxTodos(tx, box, schedule, deliveries, user, isLive(box));
  return schedule;
}

/** Calendar extras for test-box events: name, launch, last delivery and milestones. */
export async function testBoxCalendarInfo(boxIds: number[]) {
  const out = new Map<number, { id: number; name: string; launchDate: string; vipWindowEnds: string; lastDeliveryDate: string | null; milestones: ReturnType<typeof calendarMilestones> }>();
  if (boxIds.length === 0) return out;
  const boxes = await db.select().from(testBoxesTable).where(and(inArray(testBoxesTable.id, boxIds), isNull(testBoxesTable.deletedAt)));
  for (const b of boxes) {
    const schedule = await scheduleForBox(db, b);
    const live = schedule.deliveries.filter(d => d.status !== "cancelled");
    out.set(b.id, {
      id: b.id, name: b.name, launchDate: b.launchDate, vipWindowEnds: schedule.vipWindowEnds,
      lastDeliveryDate: live.length ? live[live.length - 1].deliveryDate : null,
      milestones: calendarMilestones(schedule),
    });
  }
  return out;
}
