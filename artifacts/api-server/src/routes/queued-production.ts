// Queued test production — decide batches for a future production date long
// before the plan exists, resolve what those batches need, and order the
// unusual ingredients early (suppliers aren't used to them; new products may
// not be in stock at the supplier).
//
// Ingredient classification (Graeme, 2026-08-08): anything with a stock
// check enabled OR a kanban/cam bag is routine — normal ordering handles it.
// Everything else is a "special" ingredient the queue page lists with its
// quantity and raises purchase orders for. Orders go through the standard
// draft → place PO flow (client calls PATCH /orders/purchase-orders/:id/place
// after creating drafts here), so supplier lead times / cutoffs and the
// Orders page's inbound-PO deduction all behave exactly as normal — placing
// an early order automatically stops the same packs being suggested again.

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  queuedProductionTable,
  recipesTable,
  ingredientsTable,
  suppliersTable,
  kanbanItemsTable,
  purchaseOrdersTable,
  purchaseOrderLinesTable,
} from "@workspace/db";
import { eq, and, gte, asc, inArray, sql, ne } from "drizzle-orm";
import * as z from "zod";
import { londonDateString } from "../lib/london-time";
import { resolveRecipeIngredients, type ResolvedIngredient } from "../lib/ingredient-resolver";

const router: IRouter = Router();

const UpsertBody = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({
    recipeId: z.number().int().positive(),
    batches: z.number().int().min(1).max(200),
  })).min(1),
  notes: z.string().max(500).nullish(),
});

// GET / — every non-cancelled queue row from (roughly) today forward,
// with recipe display fields. The client groups by date.
router.get("/", async (_req, res) => {
  const from = londonDateString();
  const rows = await db
    .select({
      id: queuedProductionTable.id,
      productionDate: queuedProductionTable.productionDate,
      recipeId: queuedProductionTable.recipeId,
      batches: queuedProductionTable.batches,
      status: queuedProductionTable.status,
      planId: queuedProductionTable.planId,
      notes: queuedProductionTable.notes,
      recipeName: recipesTable.name,
      recipeColor: recipesTable.color,
      portionsPerBatch: recipesTable.portionsPerBatch,
      packSize: recipesTable.packSize,
    })
    .from(queuedProductionTable)
    .innerJoin(recipesTable, eq(queuedProductionTable.recipeId, recipesTable.id))
    .where(and(
      ne(queuedProductionTable.status, "cancelled"),
      gte(queuedProductionTable.productionDate, from),
    ))
    .orderBy(asc(queuedProductionTable.productionDate), asc(recipesTable.name));
  res.json(rows.map(r => ({
    ...r,
    portionsPerBatch: Number(r.portionsPerBatch) || 10,
    packSize: Number(r.packSize) || 1,
  })));
});

