/**
 * GET /api/klaviyo-email-revenue?from&to — Klaviyo-credited email revenue
 * for an Order Analysis period, flows vs campaigns. Read-only. Same gate as
 * the rest of the Numbers page. Always 200: "not connected" and "Klaviyo
 * didn't answer" are states to show, and the body says which.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validateQuery } from "../middleware/validate";
import { requireFounderArea } from "../middleware/founder-area-access";
import { getEmailRevenue } from "../lib/klaviyo-email-revenue";

const router: IRouter = Router();
// Numbers (Order Analysis) and the Marketing Calendar page both show it.
router.use(requireFounderArea(["founder.numbers", "founder.sales"]));

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z
  .object({ from: day, to: day, refresh: z.literal("1").optional() })
  .refine(q => q.from <= q.to, { message: "from must be on or before to" });

router.get("/", validateQuery(Query), async (_req: Request, res: Response) => {
  const { from, to, refresh } = res.locals["query"] as z.infer<typeof Query>;
  res.json(await getEmailRevenue(from, to, refresh === "1"));
});

export default router;
