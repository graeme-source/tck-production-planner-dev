/**
 * End-of-day meeting — the numbers the team reviews before going home
 * (Graeme, 2026-09-17; improvements added 2026-09-18):
 *
 *   • builders batches per hour
 *   • packing boxes per hour
 *   • quality rejects — wonkies and dog bins as separate figures
 *   • improvements completed (done work only, never ideas)
 *
 * These are the SAME four the morning meeting shows, but for TODAY rather
 * than the last production day. The morning meeting asks "how did yesterday
 * go?"; this asks "how did today go?" while everyone is still on site and
 * can say why.
 *
 * Deliberately reuses lib/yesterday-kpis, which already takes a date and is
 * the same code behind /api/reports/production-kpis and the morning meeting.
 * Two places computing a rate two ways is how the meeting and the Analytics
 * page ended up disagreeing once already — the helpers exist so that can't
 * happen again.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, productionPlansTable, productionPlanItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { londonDateString } from "../lib/london-time";
import {
  computeBuilderBatchesPerHourForDay,
  computePackingOrdersPerHourForDay,
  countImprovementsCompletedForDay,
} from "../lib/yesterday-kpis";
import { sumQualityRejects } from "../lib/quality-rejects";

const router: IRouter = Router();

// validate() covers the BODY; this endpoint only takes a query param, so the
// same zod rigor is applied to req.query here instead.
const DayQuery = z.object({
  /** Defaults to today in London. Mostly here so the numbers can be checked
   *  against a past day without waiting for one. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get("/", async (req: Request, res: Response) => {
  const parsed = DayQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "date must look like 2026-09-17" });
    return;
  }
  const day = parsed.data.date ?? londonDateString();

  try {
    const [plan] = await db
      .select({ id: productionPlansTable.id })
      .from(productionPlansTable)
      .where(eq(productionPlansTable.planDate, day))
      .limit(1);

    let wonkyCount = 0;
    let dogBinCount = 0;
    let batchesTarget = 0;
    if (plan) {
      const items = await db
        .select({
          wonlyTotal: productionPlanItemsTable.wonlyTotal,
          dogBinCount: productionPlanItemsTable.dogBinCount,
          batchesTarget: productionPlanItemsTable.batchesTarget,
        })
        .from(productionPlanItemsTable)
        .where(eq(productionPlanItemsTable.planId, plan.id));
      const rejects = sumQualityRejects(items);
      wonkyCount = rejects.wonky;
      dogBinCount = rejects.dogBin;
      for (const it of items) batchesTarget += it.batchesTarget ?? 0;
    }

    // A KPI that can't be worked out yet must come back as null and say so on
    // screen, never as a zero — a zero reads as "we did nothing today".
    // Improvements completed is different: zero really means "the team
    // completed nothing today" and must show as 0. Only a failed lookup
    // comes back null (rendered as "—"), never as a fake zero.
    const [builder, packing, improvementsCompleted] = await Promise.all([
      computeBuilderBatchesPerHourForDay(day).catch(err => {
        console.warn("[end-of-day] builder BPH failed:", err);
        return { totalBatches: 0, activeMinutes: 0, batchesPerHour: null };
      }),
      computePackingOrdersPerHourForDay(day).catch(err => {
        console.warn("[end-of-day] packing orders/hr failed:", err);
        return { totalOrders: 0, activeMinutes: 0, ordersPerHour: null };
      }),
      countImprovementsCompletedForDay(day).catch(err => {
        console.warn("[end-of-day] improvements completed failed:", err);
        return null;
      }),
    ]);

    res.json({
      date: day,
      hasPlan: !!plan,
      builder: {
        batchesPerHour: builder.batchesPerHour,
        totalBatches: builder.totalBatches,
        activeMinutes: builder.activeMinutes,
      },
      packing: {
        boxesPerHour: packing.ordersPerHour,
        totalBoxes: packing.totalOrders,
        activeMinutes: packing.activeMinutes,
      },
      // Two classifications of quality reject, always reported separately:
      // wonkies are sold as Wonky stock, dog bins are thrown away.
      wonkies: { count: wonkyCount, batchesTarget },
      dogBins: { count: dogBinCount },
      // Completed improvements only, bucketed by when the person marked the
      // work done (lib/improvements-completed.ts has the full definition).
      improvements: { completed: improvementsCompleted },
    });
  } catch (err) {
    console.error("[end-of-day] failed:", err);
    res.status(500).json({ error: "Couldn't work out today's numbers." });
  }
});

export default router;
