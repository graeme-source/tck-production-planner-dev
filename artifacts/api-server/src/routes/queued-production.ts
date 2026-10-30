// Queued test production — decide batches for a future production date long
// before the plan exists, resolve what those batches need, and order the
// unusual ingredients early (suppliers aren't used to them; new products may
// not be in stock at the supplier).
//
// Ingredient classification (Graeme, 2026-08-08): anything with a stock
// check enabled OR a kanban/cam bag is routine — normal ordering handles it.
// Everything else is a "special" ingredient the queue page lists with its
// quantity and raises purchase orders for. Since 30 Oct 2026 a routine
// ingredient is listed too when the test would run it out (counted stock
// short, or a kanban item the test needs a lot of — the Malbec and crispy
// bacon were missed): rules in lib/queued-production-rules.ts. Orders go through the standard
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
  purchaseOrderLinesTable, recipePackSizeOrOne, queuedIngredientMarksTable, usersTable,
} from "@workspace/db";
import { eq, and, gte, asc, inArray, sql, ne } from "drizzle-orm";
import * as z from "zod";
import { londonDateString } from "../lib/london-time";
import { resolveRecipeIngredients, type ResolvedIngredient } from "../lib/ingredient-resolver";
import { validate, validateQuery } from "../middleware/validate";
import { queueSales } from "../lib/queued-production-sales";
import { RECENT_DAYS, classifyIngredientNeed, outstanding, type IngredientMark } from "../lib/queued-production-rules";
import { deliverByFor, orderByFor } from "../lib/queued-production-sales";
import { loadStockLedgers } from "../lib/stock-ledger-data";
import { expectedAt, rollForward } from "../lib/stock-ledger";

const router: IRouter = Router();

const DAY_MS = 86_400_000;

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
      packSize: recipePackSizeOrOne,
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

// GET /sales?productionDate=&deliveryDate=&refresh=1 — packs sold for the
// delivery this production serves (made Wednesday → Friday's orders unless
// another delivery date is given), with the suggested batches: sold + 5
// packs, rounded up to whole batches (queued-production-rules.ts).
const SalesQuery = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  refresh: z.enum(["0", "1"]).optional(),
});
router.get("/sales", validateQuery(SalesQuery), async (_req, res) => {
  const q = res.locals["query"] as z.infer<typeof SalesQuery>;
  res.json(await queueSales(q.productionDate, q.deliveryDate ?? null, q.refresh === "1"));
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
  ingredients.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
  res.json({ deliverBy: deliverByFor(date), ingredients });
});

// GET /outstanding — every upcoming queued day with ingredients still to
// order, for the Orders page: they come up every day until ordered or
// ticked off (Graeme, 30 Oct 2026).
router.get("/outstanding", async (_req, res) => {
  const dates = await db.selectDistinct({ d: queuedProductionTable.productionDate }).from(queuedProductionTable)
    .where(and(eq(queuedProductionTable.status, "queued"), gte(queuedProductionTable.productionDate, londonDateString())))
    .orderBy(asc(queuedProductionTable.productionDate));
  const days = [];
  for (const { d } of dates) {
    const lines = (await fetchIngredientsForDate(d)).filter(i => outstanding(i.status, i.remainingToOrder, i.mark));
    if (lines.length === 0) continue;
    days.push({
      productionDate: d,
      deliverBy: deliverByFor(d),
      lines: lines.map(i => ({ ingredientId: i.ingredientId, name: i.name, toOrder: i.remainingToOrder, unit: i.unit, supplierName: i.supplierName, orderBy: i.orderBy }))
        .sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.name.localeCompare(b.name)),
    });
  }
  res.json({ days });
});

// PUT /mark — tick an ingredient ordered or not needed for a day, or clear it.
const MarkBody = z.object({
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ingredientId: z.number().int().positive(),
  mark: z.enum(["ordered", "not_needed"]).nullable(),
});
router.put("/mark", validate(MarkBody), async (req: Request, res: Response) => {
  const { productionDate, ingredientId, mark } = MarkBody.parse(req.body);
  if (mark == null) {
    await db.delete(queuedIngredientMarksTable).where(and(
      eq(queuedIngredientMarksTable.productionDate, productionDate), eq(queuedIngredientMarksTable.ingredientId, ingredientId)));
  } else {
    await writeMarks(productionDate, [{ ingredientId, mark, poId: null }], req.session.userId ?? null);
  }
  res.json({ ok: true });
});

