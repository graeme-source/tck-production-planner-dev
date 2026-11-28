/**
 * GET /api/run-rate-day?date=YYYY-MM-DD — the TCK run rate through one
 * production day in 15-minute steps (Graeme, 26 Nov 2026), for Analytics →
 * KPIs when the range is a single day. The same batches as
 * /api/reports/production-kpis (calzone building completions; mac cheese
 * left out), grouped the same way (by the plan's date), and the same "Mark
 * building finished" press. The maths is
 * lib/run-rate-through-day.ts. Read-only. Objective G.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db, batchCompletionsTable, productionPlanItemsTable, productionPlansTable, recipesTable } from "@workspace/db";
import { validateQuery } from "../middleware/validate";
import { getStandardBreakConfig } from "../lib/batches-per-hour";
import { runRateThroughDay } from "../lib/run-rate-through-day";
import { londonDateString } from "../lib/london-time";
import { loadImprovementKpiCredit } from "../services/improvement-kpi-credit";
import { creditSummary, runRateLineCredit } from "../lib/improvement-kpi-credit";

const router: IRouter = Router();

/** Same rule as routes/reports.ts production-kpis. */
const MAC_CHEESE_CATEGORY = "Macaroni Cheese";

const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD") });

router.get("/", validateQuery(Query), async (_req: Request, res: Response) => {
  const { date } = res.locals["query"] as z.infer<typeof Query>;
  try {
    const rows = await db
      .select({ completedAt: batchCompletionsTable.completedAt, finishedAt: productionPlansTable.buildingFinishedAt })
      .from(batchCompletionsTable)
      .innerJoin(productionPlanItemsTable, eq(batchCompletionsTable.planItemId, productionPlanItemsTable.id))
      .innerJoin(recipesTable, eq(productionPlanItemsTable.recipeId, recipesTable.id))
      .innerJoin(productionPlansTable, eq(productionPlanItemsTable.planId, productionPlansTable.id))
      .where(and(
        sql`${batchCompletionsTable.stationType} IN ('building_1','building_2')`,
        sql`${recipesTable.category} IS DISTINCT FROM ${MAC_CHEESE_CATEGORY}`,
        eq(productionPlansTable.planDate, date),
      ));
    const finishedAt = rows.find(r => r.finishedAt)?.finishedAt ?? null;
    const isToday = date === londonDateString(new Date());
    // Improvement time comes off production time, as on the range view.
    const [config, credit] = await Promise.all([getStandardBreakConfig(), loadImprovementKpiCredit(date, date)]);
    const dayCredit = credit.days.get(date)?.runRate;
    const result = runRateThroughDay(rows.map(r => r.completedAt), config, {
      finishedAt,
      now: isToday && !finishedAt ? new Date() : null,
      improvementCredits: runRateLineCredit(dayCredit).events,
    });
    res.json({ date, live: isToday && !finishedAt, ...result, improvementCredit: creditSummary(dayCredit, result.improvementMinutesCredited) });
  } catch (err) {
    console.error("[run-rate-day] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't work out the day's run rate" });
  }
});

export default router;
