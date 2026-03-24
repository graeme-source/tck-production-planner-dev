import { Router, type IRouter } from "express";
import {
  db,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  deliveryRecordsTable,
  deliveryCheckConfigsTable,
  deliveryCheckResultsTable,
  suppliersTable,
  ingredientsTable,
  stockEntriesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, asc } from "drizzle-orm";

const router: IRouter = Router();

const CATEGORY_LOCATION_MAP: Record<string, string> = {
  chilled: "prep_fridge",
  dairy: "prep_fridge",
  produce: "prep_fridge",
  meat: "raw_meat_fridge",
  poultry: "raw_meat_fridge",
  frozen: "raw_freezer",
  ambient: "dry_store",
  dry: "dry_store",
};

function resolveStorageLocation(category: string | null): string {
  if (!category) return "prep_fridge";
  const lower = category.toLowerCase();
  for (const [key, loc] of Object.entries(CATEGORY_LOCATION_MAP)) {
    if (lower.includes(key)) return loc;
  }
  return "prep_fridge";
}

router.get("/weekly", async (req, res) => {
  const dateStr = (req.query.weekOf as string) || new Date().toISOString().split("T")[0];
  const anchor = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = anchor.getUTCDay();
  const monday = new Date(anchor);
  monday.setUTCDate(anchor.getUTCDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const mondayStr = monday.toISOString().split("T")[0];
  const sundayStr = sunday.toISOString().split("T")[0];

  const orders = await db
    .select({
      id: purchaseOrdersTable.id,
      supplierId: purchaseOrdersTable.supplierId,
      supplierName: suppliersTable.name,
      status: purchaseOrdersTable.status,
      expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
      notes: purchaseOrdersTable.notes,
      createdAt: purchaseOrdersTable.createdAt,
    })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(
      and(
        gte(purchaseOrdersTable.expectedDeliveryDate, mondayStr),
        lte(purchaseOrdersTable.expectedDeliveryDate, sundayStr)
      )
    )
    .orderBy(asc(purchaseOrdersTable.expectedDeliveryDate), asc(suppliersTable.name));

  const orderIds = orders.map((o) => o.id);

  let lines: any[] = [];
  if (orderIds.length > 0) {
    lines = await db
      .select({
        id: purchaseOrderLinesTable.id,
        purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
        ingredientId: purchaseOrderLinesTable.ingredientId,
        ingredientName: ingredientsTable.name,
        ingredientCategory: ingredientsTable.category,
        quantityRequired: purchaseOrderLinesTable.quantityRequired,
        quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
        quantityReceived: purchaseOrderLinesTable.quantityReceived,
        unit: purchaseOrderLinesTable.unit,
        unitPrice: purchaseOrderLinesTable.unitPrice,
        checkedOff: purchaseOrderLinesTable.checkedOff,
        notes: purchaseOrderLinesTable.notes,
        useByDate: purchaseOrderLinesTable.useByDate,
      })
      .from(purchaseOrderLinesTable)
      .innerJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
      .where(sql`${purchaseOrderLinesTable.purchaseOrderId} = ANY(${orderIds})`);
  }

  const linesByOrder: Record<number, typeof lines> = {};
  for (const line of lines) {
    if (!linesByOrder[line.purchaseOrderId]) linesByOrder[line.purchaseOrderId] = [];
    linesByOrder[line.purchaseOrderId].push({
      ...line,
      quantityRequired: Number(line.quantityRequired),
      quantityOrdered: Number(line.quantityOrdered),
      quantityReceived: Number(line.quantityReceived),
      unitPrice: line.unitPrice ? Number(line.unitPrice) : null,
    });
  }

  const result = orders.map((o) => ({
    ...o,
    createdAt: o.createdAt.toISOString(),
    lines: linesByOrder[o.id] || [],
  }));

  res.json({ weekOf: mondayStr, orders: result });
});

router.get("/expiry-warnings", async (_req, res) => {
  try {
    const entries = await db
      .select({
        id: stockEntriesTable.id,
        ingredientId: stockEntriesTable.ingredientId,
        ingredientName: ingredientsTable.name,
        quantity: stockEntriesTable.quantity,
        unit: stockEntriesTable.unit,
        location: stockEntriesTable.location,
        useByDate: stockEntriesTable.useByDate,
        checkedAt: stockEntriesTable.checkedAt,
      })
      .from(stockEntriesTable)
      .innerJoin(ingredientsTable, eq(stockEntriesTable.ingredientId, ingredientsTable.id))
      .where(
        and(
          sql`${stockEntriesTable.useByDate} IS NOT NULL`,
          lte(stockEntriesTable.useByDate, sql`CURRENT_DATE + INTERVAL '3 days'`),
          sql`CAST(${stockEntriesTable.quantity} AS NUMERIC) > 0`
        )
      )
      .orderBy(asc(stockEntriesTable.useByDate));

    res.json(
      entries.map((e) => ({
        ...e,
        quantity: Number(e.quantity),
        checkedAt: e.checkedAt.toISOString(),
        isExpired: e.useByDate ? new Date(e.useByDate) < new Date(new Date().toISOString().split("T")[0]) : false,
      }))
    );
  } catch (err) {
    console.error("Expiry warnings error:", err);
    res.json([]);
  }
});

router.get("/supplier/:supplierId/check-configs", async (req, res) => {
  const supplierId = Number(req.params.supplierId);
  const configs = await db
    .select()
    .from(deliveryCheckConfigsTable)
    .where(eq(deliveryCheckConfigsTable.supplierId, supplierId))
    .orderBy(asc(deliveryCheckConfigsTable.sortOrder));
  res.json(configs);
});

router.post("/supplier/:supplierId/check-configs", async (req, res) => {
  const supplierId = Number(req.params.supplierId);
  const { label, isRequired, sortOrder } = req.body;
  const [row] = await db
    .insert(deliveryCheckConfigsTable)
    .values({
      supplierId,
      label,
      isRequired: isRequired ?? true,
      sortOrder: sortOrder ?? 0,
    })
    .returning();
  res.status(201).json(row);
});

router.post("/supplier/:supplierId/seed-defaults", async (req, res) => {
  const supplierId = Number(req.params.supplierId);
  const existing = await db
    .select()
    .from(deliveryCheckConfigsTable)
    .where(eq(deliveryCheckConfigsTable.supplierId, supplierId));

  if (existing.length > 0) {
    res.json(existing);
    return;
  }

  const defaults = [
    { label: "Goods match delivery note", isRequired: true, sortOrder: 0 },
    { label: "Invoice filed", isRequired: true, sortOrder: 1 },
    { label: "Put away and kanbans replaced", isRequired: true, sortOrder: 2 },
  ];

  const rows = await db
    .insert(deliveryCheckConfigsTable)
    .values(defaults.map((d) => ({ ...d, supplierId })))
    .returning();

  res.status(201).json(rows);
});

router.put("/check-configs/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { label, isRequired, sortOrder } = req.body;
  const [row] = await db
    .update(deliveryCheckConfigsTable)
    .set({
      ...(label !== undefined ? { label } : {}),
      ...(isRequired !== undefined ? { isRequired } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    })
    .where(eq(deliveryCheckConfigsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

router.delete("/check-configs/:id", async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(deliveryCheckConfigsTable).where(eq(deliveryCheckConfigsTable.id, id));
  res.status(204).send();
});

router.post("/stock/:stockId/discard", async (req, res) => {
  const stockId = Number(req.params.stockId);
  const { reason } = req.body;
  await db
    .update(stockEntriesTable)
    .set({
      quantity: "0",
      notes: `Discarded: ${reason || "expired"}`,
    })
    .where(eq(stockEntriesTable.id, stockId));
  res.json({ success: true });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db
    .select({
      id: purchaseOrdersTable.id,
      supplierId: purchaseOrdersTable.supplierId,
      supplierName: suppliersTable.name,
      status: purchaseOrdersTable.status,
      expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
      notes: purchaseOrdersTable.notes,
      createdAt: purchaseOrdersTable.createdAt,
    })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, id));

  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const lines = await db
    .select({
      id: purchaseOrderLinesTable.id,
      purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
      ingredientId: purchaseOrderLinesTable.ingredientId,
      ingredientName: ingredientsTable.name,
      ingredientCategory: ingredientsTable.category,
      quantityRequired: purchaseOrderLinesTable.quantityRequired,
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
      unit: purchaseOrderLinesTable.unit,
      unitPrice: purchaseOrderLinesTable.unitPrice,
      checkedOff: purchaseOrderLinesTable.checkedOff,
      notes: purchaseOrderLinesTable.notes,
      useByDate: purchaseOrderLinesTable.useByDate,
    })
    .from(purchaseOrderLinesTable)
    .innerJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, id));

  const checks = await db
    .select()
    .from(deliveryCheckConfigsTable)
    .where(eq(deliveryCheckConfigsTable.supplierId, order.supplierId))
    .orderBy(asc(deliveryCheckConfigsTable.sortOrder));

  res.json({
    ...order,
    createdAt: order.createdAt.toISOString(),
    lines: lines.map((l) => ({
      ...l,
      quantityRequired: Number(l.quantityRequired),
      quantityOrdered: Number(l.quantityOrdered),
      quantityReceived: Number(l.quantityReceived),
      unitPrice: l.unitPrice ? Number(l.unitPrice) : null,
    })),
    checks,
  });
});

