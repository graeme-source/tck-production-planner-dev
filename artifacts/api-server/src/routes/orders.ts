import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { calcExpectedDeliveryDate, toISODate } from "@workspace/business-days";
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
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";
import { resolveRecipeIngredients, aggregateIngredients } from "../lib/ingredient-resolver";

async function requireManagerOrAdmin(req: Request, res: Response, next: NextFunction) {
  let role = (req.session as any).userRole;
  if (!role && (req.session as any).userId) {
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, (req.session as any).userId));
    if (user) { role = user.role; (req.session as any).userRole = role; }
  }
  if (role === "admin" || role === "manager") { next(); return; }
  res.status(403).json({ error: "Manager or admin access required" });
}

const router: IRouter = Router();

const FREEZER_LOCATIONS = ["production_freezer", "raw_freezer"];

router.get("/calculate", async (req, res) => {
  const planId = Number(req.query.planId);
  if (!planId || isNaN(planId)) {
    res.status(400).json({ error: "planId query parameter is required" });
    return;
  }

  try {

  const plan = await db
    .select({ id: productionPlansTable.id, planDate: productionPlansTable.planDate, name: productionPlansTable.name, status: productionPlansTable.status })
    .from(productionPlansTable)
    .where(eq(productionPlansTable.id, planId))
    .limit(1);

  if (plan.length === 0) {
    res.status(404).json({ error: "Production plan not found" });
    return;
  }

  if (plan[0].status === "draft") {
    res.status(403).json({ error: "Orders can only be calculated for active production plans. Activate the plan first." });
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
      kanbanQuantity: ingredientsTable.kanbanQuantity,
      kanbanUnit: ingredientsTable.kanbanUnit,
      orderingUrl: ingredientsTable.orderingUrl,
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
  const stockCheckTimestamps: Record<number, string> = {};
  for (const row of stockRows) {
    if (row.ingredientId != null && latestStockByIngredient[row.ingredientId] === undefined) {
      latestStockByIngredient[row.ingredientId] = Number(row.quantity);
      if (row.checkedAt) stockCheckTimestamps[row.ingredientId] = new Date(row.checkedAt).toISOString();
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const stockChecks = await db
    .select({
      ingredientId: dailyStockChecksTable.ingredientId,
      quantity: dailyStockChecksTable.quantity,
      checkedAt: dailyStockChecksTable.checkedAt,
    })
    .from(dailyStockChecksTable)
    .where(eq(dailyStockChecksTable.checkDate, today));

  for (const sc of stockChecks) {
    if (sc.quantity !== null) {
      latestStockByIngredient[sc.ingredientId] = Number(sc.quantity);
    }
    if (sc.checkedAt) {
      stockCheckTimestamps[sc.ingredientId] = new Date(sc.checkedAt).toISOString();
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
      orderingUrl: string | null;
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
    // Use DPT daily requirement if available, otherwise fall back to
    // the current plan's totalRequired for this ingredient.
    const dailyRequirement = dptLookup[iid] ?? ing.totalRequired;
    const surplusTarget = dailyRequirement * (surplusPercent / 100);

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
          leadTimeDays: supplier?.leadTimeDays ?? 1,
          cutoffTime: supplier?.cutoffTime ?? "17:00",
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
      orderingUrl: detail.orderingUrl ?? null,
      lastStockCheckAt: stockCheckTimestamps[iid] ?? null,
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
          kanbanQuantity: ingredientsTable.kanbanQuantity,
          kanbanOrderAmount: ingredientsTable.kanbanOrderAmount,
          kanbanUnit: ingredientsTable.kanbanUnit,
          orderingUrl: ingredientsTable.orderingUrl,
        })
        .from(ingredientsTable)
        .where(eq(ingredientsTable.id, kanban.ingredientId))
        .limit(1);

      if (fullDetail.length === 0) continue;
      const d = fullDetail[0];
      const suppId = kanban.supplierId ?? d.supplierId;
      if (!suppId) continue;

      const packWeight = Number(d.packWeight) || 1;
      const packsToOrder = Number(d.kanbanOrderAmount ?? d.kanbanQuantity) || 1;
      const kanbanUnitVal = d.kanbanUnit ?? "weight";
      const displayUnit = kanbanUnitVal === "pack" ? "packs"
        : kanbanUnitVal === "bottle" ? "bottles"
        : (d.unit ?? "kg");
      const orderQty = packsToOrder;

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
            leadTimeDays: supplier?.leadTimeDays ?? 1,
            cutoffTime: supplier?.cutoffTime ?? "17:00",
          },
          lines: [],
        };
      }

      supplierOrderMap[suppId].lines.push({
        ingredientId: d.id,
        ingredientName: d.name,
        unit: displayUnit,
        totalRequired: 0,
        stockOnHand: 0,
        surplusTarget: 0,
        packWeight,
        costPerPack: Number(d.costPerPack) || 0,
        supplierPartNumber: d.supplierPartNumber ?? null,
        orderQty,
        packsToOrder,
        isKanban: true,
        orderingUrl: d.orderingUrl ?? null,
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

  } catch (err) {
    console.error("[Orders] Calculate failed:", err);
    res.status(500).json({ error: "Failed to calculate orders", detail: String(err) });
  }
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
    orderingUrl: string | null;
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
        orderingUrl: ingredientsTable.orderingUrl,
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
        orderingUrl: line.orderingUrl ?? null,
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

  const [supplier] = await db
    .select({
      leadTimeDays: suppliersTable.leadTimeDays,
      cutoffTime: suppliersTable.cutoffTime,
    })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, existing.supplierId));

  const overrideDate = req.body?.expectedDeliveryDate;
  let expectedDeliveryDate: string;

  if (overrideDate && typeof overrideDate === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    res.status(400).json({ error: "Invalid delivery date format, expected YYYY-MM-DD" });
    return;
  }

  if (overrideDate && typeof overrideDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    const parts = overrideDate.split("-").map(Number);
    const overrideParsed = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(overrideParsed.getTime()) ||
        overrideParsed.getFullYear() !== parts[0] ||
        overrideParsed.getMonth() !== parts[1] - 1 ||
        overrideParsed.getDate() !== parts[2]) {
      res.status(400).json({ error: "Invalid calendar date" });
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (overrideParsed < today) {
      res.status(400).json({ error: "Delivery date cannot be in the past" });
      return;
    }
    if (overrideParsed.getDay() === 0 || overrideParsed.getDay() === 6) {
      while (overrideParsed.getDay() === 0 || overrideParsed.getDay() === 6) {
        overrideParsed.setDate(overrideParsed.getDate() + 1);
      }
    }
    expectedDeliveryDate = toISODate(overrideParsed);
  } else {
    const leadTimeDays = supplier?.leadTimeDays ?? 1;
    const cutoffTime = supplier?.cutoffTime ?? "17:00";
    const deliveryDate = calcExpectedDeliveryDate(leadTimeDays, cutoffTime);
    expectedDeliveryDate = toISODate(deliveryDate);
  }

  const [updated] = await db
    .update(purchaseOrdersTable)
    .set({
      status: "placed",
      placedAt: new Date(),
      placedByUserId: userId,
      expectedDeliveryDate,
    })
    .where(eq(purchaseOrdersTable.id, orderId))
    .returning();

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

// ── Update stock check from orders page ─────────────────────────────
// Upserts daily_stock_checks and inserts a stock_entries row so
// the ingredient's storage location stays in sync.
router.patch("/stock-check", async (req, res) => {
  const { ingredientId, quantity } = req.body;
  if (!ingredientId || quantity === undefined) {
    res.status(400).json({ error: "ingredientId and quantity are required" });
    return;
  }

  const userId = (req.session as any)?.userId ?? null;
  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Upsert daily stock check
    const [row] = await db
      .insert(dailyStockChecksTable)
      .values({ ingredientId, checkDate: today, quantity: String(quantity), userId })
      .onConflictDoUpdate({
        target: [dailyStockChecksTable.ingredientId, dailyStockChecksTable.checkDate],
        set: { quantity: String(quantity), userId, checkedAt: sql`now()` },
      })
      .returning();

    // 2. Insert stock entry for the ingredient's location
    const [ingredient] = await db
      .select({ unit: ingredientsTable.unit, category: ingredientsTable.category })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, ingredientId))
      .limit(1);

    if (ingredient) {
      // Map ingredient category to storage location
      const locationMap: Record<string, string> = {
        raw_meat: "raw_meat_fridge",
        meat: "raw_meat_fridge",
        dairy: "production_fridge",
        vegetable: "production_fridge",
        cheese: "production_fridge",
        frozen: "production_freezer",
        dry: "dry_store",
      };
      const location = locationMap[ingredient.category ?? ""] ?? "production_fridge";

      await db.insert(stockEntriesTable).values({
        ingredientId,
        itemType: "ingredient",
        quantity: String(quantity),
        unit: ingredient.unit ?? "kg",
        location,
        checkedAt: new Date(),
      });
    }

    res.json({ ...row, checkedAt: row.checkedAt ? new Date(row.checkedAt).toISOString() : new Date().toISOString() });
  } catch (err: any) {
    console.error("[Orders] Stock check update failed:", err.message);
    res.status(500).json({ error: "Failed to update stock check" });
  }
});