// POST / — queue (or re-queue) batches for a date. Upserts per
// (date, recipe): an existing queued row for the same recipe+date has its
// batch count replaced rather than duplicated.
router.post("/", async (req: Request, res: Response) => {
  const parsed = UpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
    return;
  }
  const { productionDate, items, notes } = parsed.data;
  const userId = req.session.userId ?? null;
  const existing = await db
    .select()
    .from(queuedProductionTable)
    .where(and(
      eq(queuedProductionTable.productionDate, productionDate),
      ne(queuedProductionTable.status, "cancelled"),
    ));
  const existingByRecipe = new Map(existing.map(r => [r.recipeId, r]));
  for (const item of items) {
    const prior = existingByRecipe.get(item.recipeId);
    if (prior) {
      await db.update(queuedProductionTable)
        .set({ batches: item.batches, notes: notes ?? prior.notes })
        .where(eq(queuedProductionTable.id, prior.id));
    } else {
      await db.insert(queuedProductionTable).values({
        productionDate,
        recipeId: item.recipeId,
        batches: item.batches,
        notes: notes ?? null,
        createdByUserId: userId,
      });
    }
  }
  res.status(201).json({ ok: true });
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const batches = Math.trunc(Number(req.body?.batches));
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(batches) || batches < 1) {
    res.status(400).json({ error: "Valid id and batches >= 1 required" });
    return;
  }
  const [row] = await db.update(queuedProductionTable)
    .set({ batches })
    .where(eq(queuedProductionTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE = cancel (soft). The row stays for the audit trail but stops
// landing on plans and stops driving ingredient requirements.
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.update(queuedProductionTable)
    .set({ status: "cancelled" })
    .where(eq(queuedProductionTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// GET /ingredients?date=YYYY-MM-DD — the ingredient picture for a date's
// queued batches. Every ingredient is returned with its classification;
// special ones additionally carry supplier info, pack maths and the
// remaining-to-order quantity after netting inbound on open POs (so a
// placed early order flips the line to "ordered" without any bookkeeping).
router.get("/ingredients", async (req, res) => {
  const date = String(req.query.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    return;
  }
  const ingredients = await fetchIngredientsForDate(date);
  ingredients.sort((a, b) => Number(a.isRoutine) - Number(b.isRoutine) || a.name.localeCompare(b.name));
  res.json({ ingredients });
});

// POST /create-orders — raise DRAFT purchase orders for the special
// ingredients still needing stock, one PO per supplier, rounded up to whole
// packs (and whole cases where the ingredient is cased). The client then
// places each through the standard PATCH /orders/purchase-orders/:id/place,
// which applies the supplier's normal lead time / cutoff — override the
// delivery date there as usual for fresh items.
router.post("/create-orders", async (req: Request, res: Response) => {
  const date = String(req.body?.productionDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "productionDate required (YYYY-MM-DD)" });
    return;
  }
  const selected: number[] | null = Array.isArray(req.body?.ingredientIds)
    ? req.body.ingredientIds.map(Number).filter(Number.isInteger)
    : null;

  // Recompute server-side — never trust client quantities.
  const ingredientsRes = await fetchIngredientsForDate(date);
  const lines = ingredientsRes.filter(i =>
    !i.isRoutine
    && i.remainingToOrder > 0
    && i.supplierId != null
    && (selected == null || selected.includes(i.ingredientId)),
  );
  if (lines.length === 0) {
    res.status(409).json({ error: "Nothing left to order — every special ingredient is routine, already inbound, or has no supplier set." });
    return;
  }
  const missingSupplier = ingredientsRes.filter(i => !i.isRoutine && i.remainingToOrder > 0 && i.supplierId == null);

  const bySupplier = new Map<number, typeof lines>();
  for (const l of lines) {
    const list = bySupplier.get(l.supplierId!) ?? [];
    list.push(l);
    bySupplier.set(l.supplierId!, list);
  }

  const created: Array<{ poId: number; supplierId: number; supplierName: string; lineCount: number }> = [];
  for (const [supplierId, supplierLines] of bySupplier) {
    const [order] = await db.insert(purchaseOrdersTable).values({
      supplierId,
      status: "draft",
      notes: `Queued test production for ${date}`,
    }).returning();
    await db.insert(purchaseOrderLinesTable).values(supplierLines.map(l => {
      // Round up to whole packs, then whole cases, like the Orders page.
      let orderQty = l.remainingToOrder;
      if (l.packWeight > 0) {
        let packs = Math.ceil(l.remainingToOrder / l.packWeight);
        if (l.caseSizePacks && l.caseSizePacks > 0) {
          packs = Math.ceil(packs / l.caseSizePacks) * l.caseSizePacks;
        }
        orderQty = Math.round(packs * l.packWeight * 100) / 100;
      }
      return {
        purchaseOrderId: order.id,
        ingredientId: l.ingredientId,
        quantityRequired: String(l.remainingToOrder),
        quantityOrdered: String(orderQty),
        quantityReceived: "0",
        unit: l.unit,
        notes: `Queued test production ${date}`,
      };
    }));
    created.push({
      poId: order.id,
      supplierId,
      supplierName: supplierLines[0].supplierName ?? `Supplier #${supplierId}`,
      lineCount: supplierLines.length,
    });
  }
  res.status(201).json({
    created,
    missingSupplier: missingSupplier.map(m => ({ ingredientId: m.ingredientId, name: m.name, required: m.required, unit: m.unit })),
  });
});

// Shared by GET /ingredients and POST /create-orders so order creation
// always works from freshly computed requirements.
async function fetchIngredientsForDate(date: string) {
  const queued = await db
    .select({
      recipeId: queuedProductionTable.recipeId,
      batches: queuedProductionTable.batches,
      portionsPerBatch: recipesTable.portionsPerBatch,
    })
    .from(queuedProductionTable)
    .innerJoin(recipesTable, eq(queuedProductionTable.recipeId, recipesTable.id))
    .where(and(
      eq(queuedProductionTable.productionDate, date),
      eq(queuedProductionTable.status, "queued"),
    ));
  if (queued.length === 0) return [];
  const totals = new Map<number, { ingredient: ResolvedIngredient; qty: number }>();
  for (const q of queued) {
    const resolved = await resolveRecipeIngredients(q.recipeId, Number(q.portionsPerBatch) || 10, { skipToppings: false });
    for (const ing of resolved) {
      const entry = totals.get(ing.ingredientId) ?? { ingredient: ing, qty: 0 };
      entry.qty += ing.quantityPerBatch * q.batches;
      totals.set(ing.ingredientId, entry);
    }
  }
  const ingredientIds = [...totals.keys()];
  if (ingredientIds.length === 0) return [];
  const ingRows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      stockCheckEnabled: ingredientsTable.stockCheckEnabled,
      supplierId: ingredientsTable.supplierId,
      packWeight: ingredientsTable.packWeight,
      caseSizePacks: ingredientsTable.caseSizePacks,
      supplierName: suppliersTable.name,
      supplierLeadTimeDays: suppliersTable.leadTimeDays,
    })
    .from(ingredientsTable)
    .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
    .where(inArray(ingredientsTable.id, ingredientIds));
  const ingById = new Map(ingRows.map(r => [r.id, r]));
  const kanbanRows = await db
    .select({ ingredientId: kanbanItemsTable.ingredientId })
    .from(kanbanItemsTable)
    .where(and(
      inArray(kanbanItemsTable.ingredientId, ingredientIds),
      ne(kanbanItemsTable.status, "archived"),
    ));
  const kanbanIds = new Set(kanbanRows.map(r => r.ingredientId));
  const openLines = await db
    .select({
      ingredientId: purchaseOrderLinesTable.ingredientId,
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
    })
    .from(purchaseOrderLinesTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderLinesTable.purchaseOrderId, purchaseOrdersTable.id))
    .where(inArray(purchaseOrdersTable.status, ["placed", "partially_received"]));
  const inboundByIngredient = new Map<number, number>();
  for (const l of openLines) {
    if (l.ingredientId == null || !totals.has(l.ingredientId)) continue;
    const remaining = Number(l.quantityOrdered) - Number(l.quantityReceived);
    if (remaining <= 0) continue;
    inboundByIngredient.set(l.ingredientId, (inboundByIngredient.get(l.ingredientId) ?? 0) + remaining);
  }
  return ingredientIds.map(iid => {
    const entry = totals.get(iid)!;
    const info = ingById.get(iid);
    const isRoutine = (info?.stockCheckEnabled ?? false) || kanbanIds.has(iid);
    const required = Math.round(entry.qty * 100) / 100;
    const inbound = Math.round((inboundByIngredient.get(iid) ?? 0) * 100) / 100;
    return {
      ingredientId: iid,
      name: info?.name ?? entry.ingredient.ingredientName,
      unit: info?.unit ?? entry.ingredient.unit,
      required,
      isRoutine,
      inbound,
      remainingToOrder: Math.max(0, Math.round((required - inbound) * 100) / 100),
      supplierId: info?.supplierId ?? null,
      supplierName: info?.supplierName ?? null,
      supplierLeadTimeDays: info?.supplierLeadTimeDays ?? null,
      packWeight: info?.packWeight != null ? Number(info.packWeight) : 0,
      caseSizePacks: info?.caseSizePacks ?? null,
    };
  });
}

export default router;