async function writeMarks(productionDate: string, marks: Array<{ ingredientId: number; mark: IngredientMark; poId: number | null }>, userId: number | null) {
  if (marks.length === 0) return;
  const [user] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
  await db.insert(queuedIngredientMarksTable)
    .values(marks.map(m => ({ productionDate, ingredientId: m.ingredientId, mark: m.mark, poId: m.poId, markedByUserId: userId, markedByName: user?.name ?? null })))
    .onConflictDoUpdate({
      target: [queuedIngredientMarksTable.productionDate, queuedIngredientMarksTable.ingredientId],
      set: { mark: sql`excluded.mark`, poId: sql`excluded.po_id`, markedByUserId: sql`excluded.marked_by_user_id`, markedByName: sql`excluded.marked_by_name`, markedAt: sql`now()` },
    });
}

const STATUS_ORDER = { special: 0, short: 1, check: 2, covered: 3 } as const;

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
  // Only what's still to order and ticked for today's order; the rest
  // stays on the list for another day.
  const wanted = (i: (typeof ingredientsRes)[number]) =>
    outstanding(i.status, i.remainingToOrder, i.mark) && (selected == null || selected.includes(i.ingredientId));
  const lines = ingredientsRes.filter(i => wanted(i) && i.supplierId != null);
  if (lines.length === 0) {
    res.status(409).json({ error: "Nothing to order — it's already ordered, not needed, or has no supplier set." });
    return;
  }
  const missingSupplier = ingredientsRes.filter(i => wanted(i) && i.supplierId == null);

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
    await writeMarks(date, supplierLines.map(l => ({ ingredientId: l.ingredientId, mark: "ordered" as const, poId: order.id })), req.session.userId ?? null);
    created.push({
      poId: order.id,
      supplierId,
      supplierName: supplierLines[0].supplierName ?? `Supplier #${supplierId}`,
      lineCount: supplierLines.length,
    });
  }
  res.status(201).json({
    deliverBy: deliverByFor(date),
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
  // Recipes resolve side by side — one after another was slow on live.
  const resolvedAll = await Promise.all(queued.map(q => resolveRecipeIngredients(q.recipeId, Number(q.portionsPerBatch) || 10, { skipToppings: false })));
  for (const [n, q] of queued.entries()) {
    const resolved = resolvedAll[n];
    for (const ing of resolved) {
      const entry = totals.get(ing.ingredientId) ?? { ingredient: ing, qty: 0 };
      entry.qty += ing.quantityPerBatch * q.batches;
      totals.set(ing.ingredientId, entry);
    }
  }
  const ingredientIds = [...totals.keys()];
  if (ingredientIds.length === 0) return [];
  // Everything below reads independently — run it side by side.
  const now = new Date();
  const recentSince = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const [ingRows, kanbanRows, openLines, ledgers, recentRows, markRows] = await Promise.all([
    db.select({
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
      .where(inArray(ingredientsTable.id, ingredientIds)),
    db.select({ ingredientId: kanbanItemsTable.ingredientId })
      .from(kanbanItemsTable)
      .where(and(inArray(kanbanItemsTable.ingredientId, ingredientIds), ne(kanbanItemsTable.status, "archived"))),
    db.select({
      ingredientId: purchaseOrderLinesTable.ingredientId,
      quantityOrdered: purchaseOrderLinesTable.quantityOrdered,
      quantityReceived: purchaseOrderLinesTable.quantityReceived,
    })
      .from(purchaseOrderLinesTable)
      .innerJoin(purchaseOrdersTable, eq(purchaseOrderLinesTable.purchaseOrderId, purchaseOrdersTable.id))
      .where(and(inArray(purchaseOrdersTable.status, ["placed", "partially_received"]), inArray(purchaseOrderLinesTable.ingredientId, ingredientIds))),
    // Running stock and normal weekly use, so a routine ingredient the test
    // would run out (the Malbec, the crispy bacon) is listed too.
    loadStockLedgers({ since: new Date(now.getTime() - 120 * DAY_MS), until: now, ingredientIds }),
    // Ordered in the last month (a placed order, not one the queue made).
    db.selectDistinct({ ingredientId: purchaseOrderLinesTable.ingredientId })
      .from(purchaseOrderLinesTable)
      .innerJoin(purchaseOrdersTable, eq(purchaseOrderLinesTable.purchaseOrderId, purchaseOrdersTable.id))
      .where(and(
        inArray(purchaseOrderLinesTable.ingredientId, ingredientIds),
        inArray(purchaseOrdersTable.status, ["placed", "partially_received", "received"]),
        gte(sql`COALESCE(${purchaseOrdersTable.placedAt}, ${purchaseOrdersTable.createdAt})`, recentSince),
        sql`COALESCE(${purchaseOrdersTable.notes}, '') NOT LIKE 'Queued test production%'`,
      )),
    db.select().from(queuedIngredientMarksTable).where(eq(queuedIngredientMarksTable.productionDate, date)),
  ]);
  const ingById = new Map(ingRows.map(r => [r.id, r]));
  const kanbanIds = new Set(kanbanRows.map(r => r.ingredientId));
  const inboundByIngredient = new Map<number, number>();
  for (const l of openLines) {
    if (l.ingredientId == null || !totals.has(l.ingredientId)) continue;
    const remaining = Number(l.quantityOrdered) - Number(l.quantityReceived);
    if (remaining <= 0) continue;
    inboundByIngredient.set(l.ingredientId, (inboundByIngredient.get(l.ingredientId) ?? 0) + remaining);
  }
  const recentlyOrdered = new Set(recentRows.map(r => r.ingredientId));
  const marks = new Map(markRows.map(m => [m.ingredientId, m]));
  const deliverBy = deliverByFor(date);
  return ingredientIds.map(iid => {
    const entry = totals.get(iid)!;
    const info = ingById.get(iid);
    const isRoutine = (info?.stockCheckEnabled ?? false) || kanbanIds.has(iid);
    const required = Math.round(entry.qty * 100) / 100;
    const inbound = Math.round((inboundByIngredient.get(iid) ?? 0) * 100) / 100;
    const ledger = ledgers.get(iid)?.ledger;
    const tracked = ledger != null && ledger.coverage !== "untracked";
    const expected = tracked ? expectedAt(ledger, now.getTime()) : null;
    const stockNow = expected ? Math.round(Math.max(0, expected.expected) * 100) / 100 : null;
    const weeklyUse = tracked ? Math.round((rollForward(ledger, now.getTime() - RECENT_DAYS * DAY_MS, now.getTime()).usage * 7 / RECENT_DAYS) * 100) / 100 : null;
    const need = classifyIngredientNeed({
      required, inbound, isRoutine, stockNow, weeklyUse,
      recentlyOrdered: recentlyOrdered.has(iid),
      recentlyUsed: (weeklyUse ?? 0) > 0,
    });
    const m = marks.get(iid);
    return {
      status: need.status,
      reason: need.reason,
      mark: (m?.mark ?? null) as IngredientMark | null,
      markedBy: m?.markedByName ?? null,
      markedAt: m?.markedAt ? m.markedAt.toISOString() : null,
      markedPoId: m?.poId ?? null,
      orderBy: orderByFor(deliverBy, info?.supplierLeadTimeDays ?? null),
      stockNow,
      weeklyUse,
      ingredientId: iid,
      name: info?.name ?? entry.ingredient.ingredientName,
      unit: info?.unit ?? entry.ingredient.unit,
      required,
      isRoutine,
      inbound,
      remainingToOrder: need.toOrder,
      supplierId: info?.supplierId ?? null,
      supplierName: info?.supplierName ?? null,
      supplierLeadTimeDays: info?.supplierLeadTimeDays ?? null,
      packWeight: info?.packWeight != null ? Number(info.packWeight) : 0,
      caseSizePacks: info?.caseSizePacks ?? null,
    };
  });
}

export default router;