// ── Regenerate orders for a plan ──────────────────────────────────────
// Deletes all DRAFT purchase orders linked to the plan, then re-creates
// new draft orders from the latest calculate results.
router.post("/regenerate", requireManagerOrAdmin, async (req, res) => {
  const planId = Number(req.body.planId);
  if (!planId || isNaN(planId)) {
    res.status(400).json({ error: "planId is required" });
    return;
  }

  try {
    // 1. Find all draft purchase orders for this plan
    const draftOrders = await db
      .select({ id: purchaseOrdersTable.id })
      .from(purchaseOrdersTable)
      .where(and(
        eq(purchaseOrdersTable.planId, planId),
        eq(purchaseOrdersTable.status, "draft"),
      ));

    const deletedCount = draftOrders.length;

    // 2. Delete them (lines cascade or delete explicitly)
    if (draftOrders.length > 0) {
      const draftIds = draftOrders.map(o => o.id);
      await db.delete(purchaseOrderLinesTable).where(inArray(purchaseOrderLinesTable.purchaseOrderId, draftIds));
      await db.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, draftIds));
    }

    // 3. Re-run the calculate logic by calling the same endpoint internally
    //    We simulate a request to /calculate to get the supplier/line data.
    const calcUrl = `${req.protocol}://${req.get("host")}/api/orders/calculate?planId=${planId}`;
    const calcRes = await fetch(calcUrl, {
      headers: { cookie: req.headers.cookie ?? "" },
    });
    if (!calcRes.ok) {
      const err = await calcRes.json().catch(() => ({}));
      res.status(500).json({ error: "Failed to calculate orders", detail: (err as any).error ?? calcRes.statusText });
      return;
    }
    const calcData = await calcRes.json() as {
      planId: number;
      planName: string;
      suppliers: Array<{
        supplier: { id: number; name: string };
        lines: Array<{
          ingredientId: number;
          totalRequired: number;
          orderQty: number;
          packsToOrder: number;
          unit: string;
          costPerPack: number;
          notes?: string;
        }>;
      }>;
    };

    // 4. Create new draft purchase orders grouped by supplier
    const created: Array<{ orderId: number; supplierName: string; lineCount: number }> = [];

    for (const group of calcData.suppliers) {
      const linesWithOrder = group.lines.filter(l => l.packsToOrder > 0);
      if (linesWithOrder.length === 0) continue;

      const [order] = await db.insert(purchaseOrdersTable).values({
        supplierId: group.supplier.id,
        planId,
        status: "draft",
        notes: null,
      }).returning();

      await db.insert(purchaseOrderLinesTable).values(
        linesWithOrder.map(l => ({
          purchaseOrderId: order.id,
          ingredientId: l.ingredientId,
          quantityRequired: String(l.totalRequired),
          quantityOrdered: String(l.orderQty),
          quantityReceived: "0",
          unit: l.unit,
          unitPrice: l.costPerPack ? String(l.costPerPack) : null,
          checkedOff: false,
          notes: null,
        }))
      );

      created.push({
        orderId: order.id,
        supplierName: group.supplier.name,
        lineCount: linesWithOrder.length,
      });
    }

    res.json({
      deletedDraftOrders: deletedCount,
      createdOrders: created.length,
      orders: created,
    });
  } catch (err) {
    console.error("[Orders] Regenerate failed:", err);
    res.status(500).json({ error: "Failed to regenerate orders", detail: String(err) });
  }
});

