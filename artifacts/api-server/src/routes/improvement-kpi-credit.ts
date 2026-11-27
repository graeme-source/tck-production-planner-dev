/**
 * Improvement time on the KPIs — the one setting (Graeme, 27 Nov 2026):
 * how many minutes each improvement done earns each person credited on it
 * (default 10). The rules: lib/improvement-kpi-credit.ts. Objective E.
 *
 *   GET /api/improvement-kpi-credit/settings   anyone signed in (the KPI pages read it)
 *   PUT /api/improvement-kpi-credit/settings   managers and admins
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireManagerOrAdmin, resolveRole } from "../middleware/roles";
import { MAX_IMPROVEMENT_KPI_MINUTES } from "../lib/improvement-kpi-credit";
import { loadImprovementMinutes, saveImprovementMinutes } from "../services/improvement-kpi-credit";
import { forgetRoomDay } from "../services/room-live";
import { londonDateString } from "../lib/london-time";

const router: IRouter = Router();

router.get("/settings", async (req: Request, res: Response) => {
  try {
    const [minutes, role] = await Promise.all([loadImprovementMinutes(), resolveRole(req)]);
    res.json({ minutesPerImprovement: minutes, canEdit: role === "admin" || role === "manager" });
  } catch (err) {
    console.error("[improvement-kpi-credit] settings read failed:", err);
    res.status(500).json({ error: "Couldn't load the improvement time setting" });
  }
});

const Body = z.object({
  minutesPerImprovement: z.number().int().min(0).max(MAX_IMPROVEMENT_KPI_MINUTES),
});

router.put("/settings", requireManagerOrAdmin, validate(Body), async (req: Request, res: Response) => {
  const { minutesPerImprovement } = req.body as z.infer<typeof Body>;
  try {
    await saveImprovementMinutes(minutesPerImprovement);
    // Today's room score is cached for a few minutes: show the change now.
    forgetRoomDay(londonDateString());
    res.json({ ok: true, minutesPerImprovement });
  } catch (err) {
    console.error("[improvement-kpi-credit] settings save failed:", err);
    res.status(500).json({ error: "Couldn't save — nothing was changed." });
  }
});

export default router;
