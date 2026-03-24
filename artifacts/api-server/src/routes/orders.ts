import { Router, type IRouter } from "express";
import {
  db,
  productionPlansTable,
  productionPlanItemsTable,
  recipesTable,
  ingredientsTable,
  suppliersTable,
  stockEntriesTable,
  dailyStockChecksTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  kanbanItemsTable,
  dptIngredientRequirementsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";
import { resolveRecipeIngredients, aggregateIngredients } from "../lib/ingredient-resolver";

const router: IRouter = Router();

const FREEZER_LOCATIONS = ["production_freezer", "raw_freezer"];

router.get("/calculate", async (req, res) => {
  const planId = Number(req.query.planId);
  if (!planId || isNaN(planId)) {
    res.status(400).json({ error: "planId query parameter is required" });
    return;
  }

  const plan = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);

  if (plan.length === 0) {
    res.status(404).json({ error: "Production plan not found" });
    return;
  }

  const planItems = await db
    .select({
      recipeId: productionPlanItemsTable.recipeId,
      batchesTarget: productionPlanItemsTable.batchesTarget,
      recipeName: recipesTable.name,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(productionPlanItemsTable)
    .leftJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
    .where(eq(productionPlanItemsTable.planId, planId));

  const ingredientMap: Record<number, {
    ingredientId: number;
    ingredientName: string;
    unit: string;
    totalRequired: number;
    stockCheckEnabled: boolean;
  }> = {};

  for (const planItem of planItems) {
    const batchesTarget = Number(planItem.batchesTarget) || 0;
    if (!planItem.recipeId || batchesTarget === 0) continue;

    const portionsPerBatch = Number(planItem.portionsPerBatch) || 10;
    const resolved = await resolveRecipeIngredients(planItem.recipeId, portionsPerBatch);
    const agg = aggregateIngredients(resolved);

    for (const [iid, ing] of agg) {
      const cookedQty = ing.quantityPerBatch * batchesTarget;
      const rawQty = ing.processingRatio ? cookedQty / ing.processingRatio : cookedQty;

      if (!ingredientMap[iid]) {
        ingredientMap[iid] = {
          ingredientId: iid,
          ingredientName: ing.ingredientName,
          unit: ing.unit,
          totalRequired: 0,
          stockCheckEnabled: ing.stockCheckEnabled,
        };
      }
      ingredientMap[iid].totalRequired += rawQty;
    }
  }

  const ingredientIds = Object.keys(ingredientMap).map(Number);
  if (ingredientIds.length === 0) {
    res.json({ planId, planName: plan[0].name, planDate: plan[0].planDate, suppliers: [] });
    return;
  }

  const ingredientDetails = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      packWeight: ingredientsTable.packWeight,
      costPerPack: ingredientsTable.costPerPack,
      supplierId: ingredientsTable.supplierId,
      supplierPartNumber: ingredientsTable.supplierPartNumber,
      stockCheckEnabled: ingredientsTable.stockCheckEnabled,
      surplusPercent: ingredientsTable.surplusPercent,
    })
    .from(ingredientsTable)
    .where(inArray(ingredientsTable.id, ingredientIds));

  const ingredientLookup: Record<number, typeof ingredientDetails[0]> = {};
  for (const d of ingredientDetails) {
    ingredientLookup[d.id] = d;
  }

  const supplierIds = [...new Set(ingredientDetails.map(d => d.supplierId).filter((id): id is number => id !== null))];
  const supplierRows = supplierIds.length > 0
    ? await db.select().from(suppliersTable).where(inArray(suppliersTable.id, supplierIds))
    : [];
  const supplierLookup: Record<number, typeof supplierRows[0]> = {};
  for (const s of supplierRows) {
    supplierLookup[s.id] = s;
  }

  const stockRows = await db
    .select({
      ingredientId: stockEntriesTable.ingredientId,
      quantity: stockEntriesTable.quantity,
      checkedAt: stockEntriesTable.checkedAt,
    })
    .from(stockEntriesTable)
    .where(and(
      eq(stockEntriesTable.itemType, "ingredient"),
      notInArray(stockEntriesTable.location, FREEZER_LOCATIONS),
    ))
    .orderBy(desc(stockEntriesTable.checkedAt));

  const latestStockByIngredient: Record<number, number> = {};
  for (const row of stockRows) {
    if (row.ingredientId != null && latestStockByIngredient[row.ingredientId] === undefined) {
      latestStockByIngredient[row.ingredientId] = Number(row.quantity);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const stockChecks = await db
    .select({
      ingredientId: dailyStockChecksTable.ingredientId,
      quantity: dailyStockChecksTable.quantity,
    })
    .from(dailyStockChecksTable)
    .where(eq(dailyStockChecksTable.checkDate, today));

  for (const sc of stockChecks) {
    if (sc.quantity !== null) {
      latestStockByIngredient[sc.ingredientId] = Number(sc.quantity);
    }
  }

  const dptReqs = await db
    .select({
      ingredientId: dptIngredientRequirementsTable.ingredientId,
      dailyQtyRaw: dptIngredientRequirementsTable.dailyQtyRaw,
    })
    .from(dptIngredientRequirementsTable);

  const dptLookup: Record<number, number> = {};
  for (const d of dptReqs) {
    dptLookup[d.ingredientId] = Number(d.dailyQtyRaw);
  }

  const pulledKanbans = await db
    .select({
      id: kanbanItemsTable.id,
      ingredientId: kanbanItemsTable.ingredientId,
      supplierId: kanbanItemsTable.supplierId,
    })
    .from(kanbanItemsTable)
    .where(and(
      eq(kanbanItemsTable.status, "pulled"),
      eq(kanbanItemsTable.orderDayTarget, today),
    ));

  const kanbanIngredientIds = new Set(pulledKanbans.map(k => k.ingredientId));

  const supplierOrderMap: Record<number, {
    supplier: { id: number; name: string; contactName: string | null; email: string | null; phone: string | null; website: string | null };
    lines: Array<{
      ingredientId: number;
      ingredientName: string;
      unit: string;
      totalRequired: number;
      stockOnHand: number;
      surplusTarget: number;
      packWeight: number;
      costPerPack: number;
      supplierPartNumber: string | null;
      orderQty: number;
      packsToOrder: number;
      isKanban: boolean;
    }>;
  }> = {};

  const kanbanSupplierOverrides: Record<number, number> = {};
  for (const k of pulledKanbans) {
    if (k.supplierId) {
      kanbanSupplierOverrides[k.ingredientId] = k.supplierId;
    }
  }

  for (const [idStr, ing] of Object.entries(ingredientMap)) {
    const iid = Number(idStr);
    const detail = ingredientLookup[iid];
    if (!detail) continue;

    const isKanban = kanbanIngredientIds.has(iid);
    const isStockChecked = detail.stockCheckEnabled ?? false;

    if (!isStockChecked && !isKanban) continue;

    const suppId = isKanban && kanbanSupplierOverrides[iid]
      ? kanbanSupplierOverrides[iid]
      : detail.supplierId;
    if (!suppId) continue;

    const packWeight = Number(detail.packWeight) || 1;
    const costPerPack = Number(detail.costPerPack) || 0;
    const stockOnHand = latestStockByIngredient[iid] ?? 0;
    const surplusPercent = Number(detail.surplusPercent) || 10;
    const surplusTarget = (dptLookup[iid] ?? 0) * (surplusPercent / 100);

    const rawOrderQty = Math.max(0, ing.totalRequired + surplusTarget - stockOnHand);
    const packsToOrder = packWeight > 0 ? Math.ceil(rawOrderQty / packWeight) : 0;
    const orderQty = packsToOrder * packWeight;

    if (orderQty <= 0 && !isKanban) continue;

    if (!supplierOrderMap[suppId]) {
      let supplier = supplierLookup[suppId];
      if (!supplier) {
        const [s] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, suppId)).limit(1);
        if (s) { supplier = s; supplierLookup[suppId] = s; }
      }
      supplierOrderMap[suppId] = {
        supplier: {
          id: suppId,
          name: supplier?.name ?? `Supplier #${suppId}`,
          contactName: supplier?.contactName ?? null,
          email: supplier?.email ?? null,
          phone: supplier?.phone ?? null,
          website: supplier?.website ?? null,
        },
        lines: [],
      };
    }

    supplierOrderMap[suppId].lines.push({
      ingredientId: iid,
      ingredientName: ing.ingredientName,
      unit: ing.unit,
      totalRequired: Math.round(ing.totalRequired * 100) / 100,
      stockOnHand: Math.round(stockOnHand * 100) / 100,
      surplusTarget: Math.round(surplusTarget * 100) / 100,
      packWeight,
      costPerPack,
      supplierPartNumber: detail.supplierPartNumber ?? null,
      orderQty: Math.round(orderQty * 100) / 100,
      packsToOrder,
      isKanban,
    });
  }

  for (const kanban of pulledKanbans) {
    if (ingredientMap[kanban.ingredientId]) continue;

    const detail = ingredientLookup[kanban.ingredientId];
    if (!detail) {
      const fullDetail = await db
        .select({
          id: ingredientsTable.id,
          name: ingredientsTable.name,
          unit: ingredientsTable.unit,
          packWeight: ingredientsTable.packWeight,
          costPerPack: ingredientsTable.costPerPack,
          supplierId: ingredientsTable.supplierId,
          supplierPartNumber: ingredientsTable.supplierPartNumber,
        })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.id, kanban.ingredientId))
        .limit(1);

      if (fullDetail.length === 0) continue;
      const d = fullDetail[0];
      const suppId = kanban.supplierId ?? d.supplierId;
      if (!suppId) continue;

      const packWeight = Number(d.packWeight) || 1;

      if (!supplierOrderMap[suppId]) {
        const supplier = supplierLookup[suppId] ??
          (await db.select().from(suppliersTable).where(eq(suppliersTable.id, suppId)).limit(1))[0];
        supplierOrderMap[suppId] = {
          supplier: {
            id: suppId,
            name: supplier?.name ?? `Supplier #${suppId}`,
            contactName: supplier?.contactName ?? null,
            email: supplier?.email ?? null,
            phone: supplier?.phone ?? null,
            website: supplier?.website ?? null,
          },
          lines: [],
        };
      }

      supplierOrderMap[suppId].lines.push({
        ingredientId: d.id,
        ingredientName: d.name,
        unit: d.unit,
        totalRequired: 0,
        stockOnHand: 0,
        surplusTarget: 0,
        packWeight,
        costPerPack: Number(d.costPerPack) || 0,
        supplierPartNumber: d.supplierPartNumber ?? null,
        orderQty: packWeight,
        packsToOrder: 1,
        isKanban: true,
      });
    }
  }

  const suppliers = Object.values(supplierOrderMap).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));

  res.json({
    planId,
    planName: plan[0].name,
    planDate: plan[0].planDate,
    suppliers,
  });
});

