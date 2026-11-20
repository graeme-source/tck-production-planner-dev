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
import { currentCutoffAlert, cutoffDismissedToday, dismissCutoff, recheckCutoff } from "../lib/dispatch-cutoff";
import { recordWarningAction, userNameOf } from "../lib/warning-log";

const named = (orders: Array<{ name: string; reason: string }>) => orders.map(o => `${o.name} (${o.reason})`).join(", ");

const router: IRouter = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    res.json({ alert: await currentCutoffAlert(), dismissed: await cutoffDismissedToday() });
  } catch (err) {
    console.error("[dispatch-cutoff] read failed:", err);
    res.status(500).json({ error: "Couldn't load the order check" });
  }
});

router.post("/check-again", async (req: Request, res: Response) => {
  try {
    const alert = await recheckCutoff();
    await recordWarningAction({
      warning: "dispatch_cutoff", action: "check_again", page: req.get("referer") ?? null, userId: req.session.userId,
      detail: alert && alert.orders.length > 0 ? `Still named: ${named(alert.orders)}` : "All clear",
    });
    res.json({ alert });
  } catch (err) {
    console.error("[dispatch-cutoff] check again failed:", err);
    res.status(502).json({ error: "Couldn't reach Shopify. Try again in a moment." });
  }
});

router.post("/dismiss", async (req: Request, res: Response) => {
  try {
    // Who pressed it, kept on the alert and in the log (20 Nov 2026, #140013).
    const closed = await dismissCutoff(await userNameOf(req.session.userId));
    await recordWarningAction({
      warning: "dispatch_cutoff", action: "dismiss", page: req.get("referer") ?? null, userId: req.session.userId,
      detail: closed && closed.orders.length > 0 ? `It named: ${named(closed.orders)}` : closed?.failed ? "Shopify couldn't be read — check by hand" : null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[dispatch-cutoff] dismiss failed:", err);
    res.status(500).json({ error: "Couldn't dismiss it. Try again." });
  }
});

export default router;
