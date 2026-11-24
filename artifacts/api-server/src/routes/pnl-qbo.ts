/**
 * /api/pnl-qbo — QuickBooks figures for the founder P&L page (Graeme,
 * 18 Nov 2026; Objective I, finance & reporting). Founder only, read only.
 *
 *   GET /by-month?fromMonth=YYYY-MM&toMonth=YYYY-MM[&fresh=1]
 *       Profit and Loss by Month, accrual basis — his custom QuickBooks
 *       report. Defaults to the last 12 months, up to and including the
 *       current one.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import * as z from "zod";
import { requireFounder } from "../middleware/founder-access";
import { validateQuery } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { loadPnlByMonth } from "../lib/finance/qbo-pnl-by-month-load";
import { defaultPnlMonths, monthsBetween } from "../lib/finance/qbo-pnl-by-month";

const router: IRouter = Router();
router.use(requireFounder);

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const byMonthQuery = z.object({
  fromMonth: MONTH.optional(),
  toMonth: MONTH.optional(),
  fresh: z.enum(["0", "1"]).optional(),
});

router.get("/by-month", validateQuery(byMonthQuery), async (_req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof byMonthQuery>;
  const def = defaultPnlMonths(londonDateString());
  const fromMonth = q.fromMonth ?? def.fromMonth;
  const toMonth = q.toMonth ?? def.toMonth;
  const span = monthsBetween(fromMonth, toMonth);
  if (span < 1 || span > 36) {
    res.status(400).json({ error: "Pick between 1 and 36 months, the first before the last." });
    return;
  }
  try {
    res.json({ fromMonth, toMonth, ...(await loadPnlByMonth(fromMonth, toMonth, { fresh: q.fresh === "1" })) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pnl-qbo/by-month]", msg);
    res.status(502).json({ error: /not connected/i.test(msg) ? "QuickBooks isn't connected — connect it under Finance." : `Couldn't read QuickBooks: ${msg}` });
  }
});

export default router;
