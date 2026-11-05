/**
 * The 2:16 order check's alert, for the packing and wrapping screens.
 *
 *   GET  /api/dispatch-cutoff               today's open alert, or null
 *   POST /api/dispatch-cutoff/check-again   look again; all clear ends it
 *   POST /api/dispatch-cutoff/dismiss       dealt with, gone for the day
 *
 * Station accounts use these, so any signed-in person can. Neither POST takes
 * any input.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { currentCutoffAlert, dismissCutoff, recheckCutoff } from "../lib/dispatch-cutoff";

const router: IRouter = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json({ alert: await currentCutoffAlert() });
  } catch (err) {
    console.error("[dispatch-cutoff] read failed:", err);
    res.status(500).json({ error: "Couldn't load the order check" });
  }
});

router.post("/check-again", async (_req: Request, res: Response) => {
  try {
    res.json({ alert: await recheckCutoff() });
  } catch (err) {
    console.error("[dispatch-cutoff] check again failed:", err);
    res.status(502).json({ error: "Couldn't reach Shopify. Try again in a moment." });
  }
});

router.post("/dismiss", async (_req: Request, res: Response) => {
  try {
    await dismissCutoff();
    res.json({ ok: true });
  } catch (err) {
    console.error("[dispatch-cutoff] dismiss failed:", err);
    res.status(500).json({ error: "Couldn't dismiss it. Try again." });
  }
});

export default router;
