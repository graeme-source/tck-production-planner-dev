/**
 * Standing weekly orders (Fix queue #348, Graeme 3 Nov 2026). Objective C.
 *
 *   GET /api/standing-orders/ingredients/:id
 *       → the setting (weekdays, packs), its "Every Fri" label, the pack
 *         size and the supplier's order days, for the kanban settings card.
 *   PUT /api/standing-orders/ingredients/:id  { weekdays, packs }
 *       → autosave from that card. No days or 0 packs = off.
 *   POST /api/standing-orders/not-today  { ingredientId }
 *       → "Not today" on the Orders page: off the page until the next
 *         chosen weekday.
 *
 * Dedicated because PUT /api/ingredients/:id rewrites the whole row. The
 * order engine reads the columns only through the standing-order helpers
 * in @workspace/business-days (lib/standing-orders.ts).
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, ingredientsTable, suppliersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  MAX_STANDING_ORDER_PACKS,
  parseStandingWeekdays,
  standingOrderFrom,
  standingOrderLabel,
} from "@workspace/business-days";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";
import { markStandingSkipped } from "../lib/standing-orders";

const router: IRouter = Router();

const PutBody = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  packs: z.number().int().min(0).max(MAX_STANDING_ORDER_PACKS),
});

const NotTodayBody = z.object({
  ingredientId: z.number().int().positive(),
});

async function load(id: number) {
  const [row] = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      unit: ingredientsTable.unit,
      packWeight: ingredientsTable.packWeight,
      packName: ingredientsTable.packName,
      standingOrderWeekdays: ingredientsTable.standingOrderWeekdays,
      standingOrderPacks: ingredientsTable.standingOrderPacks,
      supplierId: suppliersTable.id,
      supplierName: suppliersTable.name,
      orderFrequency: suppliersTable.orderFrequency,
      orderDays: suppliersTable.orderDays,
    })
    .from(ingredientsTable)
    .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
    .where(eq(ingredientsTable.id, id))
    .limit(1);
  if (!row) return null;
  const s = standingOrderFrom(row);
  return {
    ingredientId: row.id,
    name: row.name,
    weekdays: s.weekdays,
    packs: s.packs,
    label: standingOrderLabel(s.weekdays),
    unit: row.unit,
    packWeight: Number(row.packWeight) || 0,
    packName: row.packName ?? null,
    // Order days let the card warn about a chosen day the supplier's card
    // never shows on (standingDaysSupplierSkips, weekly suppliers).
    supplier: row.supplierId != null
      ? { id: row.supplierId, name: row.supplierName, orderFrequency: row.orderFrequency, orderDays: row.orderDays }
      : null,
  };
}

function idParam(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/ingredients/:id", async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  try {
    const out = await load(id);
    if (!out) { res.status(404).json({ error: "Ingredient not found" }); return; }
    res.json(out);
  } catch (err) {
    console.error("[StandingOrders] load failed:", err);
    res.status(500).json({ error: "Couldn't load the standing order" });
  }
});

router.put("/ingredients/:id", requireManagerOrAdmin, validate(PutBody), async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  const body = req.body as z.infer<typeof PutBody>;
  const weekdays = parseStandingWeekdays(body.weekdays);
  try {
    const [row] = await db.update(ingredientsTable)
      .set({
        // Stored as NULL when off, so "has a standing order" is one test.
        standingOrderWeekdays: weekdays.length > 0 ? weekdays : null,
        standingOrderPacks: body.packs > 0 ? body.packs : null,
      })
      .where(eq(ingredientsTable.id, id))
      .returning({ id: ingredientsTable.id });
    if (!row) { res.status(404).json({ error: "Ingredient not found" }); return; }
    res.json(await load(id));
  } catch (err) {
    console.error("[StandingOrders] save failed:", err);
    res.status(500).json({ error: "Couldn't save the standing order" });
  }
});

router.post("/not-today", validate(NotTodayBody), async (req, res) => {
  const { ingredientId } = req.body as z.infer<typeof NotTodayBody>;
  const userId = req.session.userId ?? null;
  try {
    const [user] = userId ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)) : [];
    await markStandingSkipped(ingredientId, { userId, name: user?.name ?? null });
    res.json({ ok: true });
  } catch (err) {
    console.error("[StandingOrders] not-today failed:", err);
    res.status(500).json({ error: "Couldn't take it off today's order" });
  }
});

export default router;
