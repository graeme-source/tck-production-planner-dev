/**
 * Surplus by delivery day (Graeme, 14 Oct 2026). Objective C.
 *
 *   GET /api/ingredients/:id/surplus-by-delivery-day
 *       → the setting, the normal surplus, and the primary supplier's lead
 *         time + cut-off so the settings card can preview "Orders placed
 *         Fri → delivered Mon: 130% · …" from the supplier's real pattern.
 *   PUT /api/ingredients/:id/surplus-by-delivery-day  { byWeekday }
 *       → autosave from that card. byWeekday is { "1"…"7": % | null };
 *         null / {} switches the feature off (normal surplus every day).
 *
 * Dedicated because PUT /api/ingredients/:id rewrites the whole row. The
 * order engine reads the column only through surplusFor
 * (@workspace/business-days).
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, ingredientsTable, suppliersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { parseSurplusByDeliveryWeekday, MAX_DAY_SURPLUS_PERCENT } from "@workspace/business-days";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

const router: IRouter = Router();

const DayPct = z.number().finite().min(0).max(MAX_DAY_SURPLUS_PERCENT).nullable().optional();
const PutBody = z.object({
  byWeekday: z.object({
    "1": DayPct, "2": DayPct, "3": DayPct, "4": DayPct, "5": DayPct, "6": DayPct, "7": DayPct,
  }).strict().nullable(),
});

async function load(id: number) {
  const [row] = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      surplusPercent: ingredientsTable.surplusPercent,
      surplusMode: ingredientsTable.surplusMode,
      surplusByDeliveryWeekday: ingredientsTable.surplusByDeliveryWeekday,
      supplierId: suppliersTable.id,
      supplierName: suppliersTable.name,
      leadTimeDays: suppliersTable.leadTimeDays,
      cutoffTime: suppliersTable.cutoffTime,
    })
    .from(ingredientsTable)
    .leftJoin(suppliersTable, eq(ingredientsTable.supplierId, suppliersTable.id))
    .where(eq(ingredientsTable.id, id))
    .limit(1);
  if (!row) return null;
  return {
    ingredientId: row.id,
    name: row.name,
    surplusPercent: Number(row.surplusPercent),
    surplusMode: row.surplusMode === "absolute" ? "absolute" : "percent",
    byWeekday: parseSurplusByDeliveryWeekday(row.surplusByDeliveryWeekday),
    supplier: row.supplierId != null
      ? { id: row.supplierId, name: row.supplierName, leadTimeDays: row.leadTimeDays ?? 1, cutoffTime: row.cutoffTime ?? "17:00" }
      : null,
  };
}

router.get("/:id/surplus-by-delivery-day", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  try {
    const out = await load(id);
    if (!out) { res.status(404).json({ error: "Ingredient not found" }); return; }
    res.json(out);
  } catch (err) {
    console.error("[DeliverySurplus] load failed:", err);
    res.status(500).json({ error: "Couldn't load the delivery-day surplus" });
  }
});

router.put("/:id/surplus-by-delivery-day", requireManagerOrAdmin, validate(PutBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  const body = req.body as z.infer<typeof PutBody>;
  // Normalise through the same parser the order engine reads with: blanks
  // dropped, an empty map stored as NULL (= feature off).
  const clean = parseSurplusByDeliveryWeekday(body.byWeekday);
  try {
    const [row] = await db.update(ingredientsTable)
      .set({ surplusByDeliveryWeekday: clean })
      .where(eq(ingredientsTable.id, id))
      .returning({ id: ingredientsTable.id });
    if (!row) { res.status(404).json({ error: "Ingredient not found" }); return; }
    res.json(await load(id));
  } catch (err) {
    console.error("[DeliverySurplus] save failed:", err);
    res.status(500).json({ error: "Couldn't save the delivery-day surplus" });
  }
});

export default router;