router.post("/:id/receive", async (req, res) => {
  const poId = Number(req.params.id);
  const userId = req.session.userId;
  const {
    lines,
    chilledTempC,
    frozenTempC,
    checkResults,
    notes,
  } = req.body as {
    lines: { lineId: number; quantityReceived: number; useByDate?: string | null }[];
    chilledTempC?: number | null;
    frozenTempC?: number | null;
    checkResults?: { checkConfigId: number; passed: boolean; notes?: string }[];
    notes?: string;
  };

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "lines array is required" });
    return;
  }

  for (const line of lines) {
    if (typeof line.quantityReceived !== "number" || line.quantityReceived < 0) {
      res.status(400).json({ error: `Invalid quantity for line ${line.lineId}: must be >= 0` });
      return;
    }
  }

  const [order] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, poId));

  if (!order) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  const existingLines = await db
    .select({
      id: purchaseOrderLinesTable.id,
      ingredientId: purchaseOrderLinesTable.ingredientId,
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
      unit: purchaseOrderLinesTable.unit,
      ingredientCategory: ingredientsTable.category,
    })
    .from(purchaseOrderLinesTable)
    .innerJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, poId));

  const existingLineMap = new Map(existingLines.map((l) => [l.id, l]));

  for (const line of lines) {
    if (!existingLineMap.has(line.lineId)) {
      res.status(400).json({ error: `Line ${line.lineId} does not belong to PO #${poId}` });
      return;
    }
  }

  const stockInserts: {
    ingredientId: number;
    quantity: string;
    unit: string;
    location: string;
    useByDate: string | null;
  }[] = [];

  for (const line of lines) {
    const existing = existingLineMap.get(line.lineId)!;
    const previousReceived = Number(existing.quantityReceived);
    const newTotal = line.quantityReceived;
    const delta = newTotal - previousReceived;

    await db
      .update(purchaseOrderLinesTable)
      .set({
        quantityReceived: String(newTotal),
        useByDate: line.useByDate || null,
      })
      .where(eq(purchaseOrderLinesTable.id, line.lineId));

    if (delta > 0) {
      const location = resolveStorageLocation(existing.ingredientCategory);
      stockInserts.push({
        ingredientId: existing.ingredientId,
        quantity: String(delta),
        unit: existing.unit,
        location,
        useByDate: line.useByDate || null,
      });
    }
  }

  const [deliveryRecord] = await db
    .insert(deliveryRecordsTable)
    .values({
      purchaseOrderId: poId,
      supplierId: order.supplierId,
      receivedByUserId: userId ?? null,
      chilledTempC: chilledTempC != null ? String(chilledTempC) : null,
      frozenTempC: frozenTempC != null ? String(frozenTempC) : null,
      notes: notes || null,
    })
    .returning();

  if (checkResults && checkResults.length > 0) {
    await db.insert(deliveryCheckResultsTable).values(
      checkResults.map((cr) => ({
        deliveryRecordId: deliveryRecord.id,
        checkConfigId: cr.checkConfigId,
        passed: cr.passed,
        notes: cr.notes || null,
      }))
    );
  }

  for (const si of stockInserts) {
    await db.insert(stockEntriesTable).values({
      ingredientId: si.ingredientId,
      itemType: "ingredient",
      quantity: si.quantity,
      unit: si.unit,
      location: si.location,
      useByDate: si.useByDate,
      notes: `Delivery from PO #${poId}`,
    });
  }

  const allLines = await db
    .select({
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
    })
    .from(purchaseOrderLinesTable)
    .where(eq(purchaseOrderLinesTable.purchaseOrderId, poId));

  const allFullyReceived = allLines.every(
    (l) => Number(l.quantityReceived) >= Number(l.quantityOrdered)
  );
  const anyReceived = allLines.some((l) => Number(l.quantityReceived) > 0);

  const newStatus = allFullyReceived ? "received" : anyReceived ? "partially_received" : order.status;

  await db
    .update(purchaseOrdersTable)
    .set({ status: newStatus })
    .where(eq(purchaseOrdersTable.id, poId));

  res.json({
    deliveryRecordId: deliveryRecord.id,
    orderStatus: newStatus,
  });
});

