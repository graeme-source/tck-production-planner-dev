// Recording a delivery we weren't expecting (Graeme, 2026-09-25).
//
// A supplier sends something nobody booked in the app — a back order, an
// auto-generated repeat order — and it turns up at the door. This router is
// the three-step front-door flow:
//
//   GET  /catalogue            everything that can be delivered, for the
//                              search box (items + supplies + suppliers)
//   POST /matches              "Is it one of these?" — open orders the
//                              delivery could really be, any day
//   POST /:id/arrived-today    "Yes, that one" — move that open order to
//                              today, then it's received the normal way
//   POST /                     "No, it's a different delivery" — create a
//                              new purchase order (origin 'unexpected', due
//                              today), then it's received the normal way
//
// Nothing here receives goods or touches stock. Both paths end in the
// existing goods-in receive (POST /api/deliveries/:id/receive), so an
// unexpected delivery gets exactly the same use-by, temperature and
// quantity checks and the same stock update as any other — once.
//
// Mounted at /api/deliveries/unexpected BEFORE the deliveries router, so
// "unexpected" is never read as a purchase-order id by GET /:id there.
// Objectives C (stock stays right) and D (goods-in checks every time).

import { Router, type IRouter } from "express";
import * as z from "zod";
import {
  db,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
  suppliersTable,
  ingredientsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { validate } from "../middleware/validate";
import { requireFeature } from "../lib/feature-access";
import { londonDateString } from "../lib/london-time";
import {
  arrivedTodayChange,
  buildUnexpectedPurchaseOrder,
  rankOpenOrderMatches,
  type CatalogueItemInfo,
  type OpenOrderCandidate,
} from "../lib/unexpected-delivery";

const router: IRouter = Router();

// Same audience as receiving a normal delivery (page "Receive Deliveries",
// viewer by default, adjustable in Team & Access).
const canReceive = requireFeature("page.deliveries_receive");

// ─── Catalogue ──────────────────────────────────────────────────────────────

router.get("/catalogue", canReceive, async (_req, res) => {
  try {
    const secondary = alias(suppliersTable, "secondary_supplier");
    const [items, suppliers] = await Promise.all([
      db
        .select({
          id: ingredientsTable.id,
          name: ingredientsTable.name,
          category: ingredientsTable.category,
          unit: ingredientsTable.unit,
          packWeight: ingredientsTable.packWeight,
          costPerPack: ingredientsTable.costPerPack,
          stockInPacks: ingredientsTable.stockInPacks,
          brand: ingredientsTable.brand,
          supplierPartNumber: ingredientsTable.supplierPartNumber,
          supplierId: ingredientsTable.supplierId,
          supplierName: suppliersTable.name,
          secondarySupplierId: ingredientsTable.secondarySupplierId,
          secondarySupplierName: secondary.name,
          perishable: ingredientsTable.perishable,
          requiresUseByDate: ingredientsTable.requiresUseByDate,
        })
        .from(ingredientsTable)
        .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
        .leftJoin(secondary, eq(ingredientsTable.secondarySupplierId, secondary.id))
        .orderBy(asc(ingredientsTable.name)),
      db
        .select({ id: suppliersTable.id, name: suppliersTable.name })
        .from(suppliersTable)
        .orderBy(asc(suppliersTable.name)),
    ]);

    res.json({
      suppliers,
      items: items.map(i => ({
        ...i,
        packWeight: Number(i.packWeight) || 0,
        costPerPack: Number(i.costPerPack) || 0,
      })),
    });
  } catch (err) {
    console.error("[unexpected-deliveries] catalogue failed:", err);
    res.status(500).json({ error: "Couldn't load the items list" });
  }
});

// ─── "Is it one of these?" ─────────────────────────────────────────────────

const MatchesBody = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  ingredientIds: z.array(z.number().int().positive()).max(200).default([]),
});

