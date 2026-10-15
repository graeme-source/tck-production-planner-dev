/**
 * Recent stock counts per ingredient (Graeme, 15 Oct 2026). Objective F.
 *
 *   GET /api/stock-check-history?before=YYYY-MM-DD
 *       → { before, recent: { [ingredientId]: number[] } }
 *
 * Up to the last 10 non-zero counts in the 60 days before `before` (the
 * check date being recorded — today's own record is excluded so an
 * overwrite isn't compared with itself), newest first, in each ingredient's
 * own unit. Feeds the "are you sure?" check on the shared stock-check entry
 * (stock-count-units.ts), which asks for a second tap when a count is more
 * than 5× or under a fifth of usual — Fresh Basil "5 g" (really 5 packs).
 * Read-only; lives here because production-plans.ts takes no new code.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validateQuery } from "../middleware/validate";

const router: IRouter = Router();

const Query = z.object({
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get("/", validateQuery(Query), async (_req, res) => {
  const { before } = res.locals["query"] as z.infer<typeof Query>;
  const result = await db.execute(sql`
    SELECT ingredient_id, quantity FROM (
      SELECT d.ingredient_id, d.quantity::float8 AS quantity,
             row_number() OVER (PARTITION BY d.ingredient_id ORDER BY d.check_date DESC) AS rn
        FROM daily_stock_checks d
        JOIN ingredients i ON i.id = d.ingredient_id
       WHERE i.stock_check_enabled = true
         AND d.check_date < ${before}::date
         AND d.check_date >= ${before}::date - 60
         AND d.quantity > 0
    ) t
    WHERE rn <= 10
    ORDER BY ingredient_id, rn
  `);
  const recent: Record<string, number[]> = {};
  for (const row of result.rows as Array<{ ingredient_id: number; quantity: number }>) {
    const key = String(row.ingredient_id);
    (recent[key] ??= []).push(Number(row.quantity));
  }
  res.json({ before, recent });
});

export default router;
