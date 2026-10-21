/**
 * The daily improvement check-in (Graeme, 2026-10-21; Objectives E and H).
 *
 *   GET  /api/daily-checkin              — is it due for me today (London),
 *                                          and, if so, the card's content
 *   POST /api/daily-checkin/acknowledge  — { choice: "got_it" | "log_now",
 *                                            scoreShown?, creditsShown? }
 *
 * Always about the SIGNED-IN person (req.session.userId) — after a PIN
 * switch on a shared iPad the session belongs to the new person, so they
 * get their own card. Everyone signed in may use it; nothing here names
 * anyone else, so no role guard.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { CHECKIN_CHOICES } from "../lib/daily-checkin";
import { acknowledgeCheckin, loadCheckinStatus } from "../services/daily-checkin";

const router: IRouter = Router();

router.get("/", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    res.json(await loadCheckinStatus(userId));
  } catch (err) {
    // The app lets them through when this fails (never lock anyone out of
    // production work over a pep talk) and asks again next time.
    console.error("[daily-checkin] status failed:", err);
    res.status(500).json({ error: "Couldn't load today's check-in" });
  }
});

const ackSchema = z.object({
  choice: z.enum(CHECKIN_CHOICES),
  scoreShown: z.number().int().min(0).max(100000).nullable().optional(),
  creditsShown: z.number().int().min(0).max(100000).nullable().optional(),
});

router.post("/acknowledge", validate(ackSchema), async (req: Request, res: Response) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as z.infer<typeof ackSchema>;
  try {
    const out = await acknowledgeCheckin(userId, {
      choice: body.choice,
      scoreShown: body.scoreShown ?? null,
      creditsShown: body.creditsShown ?? null,
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error("[daily-checkin] acknowledge failed:", err);
    res.status(500).json({ error: "Couldn't save — you can carry on, we'll ask again next time" });
  }
});

export default router;