router.post("/matches", canReceive, validate(MatchesBody), async (req, res) => {
  try {
    const { supplierId = null, ingredientIds } = req.body as z.infer<typeof MatchesBody>;
    if (supplierId == null && ingredientIds.length === 0) {
      res.json({ today: londonDateString(), matches: [] });
      return;
    }

    // Open = placed and not yet received, whatever day it was booked for.
    // ('partially_received' is a legacy status the app treats as received.)
    const byItem = ingredientIds.length > 0
      ? db
          .selectDistinct({ id: purchaseOrderLinesTable.purchaseOrderId })
          .from(purchaseOrderLinesTable)
          .where(inArray(purchaseOrderLinesTable.ingredientId, ingredientIds))
      : null;

    const conditions = [
      supplierId != null ? eq(purchaseOrdersTable.supplierId, supplierId) : undefined,
      byItem ? inArray(purchaseOrdersTable.id, byItem) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c != null);

    const orders = await db
      .select({
        id: purchaseOrdersTable.id,
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: suppliersTable.name,
        expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
        origin: purchaseOrdersTable.origin,
      })
      .from(purchaseOrdersTable)
      .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
      .where(and(eq(purchaseOrdersTable.status, "placed"), or(...conditions)));

    const ids = orders.map(o => o.id);
    const lines = ids.length === 0 ? [] : await db
      .select({
        purchaseOrderId: purchaseOrderLinesTable.purchaseOrderId,
        ingredientId: purchaseOrderLinesTable.ingredientId,
        ingredientName: ingredientsTable.name,
        description: purchaseOrderLinesTable.description,
        quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
        unit: purchaseOrderLinesTable.unit,
        nativeUnit: ingredientsTable.unit,
        packWeight: ingredientsTable.packWeight,
        stockInPacks: ingredientsTable.stockInPacks,
      })
      .from(purchaseOrderLinesTable)
      .leftJoin(ingredientsTable, eq(purchaseOrderLinesTable.ingredientId, ingredientsTable.id))
      .where(inArray(purchaseOrderLinesTable.purchaseOrderId, ids));

    const linesByOrder = new Map<number, typeof lines>();
    for (const l of lines) {
      const list = linesByOrder.get(l.purchaseOrderId) ?? [];
      list.push(l);
      linesByOrder.set(l.purchaseOrderId, list);
    }

    const originById = new Map(orders.map(o => [o.id, o.origin]));
    const candidates: OpenOrderCandidate[] = orders.map(o => ({
      id: o.id,
      supplierId: o.supplierId,
      supplierName: o.supplierName,
      expectedDeliveryDate: o.expectedDeliveryDate,
      lines: (linesByOrder.get(o.id) ?? []).map(l => ({
        ingredientId: l.ingredientId,
        name: l.ingredientName ?? l.description ?? "Miscellaneous item",
        quantityOrdered: Number(l.quantityOrdered),
        unit: l.unit,
      })),
    }));

    const today = londonDateString();
    const ranked = rankOpenOrderMatches(candidates, { supplierId, ingredientIds }, today);

    res.json({
      today,
      matches: ranked.map(m => ({
        ...m,
        origin: originById.get(m.id) ?? "planned",
        // Re-sent with the extra fields the card needs to show pack sizes
        // the same way the deliveries list does.
        lines: (linesByOrder.get(m.id) ?? []).map(l => ({
          ingredientId: l.ingredientId,
          name: l.ingredientName ?? l.description ?? "Miscellaneous item",
          quantityOrdered: Number(l.quantityOrdered),
          unit: l.unit,
          nativeUnit: l.nativeUnit,
          packWeight: l.packWeight != null ? Number(l.packWeight) : null,
          stockInPacks: l.stockInPacks ?? false,
        })),
      })),
    });
  } catch (err) {
    console.error("[unexpected-deliveries] matches failed:", err);
    res.status(500).json({ error: "Couldn't search the open orders" });
  }
});

