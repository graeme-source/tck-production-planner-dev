/**
 * Writes for combining two same-supplier, same-day orders. Rules:
 * lib/order-combine-rules.ts. The older order stays; the newer one's lines
 * join it and the newer one goes. Objective B.
 */
import {
  db, deliveryDamageReportsTable, deliveryIssuePhotosTable, deliveryRecordsTable, deliveryShelfLifeReportsTable,
  orderLineSplitsTable, purchaseOrderLinesTable, purchaseOrdersTable, queuedIngredientMarksTable,
  shortDeliveryReportsTable, standingOrderMarksTable,
} from "@workspace/db";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { combineBlocker, planLineMerge } from "./order-combine-rules";

export class CombineRefused extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The oldest other placed, un-received order for this supplier and day. */
export async function findSameDayOrder(supplierId: number, deliveryDate: string, exceptOrderId?: number) {
  const rows = await db
    .select({ id: purchaseOrdersTable.id, expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate })
    .from(purchaseOrdersTable)
    .where(and(
      eq(purchaseOrdersTable.supplierId, supplierId),
      eq(purchaseOrdersTable.expectedDeliveryDate, deliveryDate),
      eq(purchaseOrdersTable.status, "placed"),
      exceptOrderId != null ? ne(purchaseOrdersTable.id, exceptOrderId) : undefined,
    ))
    .orderBy(asc(purchaseOrdersTable.id))
    .limit(1);
  if (!rows[0]) return null;
  const lines = await db
    .select({ id: purchaseOrderLinesTable.id })
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, rows[0].id));
  return { id: rows[0].id, itemCount: lines.length };
}

async function receivingStarted(tx: Tx, orderIds: number[]): Promise<boolean> {
  const anyFor = async (table: typeof deliveryRecordsTable | typeof deliveryShelfLifeReportsTable | typeof shortDeliveryReportsTable | typeof deliveryIssuePhotosTable | typeof deliveryDamageReportsTable) => {
    const rows = await tx.select({ id: table.purchaseOrderId }).from(table).where(inArray(table.purchaseOrderId, orderIds)).limit(1);
    return rows.length > 0;
  };
  for (const table of [deliveryRecordsTable, deliveryShelfLifeReportsTable, shortDeliveryReportsTable, deliveryIssuePhotosTable, deliveryDamageReportsTable]) {
    if (await anyFor(table)) return true;
  }
  return false;
}

/** Move `sourceId` into `targetId`. Throws CombineRefused with the reason. */
export async function combineOrders(targetId: number, sourceId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const orders = await tx
      .select()
      .from(purchaseOrdersTable)
      .where(inArray(purchaseOrdersTable.id, [targetId, sourceId]))
      .for("update");
    const target = orders.find(o => o.id === targetId);
    const source = orders.find(o => o.id === sourceId);
    if (!target || !source) throw new CombineRefused("That order no longer exists.");

    const lines = await tx
      .select()
      .from(purchaseOrderLinesTable)
      .where(inArray(purchaseOrderLinesTable.purchaseOrderId, [targetId, sourceId]));
    const started = lines.some(l => l.goodsInChecked || Number(l.quantityReceived) > 0) || await receivingStarted(tx, [targetId, sourceId]);
    const blocker = combineBlocker(target, source, started);
    if (blocker) throw new CombineRefused(blocker);

    const plan = planLineMerge(
      lines.filter(l => l.purchaseOrderId === targetId),
      lines.filter(l => l.purchaseOrderId === sourceId),
    );
    for (const a of plan.add) {
      await tx.update(purchaseOrderLinesTable)
        .set({ quantityRequired: a.quantityRequired, quantityOrdered: a.quantityOrdered, checkedOff: a.checkedOff })
        .where(eq(purchaseOrderLinesTable.id, a.line.id));
    }
    if (plan.move.length > 0) {
      await tx.update(purchaseOrderLinesTable)
        .set({ purchaseOrderId: targetId })
        .where(inArray(purchaseOrderLinesTable.id, plan.move.map(l => l.id)));
    }

    // Everything that remembers the order it was placed on follows it.
    await tx.update(orderLineSplitsTable).set({ purchaseOrderId: targetId }).where(eq(orderLineSplitsTable.purchaseOrderId, sourceId));
    await tx.update(queuedIngredientMarksTable).set({ poId: targetId }).where(eq(queuedIngredientMarksTable.poId, sourceId));
    await tx.update(standingOrderMarksTable).set({ poId: targetId }).where(eq(standingOrderMarksTable.poId, sourceId));

    await tx.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, sourceId));
  });
  console.log(`[Orders] Combined PO ${sourceId} into PO ${targetId}`);
}
