/**
 * Use-by date on a stock check (fix-queue #165, Jane: milk and cream at the
 * prep station; Graeme approved 22 Oct 2026). Objective D via C.
 *
 *   PUT /api/stock-check-use-by  { ingredientId, checkDate, useByDate | null }
 *       Sets (or clears) the use-by on that day's count. The count itself
 *       is saved first by the usual endpoints — this only adds the date, so
 *       the stock maths and those endpoints are unchanged. Only for
 *       ingredients with "Require use-by date" ticked.
 *   GET /api/stock-check-use-by?checkDate=YYYY-MM-DD
 *       → { checkDate, useBy: { [ingredientId]: "YYYY-MM-DD" } }
 *
 * Its own file because production-plans.ts (where counts are saved) takes
 * no new code. Migration 0243.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, dailyStockChecksTable, ingredientsTable } from "@workspace/db";
import { validate, validateQuery } from "../middleware/validate";

const router: IRouter = Router();

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const PutBody = z.object({
  ingredientId: z.number().int().positive(),
  checkDate: ISO,
  useByDate: ISO.nullable(),
});

router.put("/", validate(PutBody), async (req, res) => {
  const { ingredientId, checkDate, useByDate } = req.body as z.infer<typeof PutBody>;
  try {
    const [ing] = await db
      .select({ requiresUseByDate: ingredientsTable.requiresUseByDate })
      .from(ingredientsTable)
      .where(eq(ingredientsTable.id, ingredientId));
    if (!ing) { res.status(404).json({ error: "Ingredient not found" }); return; }
    if (!ing.requiresUseByDate) {
      res.status(400).json({ error: "This item doesn't take a use-by date — tick “Require use-by date” on the ingredient first." });
      return;
    }
    const [row] = await db
      .update(dailyStockChecksTable)
      .set({ useByDate })
      .where(and(eq(dailyStockChecksTable.ingredientId, ingredientId), eq(dailyStockChecksTable.checkDate, checkDate)))
      .returning({ id: dailyStockChecksTable.id, useByDate: dailyStockChecksTable.useByDate });
    if (!row) {
      res.status(409).json({ error: "Record the count first, then the use-by date." });
      return;
    }
    res.json({ ingredientId, checkDate, useByDate: row.useByDate ?? null });
  } catch (err) {
    console.error("[StockCheckUseBy] save failed:", err);
    res.status(500).json({ error: "Couldn't save the use-by date" });
  }
});

const GetQuery = z.object({ checkDate: ISO });

router.get("/", validateQuery(GetQuery), async (_req, res) => {
  const { checkDate } = res.locals["query"] as z.infer<typeof GetQuery>;
  try {
    const rows = await db
      .select({ ingredientId: dailyStockChecksTable.ingredientId, useByDate: dailyStockChecksTable.useByDate })
      .from(dailyStockChecksTable)
      .where(and(eq(dailyStockChecksTable.checkDate, checkDate), isNotNull(dailyStockChecksTable.useByDate)));
    const useBy: Record<string, string> = {};
    for (const r of rows) if (r.useByDate) useBy[String(r.ingredientId)] = String(r.useByDate);
    res.json({ checkDate, useBy });
  } catch (err) {
    console.error("[StockCheckUseBy] load failed:", err);
    res.status(500).json({ error: "Couldn't load use-by dates" });
  }
});

export default router;