router.get("/purchase-orders", async (req, res) => {
  const filter = req.query.filter as string | undefined;

  let rows;
  if (filter === "today") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    rows = await db
      .select({
        id: purchaseOrdersTable.id,
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: suppliersTable.name,
        planId: purchaseOrdersTable.planId,
        status: purchaseOrdersTable.status,
        createdAt: purchaseOrdersTable.createdAt,
        placedAt: purchaseOrdersTable.placedAt,
        expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
        notes: purchaseOrdersTable.notes,
        placedByUserId: purchaseOrdersTable.placedByUserId,
      })
      .from(purchaseOrdersTable)
      .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
      .where(sql`${purchaseOrdersTable.createdAt} >= ${todayStart} AND ${purchaseOrdersTable.createdAt} <= ${todayEnd}`)
      .orderBy(desc(purchaseOrdersTable.createdAt));
  } else {
    rows = await db
      .select({
        id: purchaseOrdersTable.id,
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: suppliersTable.name,
        planId: purchaseOrdersTable.planId,
        status: purchaseOrdersTable.status,
        createdAt: purchaseOrdersTable.createdAt,
        placedAt: purchaseOrdersTable.placedAt,
        expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
        notes: purchaseOrdersTable.notes,
        placedByUserId: purchaseOrdersTable.placedByUserId,
      })
      .from(purchaseOrdersTable)
      .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
      .orderBy(desc(purchaseOrdersTable.createdAt));
  }

  const orderIds = rows.map(r => r.id);
  let linesMap: Record<number, Array<{
    id: number;
    ingredientId: number;
    ingredientName: string | null;
    quantityRequired: string;
    quantityOrdered: string;
    quantityReceived: string;
    unit: string;
    unitPrice: string | null;
    checkedOff: boolean;
    notes: string | null;
  }>> = {};

  if (orderIds.length > 0) {
    const lines = await db
      .select({
        id: purchaseOrderLinesTable.id,
        purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
        ingredientId: purchaseOrderLinesTable.ingredientId,
        ingredientName: ingredientsTable.name,
        quantityRequired: purchaseOrderLinesTable.quantityRequired,
        quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
        quantityReceived: purchaseOrderLinesTable.quantityReceived,
        unit: purchaseOrderLinesTable.unit,
        unitPrice: purchaseOrderLinesTable.unitPrice,
        checkedOff: purchaseOrderLinesTable.checkedOff,
        notes: purchaseOrderLinesTable.notes,
      })
      .from(purchaseOrderLinesTable)
      .leftJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
      .where(inArray(purchaseOrderLinesTable.purchaseOrderId, orderIds));

    for (const line of lines) {
      if (!linesMap[line.purchaseOrderId]) linesMap[line.purchaseOrderId] = [];
      linesMap[line.purchaseOrderId].push({
        id: line.id,
        ingredientId: line.ingredientId,
        ingredientName: line.ingredientName,
        quantityRequired: line.quantityRequired,
        quantityOrdered: line.quantityOrdered,
        quantityReceived: line.quantityReceived,
        unit: line.unit,
        unitPrice: line.unitPrice,
        checkedOff: line.checkedOff,
        notes: line.notes,
      });
    }
  }

  const result = rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    placedAt: r.placedAt?.toISOString() ?? null,
    lines: linesMap[r.id] ?? [],
  }));

  res.json(result);
});

