/**
 * GET /api/run-rate-day?date=YYYY-MM-DD — the TCK run rate through one
 * production day in 15-minute steps (Graeme, 26 Nov 2026), for Analytics →
 * KPIs when the range is a single day. The batches, finish press, live rule
 * and improvement credit are THE team run rate's
 * (services/team-run-rate.ts), so the chart's last step and `final` are the
 * same number the building station, Analytics and the meetings show. The
 * stepping maths is lib/run-rate-through-day.ts. Read-only. Objective G.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validateQuery } from "../middleware/validate";
import { runRateThroughDay } from "../lib/run-rate-through-day";
import { teamRunRateForDate } from "../services/team-run-rate";

const router: IRouter = Router();

const Query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD") });

router.get("/", validateQuery(Query), async (_req: Request, res: Response) => {
  const { date } = res.locals["query"] as z.infer<typeof Query>;
  try {
    const team = await teamRunRateForDate(date);
    const result = runRateThroughDay(team.completions.map(c => c.completedAt), team.breakConfig, {
      finishedAt: team.finishedAt,
      now: team.live ? team.now : null,
      improvementCredits: team.lineCredit.events,
    });
    if (result.final !== team.result.batchesPerHour) {
      // Can't happen while both read the same selection (lib/team-run-rate.test.ts) — say so loudly if it ever does.
      console.error(`[run-rate-day] ${date}: chart final ${result.final} ≠ team run rate ${team.result.batchesPerHour}`);
    }
    res.json({ date, live: team.live, ...result, improvementCredit: team.creditSummary });
  } catch (err) {
    console.error("[run-rate-day] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Couldn't work out the day's run rate" });
  }
});

export default router;
