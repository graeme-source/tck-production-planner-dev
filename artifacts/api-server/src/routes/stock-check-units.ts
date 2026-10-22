/**
 * The unit each item is stock-checked in (Graeme, 19 Oct 2026). Objective F.
 *
 *   GET /api/stock-check-units
 *       → { items: { [ingredientId]: { unit, packWeight, stockInPacks,
 *            stockCheckUnit, resolved } } }
 *         Every ingredient, so the shared stock-check entry can say "This
 *         stock check must be recorded in KILOGRAMS" wherever it is opened
 *         from (prep screens, the Orders page) without every caller passing
 *         the setting through. `resolved` is the unit actually used
 *         (resolveStockCheckUnit — the manager's choice, else the default).
 *   PUT /api/stock-check-units/:id  { stockCheckUnit?: 'g'|'kg'|'packs'|'native'|null,
 *                                     packName?: 'box'|'roll'|…|null }
 *       → managers/admins; autosave from the ingredient form. null = the
 *         default rule / "pack". A unit that doesn't fit the item is refused.
 *         packName (#327, 22 Oct 2026) is what the pack is called on every
 *         stock check, goods-in, order and kanban ("Count BOXES").
 *
 * Counts are still SAVED by the existing endpoints in the ingredient's own
 * unit — the entry converts first (stockCountToNative, @workspace/units).
 * Dedicated because PUT /api/ingredients/:id rewrites the whole row.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db, ingredientsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { PACK_NAMES, STOCK_CHECK_UNITS, isPackName, resolveStockCheckUnit, stockCheckUnitOptions } from "@workspace/units";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin } from "../middleware/roles";

const router: IRouter = Router();

const PutBody = z.object({
  stockCheckUnit: z.enum(STOCK_CHECK_UNITS).nullable().optional(),
  packName: z.enum(PACK_NAMES).nullable().optional(),
}).refine(b => b.stockCheckUnit !== undefined || b.packName !== undefined, { message: "Send stockCheckUnit and/or packName" });

const cols = {
  id: ingredientsTable.id,
  unit: ingredientsTable.unit,
  packWeight: ingredientsTable.packWeight,
  stockInPacks: ingredientsTable.stockInPacks,
  stockCheckUnit: ingredientsTable.stockCheckUnit,
  packName: ingredientsTable.packName,
  requiresUseByDate: ingredientsTable.requiresUseByDate,
};

type Row = { id: number; unit: string; packWeight: string | null; stockInPacks: boolean; stockCheckUnit: string | null; packName: string | null; requiresUseByDate: boolean };

function shape(r: Row) {
  const item = {
    unit: r.unit,
    packWeight: r.packWeight != null ? Number(r.packWeight) : null,
    stockInPacks: r.stockInPacks,
    stockCheckUnit: r.stockCheckUnit,
    packName: isPackName(r.packName) ? r.packName : null,
  };
  // requiresUseByDate: the stock check offers an optional use-by (#165).
  return { ...item, requiresUseByDate: r.requiresUseByDate, resolved: resolveStockCheckUnit(item), options: stockCheckUnitOptions(item) };
}

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select(cols).from(ingredientsTable);
    const items: Record<string, ReturnType<typeof shape>> = {};
    for (const r of rows) items[String(r.id)] = shape(r);
    res.json({ items });
  } catch (err) {
    console.error("[StockCheckUnits] load failed:", err);
    res.status(500).json({ error: "Couldn't load stock-check units" });
  }
});

router.put("/:id", requireManagerOrAdmin, validate(PutBody), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ingredient id" }); return; }
  const { stockCheckUnit, packName } = req.body as z.infer<typeof PutBody>;
  if (stockCheckUnit === undefined && packName === undefined) {
    res.status(400).json({ error: "Send stockCheckUnit and/or packName" });
    return;
  }
  try {
    const [row] = await db.select(cols).from(ingredientsTable).where(eq(ingredientsTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ error: "Ingredient not found" }); return; }
    if (stockCheckUnit != null && stockCheckUnit !== undefined) {
      const options = stockCheckUnitOptions({ unit: row.unit, packWeight: row.packWeight, stockInPacks: row.stockInPacks });
      if (!options.includes(stockCheckUnit)) {
        res.status(400).json({ error: `This item can't be stock-checked in ${stockCheckUnit} — choose one of: ${options.join(", ")}` });
        return;
      }
    }
    const [saved] = await db.update(ingredientsTable)
      .set({
        ...(stockCheckUnit !== undefined ? { stockCheckUnit } : {}),
        ...(packName !== undefined ? { packName } : {}),
      })
      .where(eq(ingredientsTable.id, id))
      .returning(cols);
    res.json({ id, ...shape(saved!) });
  } catch (err) {
    console.error("[StockCheckUnits] save failed:", err);
    res.status(500).json({ error: "Couldn't save the stock-check unit" });
  }
});

export default router;