router.post("/purchase-orders", async (req, res) => {
  const { supplierId, planId, notes, lines } = req.body;

  if (!supplierId || !lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "supplierId and lines are required" });
    return;
  }

  const [order] = await db.insert(purchaseOrdersTable).values({
    supplierId,
    planId: planId ?? null,
    status: "draft",
    notes: notes ?? null,
  }).returning();

  const lineValues = lines.map((l: any) => ({
    purchaseOrderId: order.id,
    ingredientId: l.ingredientId,
    quantityRequired: String(l.quantityRequired ?? 0),
    quantityOrdered: String(l.quantityOrdered ?? 0),
    quantityReceived: "0",
    unit: l.unit ?? "g",
    unitPrice: l.unitPrice ? String(l.unitPrice) : null,
    checkedOff: l.checkedOff ?? false,
    notes: l.notes ?? null,
  }));

  await db.insert(purchaseOrderLinesTable).values(lineValues);

  res.status(201).json({
    ...order,
    createdAt: order.createdAt.toISOString(),
    placedAt: order.placedAt?.toISOString() ?? null,
  });
});

router.patch("/purchase-orders/:id/place", async (req, res) => {
  const orderId = Number(req.params.id);
  const userId = req.session.userId ?? null;

  const [existing] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, orderId))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  if (existing.status === "placed" || existing.status === "received") {
    res.status(400).json({ error: `Order is already ${existing.status}` });
    return;
  }

  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({
      status: "placed",
      placedAt: new Date(),
      placedByUserId: userId,
    })
    .where(eq(purchaseOrdersTable.id, orderId))
    .returning();

  const today = new Date().toISOString().split("T")[0];
  await db
    .update(kanbanItemsTable)
    .set({ status: "ordered" })
    .where(and(
      eq(kanbanItemsTable.status, "pulled"),
      eq(kanbanItemsTable.orderDayTarget, today),
      eq(kanbanItemsTable.supplierId, existing.supplierId),
    ));

  res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    placedAt: updated.placedAt?.toISOString() ?? null,
  });
});

router.get("/summary", async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayOrders = await db
    .select({
      id: purchaseOrdersTable.id,
      supplierId: purchaseOrdersTable.supplierId,
      supplierName: suppliersTable.name,
      status: purchaseOrdersTable.status,
    })
    .from(purchaseOrdersTable)
    .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(sql`${purchaseOrdersTable.createdAt} >= ${todayStart} AND ${purchaseOrdersTable.createdAt} <= ${todayEnd}`);

  const placed = todayOrders.filter(o => o.status === "placed");
  const pending = todayOrders.filter(o => o.status === "draft");

  res.json({
    totalOrders: todayOrders.length,
    placedCount: placed.length,
    pendingCount: pending.length,
    suppliers: todayOrders.map(o => ({ id: o.supplierId, name: o.supplierName })),
  });
});

export default router;
