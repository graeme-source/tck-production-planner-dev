/**
 * "Split with another supplier" — the database side (fix-queue #248 + #328).
 * The rules (which day, how many packs) are pure, in @workspace/business-days
 * order-split.ts; this file reads and writes order_line_splits for the
 * /order-splits routes and for /orders/calculate and /place.
 */
import { db, orderLineSplitsTable, purchaseOrdersTable, suppliersTable, ingredientsTable } from "@workspace/db";
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nextSplitOrderDate, splitFromLabel } from "@workspace/business-days";
import { londonDateString } from "./london-time";

/** London dates on which the supplier has had an order placed, from today on
 *  (the days a split can no longer land on). */
async function placedOrderDatesFrom(supplierId: number, todayIso: string): Promise<Set<string>> {
  const rows = await db.execute(sql`
    SELECT DISTINCT to_char((placed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS d
    FROM purchase_orders
    WHERE supplier_id = ${supplierId}
      AND status IN ('placed', 'received')
      AND placed_at IS NOT NULL
      AND placed_at >= ${todayIso}::date - INTERVAL '1 day'
  `);
  return new Set((rows.rows as Array<{ d: string }>).map(r => r.d));
}

/** The day a split to this supplier would land on, or null (unknown
 *  supplier / no reachable order day). */
export async function splitTargetDate(targetSupplierId: number, todayIso = londonDateString()): Promise<{ date: string | null; supplierName: string | null }> {
  const [s] = await db
    .select({ name: suppliersTable.name, orderFrequency: suppliersTable.orderFrequency, orderDays: suppliersTable.orderDays })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, targetSupplierId));
  if (!s) return { date: null, supplierName: null };
  const placed = await placedOrderDatesFrom(targetSupplierId, todayIso);
  return { date: nextSplitOrderDate({ todayIso, supplier: s, placedOrderDates: placed }), supplierName: s.name };
}

export interface SplitView {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  packs: number;
  fromSupplierId: number;
  fromSupplierName: string | null;
  fromPlanId: number | null;
  fromOrderDate: string;
  targetSupplierId: number;
  targetSupplierName: string | null;
  targetOrderDate: string;
  status: string;
  purchaseOrderId: number | null;
  /** "Split from Express Food Service, Mon" */
  label: string;
}

const fromSupplier = alias(suppliersTable, "split_from_supplier");
const toSupplier = alias(suppliersTable, "split_to_supplier");

/** Splits with names, filtered. */
export async function listSplits(filter: { status?: string; fromPlanId?: number; dueBy?: string; ids?: number[] }): Promise<SplitView[]> {
  const conds = [];
  if (filter.status) conds.push(eq(orderLineSplitsTable.status, filter.status));
  if (filter.fromPlanId != null) conds.push(eq(orderLineSplitsTable.fromPlanId, filter.fromPlanId));
  if (filter.dueBy) conds.push(lte(orderLineSplitsTable.targetOrderDate, filter.dueBy));
  if (filter.ids) conds.push(inArray(orderLineSplitsTable.id, filter.ids.length ? filter.ids : [-1]));
  const rows = await db
    .select({
      id: orderLineSplitsTable.id,
      ingredientId: orderLineSplitsTable.ingredientId,
      ingredientName: ingredientsTable.name,
      packs: orderLineSplitsTable.packs,
      fromSupplierId: orderLineSplitsTable.fromSupplierId,
      fromSupplierName: fromSupplier.name,
      fromPlanId: orderLineSplitsTable.fromPlanId,
      fromOrderDate: orderLineSplitsTable.fromOrderDate,
      targetSupplierId: orderLineSplitsTable.targetSupplierId,
      targetSupplierName: toSupplier.name,
      targetOrderDate: orderLineSplitsTable.targetOrderDate,
      status: orderLineSplitsTable.status,
      purchaseOrderId: orderLineSplitsTable.purchaseOrderId,
    })
    .from(orderLineSplitsTable)
    .leftJoin(ingredientsTable, eq(ingredientsTable.id, orderLineSplitsTable.ingredientId))
    .leftJoin(fromSupplier, eq(fromSupplier.id, orderLineSplitsTable.fromSupplierId))
    .leftJoin(toSupplier, eq(toSupplier.id, orderLineSplitsTable.targetSupplierId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(orderLineSplitsTable.targetOrderDate, orderLineSplitsTable.id);
  return rows.map(r => ({
    ...r,
    packs: Number(r.packs),
    fromOrderDate: String(r.fromOrderDate),
    targetOrderDate: String(r.targetOrderDate),
    label: splitFromLabel(r.fromSupplierName ?? `Supplier #${r.fromSupplierId}`, String(r.fromOrderDate)),
  }));
}

/** What /orders/calculate needs for one plan today: packs split AWAY from
 *  each (supplier, ingredient) line of this plan (pending or placed — the
 *  source order keeps only the rest), and splits due IN today or earlier
 *  that haven't been placed yet. */
export async function splitsForCalculate(planId: number, todayIso = londonDateString()): Promise<{
  away: Map<string, SplitView[]>;
  incoming: SplitView[];
}> {
  const fromPlan = await listSplits({ fromPlanId: planId });
  const away = new Map<string, SplitView[]>();
  for (const s of fromPlan) {
    if (s.status === "cancelled") continue;
    const key = `${s.fromSupplierId}:${s.ingredientId}`;
    (away.get(key) ?? away.set(key, []).get(key)!).push(s);
  }
  const incoming = await listSplits({ status: "pending", dueBy: todayIso });
  return { away, incoming };
}

/** A placed order takes every due, pending split to its supplier for the
 *  ingredients on it — they're ordered now and can't be cancelled. */
export async function markSplitsPlaced(purchaseOrderId: number, todayIso = londonDateString()): Promise<number> {
  const [po] = await db.select({ supplierId: purchaseOrdersTable.supplierId }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId));
  if (!po) return 0;
  const lines = await db.execute(sql`
    SELECT DISTINCT ingredient_id FROM purchase_order_lines
    WHERE purchase_order_id = ${purchaseOrderId} AND ingredient_id IS NOT NULL
  `);
  const ingredientIds = (lines.rows as Array<{ ingredient_id: number }>).map(r => Number(r.ingredient_id));
  if (ingredientIds.length === 0) return 0;
  const updated = await db
    .update(orderLineSplitsTable)
    .set({ status: "placed", purchaseOrderId, placedAt: new Date() })
    .where(and(
      eq(orderLineSplitsTable.status, "pending"),
      eq(orderLineSplitsTable.targetSupplierId, po.supplierId),
      lte(orderLineSplitsTable.targetOrderDate, todayIso),
      inArray(orderLineSplitsTable.ingredientId, ingredientIds),
    ))
    .returning({ id: orderLineSplitsTable.id });
  return updated.length;
}

/** Cancel a split that hasn't been placed. */
export async function cancelSplit(id: number, userId: number | null): Promise<"cancelled" | "not-found" | "already-placed" | "already-cancelled"> {
  const [row] = await db.select({ status: orderLineSplitsTable.status }).from(orderLineSplitsTable).where(eq(orderLineSplitsTable.id, id));
  if (!row) return "not-found";
  if (row.status === "placed") return "already-placed";
  if (row.status === "cancelled") return "already-cancelled";
  const done = await db
    .update(orderLineSplitsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledByUserId: userId })
    .where(and(eq(orderLineSplitsTable.id, id), ne(orderLineSplitsTable.status, "placed"), eq(orderLineSplitsTable.status, "pending")))
    .returning({ id: orderLineSplitsTable.id });
  return done.length > 0 ? "cancelled" : "already-placed";
}
