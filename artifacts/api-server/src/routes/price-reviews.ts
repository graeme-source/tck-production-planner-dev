import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { validate } from "../middleware/validate";
import { resolveFinanceAccess } from "./finance";
import { decidePriceReview, priceReviews } from "../lib/finance/delivery-match-store";

// Inventory → Price changes to review (Graeme, 13 Nov 2026): prices on
// recent invoices that don't match ours, from the suppliers whose invoices
// are checked against deliveries. One tap updates our price, or leaves it.
// Objective F. Finance people only (the founder and the accountants): it
// shows invoice prices and links to the invoice files.

const router: IRouter = Router();
router.use(async (req: Request, res: Response, next: NextFunction) => {
  if (await resolveFinanceAccess(req)) { next(); return; }
  res.status(403).json({ error: "Finance access required" });
});

router.get("/", async (_req, res) => {
  res.json(await priceReviews());
});

const DecideBody = z.object({
  invoiceLineId: z.number().int().positive(),
  decision: z.enum(["updated", "dismissed"]),
});

router.post("/", validate(DecideBody), async (req, res) => {
  const { invoiceLineId, decision } = DecideBody.parse(req.body);
  const r = await decidePriceReview(invoiceLineId, decision, req.session.userId ?? null);
  if (!r.ok) { res.status(409).json({ error: r.error }); return; }
  res.json({ ok: true });
});

export default router;