router.get("/:id/history", async (req, res) => {
  const poId = Number(req.params.id);
  const records = await db
    .select()
    .from(deliveryRecordsTable)
    .where(eq(deliveryRecordsTable.purchaseOrderId, poId))
    .orderBy(desc(deliveryRecordsTable.receivedAt));

  const result = [];
  for (const record of records) {
    const checkResults = await db
      .select({
        id: deliveryCheckResultsTable.id,
        checkConfigId: deliveryCheckResultsTable.checkConfigId,
        label: deliveryCheckConfigsTable.label,
        passed: deliveryCheckResultsTable.passed,
        notes: deliveryCheckResultsTable.notes,
      })
      .from(deliveryCheckResultsTable)
      .innerJoin(
        deliveryCheckConfigsTable,
        eq(deliveryCheckResultsTable.checkConfigId, deliveryCheckConfigsTable.id)
      )
      .where(eq(deliveryCheckResultsTable.deliveryRecordId, record.id));

    result.push({
      ...record,
      receivedAt: record.receivedAt.toISOString(),
      chilledTempC: record.chilledTempC ? Number(record.chilledTempC) : null,
      frozenTempC: record.frozenTempC ? Number(record.frozenTempC) : null,
      checkResults,
    });
  }

  res.json(result);
});

export default router;