// ── Get orders for a specific plan ───────────────────────────────────
router.get("/by-plan/:planId", async (req, res) => {
  const planId = Number(req.params.planId);
  if (!planId || isNaN(planId)) {
    res.status(400).json({ error: "Invalid planId" });
    return;
  }

  const rows = await db
    .select({
      id: purchaseOrdersTable.id,
      supplierId: purchaseOrdersTable.supplierId,
      supplierName: suppliersTable.name,
      status: purchaseOrdersTable.status,
      createdAt: purchaseOrdersTable.createdAt,
      placedAt: purchaseOrdersTable.placedAt,
      expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
      notes: purchaseOrdersTable.notes,
    })
    .from(purchaseOrdersTable)
    .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.planId, planId))
    .orderBy(desc(purchaseOrdersTable.createdAt));

  // Get line counts per order
  const orderIds = rows.map(r => r.id);
  let lineCounts: Record<number, number> = {};
  if (orderIds.length > 0) {
    const counts = await db
      .select({
        purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
        count: sql<number>`count(*)`,
      })
      .from(purchaseOrderLinesTable)
      .where(inArray(purchaseOrderLinesTable.purchaseOrderId, orderIds))
      .groupBy(purchaseOrderLinesTable.purchaseOrderId);
    for (const c of counts) {
      lineCounts[c.purchaseOrderId] = Number(c.count);
    }
  }

  res.json(rows.map(r => ({
    id: r.id,
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    placedAt: r.placedAt?.toISOString() ?? null,
    expectedDeliveryDate: r.expectedDeliveryDate,
    notes: r.notes,
    lineCount: lineCounts[r.id] ?? 0,
  })));
});

// ── Delete draft purchase orders ────────────────────────────────────
router.delete("/purchase-orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [order] = await db
    .select({ id: purchaseOrdersTable.id, status: purchaseOrdersTable.status })
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, id))
    .limit(1);

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status !== "draft") { res.status(409).json({ error: "Only draft orders can be deleted" }); return; }

  await db.delete(purchaseOrderLinesTable).where(eq(purchaseOrderLinesTable.purchaseOrderId, id));
  await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, id));
  res.status(204).send();
});

export default router;