// ─── "Yes, it's that one" ──────────────────────────────────────────────────

const ArrivedTodayBody = z.object({}).optional().default({});

router.post("/:id/arrived-today", canReceive, validate(ArrivedTodayBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid order id" }); return; }
  try {
    const [order] = await db
      .select({
        id: purchaseOrdersTable.id,
        status: purchaseOrdersTable.status,
        expectedDeliveryDate: purchaseOrdersTable.expectedDeliveryDate,
        originallyExpectedDate: purchaseOrdersTable.originallyExpectedDate,
      })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, id));
    if (!order) { res.status(404).json({ error: "Purchase order not found" }); return; }

    const today = londonDateString();
    const decision = arrivedTodayChange(order, today);
    if (!decision.ok) { res.status(409).json({ error: decision.error }); return; }

    if (decision.change) {
      await db
        .update(purchaseOrdersTable)
        .set(decision.change)
        .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.status, "placed")));
    }
    res.json({
      id,
      expectedDeliveryDate: decision.change?.expectedDeliveryDate ?? order.expectedDeliveryDate,
      originallyExpectedDate: decision.change?.originallyExpectedDate ?? order.originallyExpectedDate,
      moved: decision.change != null,
    });
  } catch (err) {
    console.error("[unexpected-deliveries] arrived-today failed:", err);
    res.status(500).json({ error: "Couldn't move that order to today" });
  }
});

// ─── "No, it's a different delivery" ───────────────────────────────────────

const BasketLineBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item"),
    ingredientId: z.number().int().positive(),
    quantity: z.number().positive().max(100000),
    unitPrice: z.number().min(0).max(1000000).nullable().optional(),
  }),
  z.object({
    kind: z.literal("misc"),
    description: z.string().trim().min(1).max(500),
    quantity: z.number().positive().max(100000),
    unit: z.string().trim().max(40).nullable().optional(),
    unitPrice: z.number().min(0).max(1000000).nullable().optional(),
  }),
]);

const CreateBody = z.object({
  supplierId: z.number().int().positive(),
  lines: z.array(BasketLineBody).min(1).max(100),
  notes: z.string().max(1000).nullable().optional(),
});

router.post("/", canReceive, validate(CreateBody), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof CreateBody>;

    const [supplier] = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, body.supplierId));
    if (!supplier) { res.status(400).json({ error: "That supplier isn't in the system" }); return; }

    const itemIds = [...new Set(body.lines.flatMap(l => (l.kind === "item" ? [l.ingredientId] : [])))];
    const catalogue = new Map<number, CatalogueItemInfo>();
    if (itemIds.length > 0) {
      const rows = await db
        .select({
          id: ingredientsTable.id,
          name: ingredientsTable.name,
          unit: ingredientsTable.unit,
          packWeight: ingredientsTable.packWeight,
          costPerPack: ingredientsTable.costPerPack,
        })
        .from(ingredientsTable)
        .where(inArray(ingredientsTable.id, itemIds));
      for (const r of rows) catalogue.set(r.id, r);
    }

    const built = buildUnexpectedPurchaseOrder(body, catalogue, {
      today: londonDateString(),
      now: new Date(),
      userId: req.session.userId ?? null,
    });
    if (!built.ok) { res.status(400).json({ error: built.error }); return; }

    const created = await db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrdersTable).values(built.value.order).returning();
      await tx.insert(purchaseOrderLinesTable).values(
        built.value.lines.map(l => ({ ...l, purchaseOrderId: po.id })),
      );
      return po;
    });

    res.status(201).json({
      id: created.id,
      supplierId: created.supplierId,
      status: created.status,
      origin: created.origin,
      expectedDeliveryDate: created.expectedDeliveryDate,
    });
  } catch (err) {
    console.error("[unexpected-deliveries] create failed:", err);
    res.status(500).json({ error: "Couldn't record the delivery" });
  }
});

export default router;
