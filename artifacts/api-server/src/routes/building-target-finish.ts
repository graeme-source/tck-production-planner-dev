/**
 * GET /api/building-target-finish?planId=123 — the builders' target finish
 * time at the standard 20 batches/hour (both tables together), with the
 * standard snack and lunch deductions. Read-only; any signed-in user (the
 * building tables run as station accounts). Logic: lib/building-target-finish.ts
 * and the pure computeTargetFinish in @workspace/production-schedule.
 */
import { Router, type IRouter } from "express";
import * as z from "zod";
import { validateQuery } from "../middleware/validate";
import { buildingTargetFinish } from "../lib/building-target-finish";

const router: IRouter = Router();

const TargetFinishQuery = z.object({
  planId: z.coerce.number().int().positive(),
});

router.get("/", validateQuery(TargetFinishQuery), async (_req, res) => {
  const { planId } = res.locals["query"] as z.infer<typeof TargetFinishQuery>;
  const result = await buildingTargetFinish(planId);
  if (!result) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(result);
});

export default router;
