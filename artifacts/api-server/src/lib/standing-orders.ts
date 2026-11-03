/**
 * Standing weekly orders on the Orders page (Fix queue #348, Graeme 3 Nov
 * 2026): "it automatically gets put into the order list for us to then
 * choose to order it or not (but we don't have to remember it)".
 *
 * On a chosen weekday /orders/calculate puts the item on its supplier's
 * card with the fixed packs ("Every Fri"), whatever the stock — like a
 * pulled kanban. Placing an order with it on marks it 'ordered' for the
 * day; "Not today" marks it 'skipped'. Either way it doesn't come back
 * until the next chosen weekday. The rules are the pure helpers in
 * @workspace/business-days (standing-order.ts); this file is only the
 * database half. Objective C.
 */
import { db, ingredientsTable, standingOrderMarksTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, gt } from "drizzle-orm";
import {
  dueStandingOrders,
  isStandingOrderDay,
  standingOrderFrom,
  standingOrderLabel,
  type StandingOrderMark,
} from "@workspace/business-days";
import { londonDateString } from "./london-time";

export interface DueStandingOrder {
  ingredientId: number;
  /** The ingredient's own supplier — where the line goes when it isn't
   *  already on a card. */
  supplierId: number | null;
  packs: number;
  label: string;
}

async function marksFor(date: string, ingredientIds?: number[]): Promise<Map<number, StandingOrderMark>> {
  if (ingredientIds && ingredientIds.length === 0) return new Map();
  const rows = await db
    .select({ ingredientId: standingOrderMarksTable.ingredientId, mark: standingOrderMarksTable.mark })
    .from(standingOrderMarksTable)
    .where(ingredientIds
      ? and(eq(standingOrderMarksTable.orderDate, date), inArray(standingOrderMarksTable.ingredientId, ingredientIds))
      : eq(standingOrderMarksTable.orderDate, date));
  return new Map(rows.map(r => [r.ingredientId, r.mark as StandingOrderMark]));
}

/** Standing orders still to deal with today (London day). */
export async function loadDueStandingOrders(today: string = londonDateString()): Promise<DueStandingOrder[]> {
  const rows = await db
    .select({
      ingredientId: ingredientsTable.id,
      supplierId: ingredientsTable.supplierId,
      standingOrderWeekdays: ingredientsTable.standingOrderWeekdays,
      standingOrderPacks: ingredientsTable.standingOrderPacks,
    })
    .from(ingredientsTable)
    .where(and(isNotNull(ingredientsTable.standingOrderWeekdays), gt(ingredientsTable.standingOrderPacks, 0)));
  if (rows.length === 0) return [];
  const due = dueStandingOrders(rows, today, await marksFor(today));
  return due.map(r => ({
    ingredientId: r.ingredientId,
    supplierId: r.supplierId,
    packs: r.standing.packs,
    label: standingOrderLabel(r.standing.weekdays),
  }));
}

/**
 * A purchase order was placed (or re-submitted) today: any of its
 * ingredients with a standing order for today is now ordered. From any
 * supplier — if the fruit went on a different supplier's order today it's
 * still been ordered.
 */
export async function markStandingOrdered(poId: number, ingredientIds: number[], today: string = londonDateString()): Promise<void> {
  if (ingredientIds.length === 0) return;
  const rows = await db
    .select({
      ingredientId: ingredientsTable.id,
      standingOrderWeekdays: ingredientsTable.standingOrderWeekdays,
      standingOrderPacks: ingredientsTable.standingOrderPacks,
    })
    .from(ingredientsTable)
    .where(and(inArray(ingredientsTable.id, ingredientIds), isNotNull(ingredientsTable.standingOrderWeekdays)));
  const dueToday = rows.filter(r => isStandingOrderDay(standingOrderFrom(r), today)).map(r => r.ingredientId);
  if (dueToday.length === 0) return;
  await db.insert(standingOrderMarksTable)
    .values(dueToday.map(ingredientId => ({ orderDate: today, ingredientId, mark: "ordered", poId })))
    .onConflictDoUpdate({
      target: [standingOrderMarksTable.orderDate, standingOrderMarksTable.ingredientId],
      set: { mark: "ordered", poId, markedAt: new Date() },
    });
}

/** "Not today": off the Orders page until the next chosen weekday. */
export async function markStandingSkipped(
  ingredientId: number,
  by: { userId: number | null; name: string | null },
  today: string = londonDateString(),
): Promise<void> {
  await db.insert(standingOrderMarksTable)
    .values({ orderDate: today, ingredientId, mark: "skipped", markedByUserId: by.userId, markedByName: by.name })
    .onConflictDoNothing();
}
