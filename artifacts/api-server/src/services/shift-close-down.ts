/**
 * "Close down the packing and wrapping shift" — the data side (Graeme,
 * 24 Nov 2026; rules in lib/shift-close-down.ts, table migration 0395).
 *
 * The day key is the London calendar day: the day the Packer and Wrapper
 * shifts are on, the packing station's plan date, and the day the room run
 * rate is stored under. Only today can be closed down or reopened.
 *
 * "Everything packed" = dispatch-progress for the next day's delivery tag
 * shows every order fulfilled (the packing station's "All dispatched!").
 * "Everything wrapped" = every main-kitchen, non-prep-only recipe on the
 * day's plan is marked wrapping complete (the wrapping station's "All
 * wrapped"). "Checks actioned" = findMissingChecklistItems has nothing left
 * for packing or wrapping (ticked, or "can't do" with a reason).
 */
import { db, productionPlansTable, productionPlanItemsTable, recipesTable } from "@workspace/db";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { mainKitchenItems } from "@workspace/production-schedule";
import { dispatchProgressForTag } from "./dispatch-progress";
import { findMissingChecklistItems } from "../routes/checklists";
import { addDaysIso } from "../lib/team-efficiency-labour";
import { CLOSE_DOWN_STATIONS, closeDownOutstanding, recipesStillToWrap } from "../lib/shift-close-down";

export interface CloseDownRecord {
  /** UTC instant, ISO with Z — for the screen. */
  closedAt: string;
  /** London local "YYYY-MM-DDTHH:mm:ss" — what the hours are capped at. */
  closedAtLocal: string;
  closedByName: string | null;
}

export interface CloseDownStatus {
  date: string;
  closedDown: CloseDownRecord | null;
  /** Plain-words list of what's still to do; empty = can close down. */
  outstanding: string[];
  canClose: boolean;
}

/** Close-down records in [from, to], by day. */
export async function loadCloseDowns(from: string, to: string): Promise<Map<string, CloseDownRecord>> {
  const r = await db.execute<{ d: string; utc: string; local: string; by: string | null }>(sql`
    SELECT date::text AS d,
           to_char(closed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS utc,
           to_char((closed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD"T"HH24:MI:SS') AS local,
           closed_by_name AS by
    FROM shift_close_downs WHERE date BETWEEN ${from} AND ${to}
  `);
  return new Map(r.rows.map(x => [x.d, { closedAt: x.utc, closedAtLocal: x.local, closedByName: x.by }]));
}

/** Day → London local close-down time, for the room run rate. A failed read
 *  (e.g. the table isn't there yet) is logged and the KPI counts whole
 *  shifts, exactly as it did before this feature. */
export async function closeDownTimesForKpi(from: string, to: string): Promise<Map<string, string>> {
  try {
    const m = await loadCloseDowns(from, to);
    return new Map([...m].map(([d, v]) => [d, v.closedAtLocal]));
  } catch (err) {
    console.warn("[shift-close-down] couldn't read close-downs, counting whole shifts:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

/** Main-kitchen, non-prep-only recipes on the day's plan(s) — the wrapping
 *  station's list — with their wrapping-complete flag. */
async function wrappingItems(day: string): Promise<Array<{ wrappingComplete: boolean }>> {
  const rows = await db
    .select({
      wrappingComplete: productionPlanItemsTable.wrappingComplete,
      recipeCategory: recipesTable.category,
      prepOnly: recipesTable.prepOnly,
    })
    .from(productionPlanItemsTable)
    .innerJoin(productionPlansTable, eq(productionPlansTable.id, productionPlanItemsTable.planId))
    .innerJoin(recipesTable, eq(recipesTable.id, productionPlanItemsTable.recipeId))
    .where(and(gte(productionPlansTable.planDate, day), lte(productionPlansTable.planDate, day)));
  return mainKitchenItems(rows).filter(r => !r.prepOnly);
}

/** What's still to do before the day's shift can be closed down. */
export async function closeDownOutstandingFor(day: string): Promise<string[]> {
  const [ordersToPack, items, ...missing] = await Promise.all([
    // Orders packed today are tagged with tomorrow's delivery date — the
    // packing station's own rule (plan date + 1).
    dispatchProgressForTag(addDaysIso(day, 1))
      .then(p => Math.max(0, p.totalOrders - p.totalFulfilled))
      .catch(err => {
        console.warn(`[shift-close-down] ${day}: couldn't read dispatch progress:`, err instanceof Error ? err.message : err);
        return null;
      }),
    wrappingItems(day),
    ...CLOSE_DOWN_STATIONS.map(s => findMissingChecklistItems(day, day, s)),
  ]);
  return closeDownOutstanding({
    ordersToPack,
    recipesToWrap: recipesStillToWrap(items),
    missingChecks: missing.flat().filter(m => m.planDate === day),
  });
}

export async function closeDownStatus(day: string): Promise<CloseDownStatus> {
  const closedDown = (await loadCloseDowns(day, day)).get(day) ?? null;
  // Once closed, the list isn't worked out (it would cost a Shopify read on
  // every poll for nothing the screen shows).
  const outstanding = closedDown ? [] : await closeDownOutstandingFor(day);
  return { date: day, closedDown, outstanding, canClose: !closedDown && outstanding.length === 0 };
}

/** Close the day down now. false = it already was. */
export async function closeDown(day: string, user: { id: number; name: string }): Promise<boolean> {
  return db.transaction(async tx => {
    const r = await tx.execute<{ closed_at: string }>(sql`
      INSERT INTO shift_close_downs (date, closed_at, closed_by, closed_by_name)
      VALUES (${day}, NOW() AT TIME ZONE 'UTC', ${user.id}, ${user.name})
      ON CONFLICT (date) DO NOTHING
      RETURNING closed_at::text
    `);
    if (r.rows.length === 0) return false;
    await tx.execute(sql`
      INSERT INTO shift_close_down_events (date, action, closed_at, user_id, user_name)
      VALUES (${day}, 'close', ${r.rows[0]!.closed_at}::timestamp, ${user.id}, ${user.name})
    `);
    return true;
  });
}

/** Undo a close-down (pressed by mistake). false = it wasn't closed down. */
export async function reopen(day: string, user: { id: number; name: string }): Promise<boolean> {
  return db.transaction(async tx => {
    const r = await tx.execute<{ closed_at: string }>(sql`
      DELETE FROM shift_close_downs WHERE date = ${day} RETURNING closed_at::text
    `);
    if (r.rows.length === 0) return false;
    await tx.execute(sql`
      INSERT INTO shift_close_down_events (date, action, closed_at, user_id, user_name)
      VALUES (${day}, 'reopen', ${r.rows[0]!.closed_at}::timestamp, ${user.id}, ${user.name})
    `);
    return true;
  });
}
