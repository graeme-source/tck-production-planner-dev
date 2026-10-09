/**
 * One-off guided walkthroughs, per person (Graeme, 2026-10-09; Objectives
 * H and F) — mounted at /api/user-tours.
 *
 *   GET /me          the tours the signed-in person has finished
 *   PUT /me/:key     mark one finished ({ completed: true })
 *
 * Per PERSON, not per device: on a shared station iPad the signed-in
 * person is whoever switched in with their PIN, so each person sees a tour
 * once wherever they are. "Show me later" never reaches the server.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, userToursTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import * as z from "zod";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

/** Tour keys are short code words, e.g. "swipe_panel". */
const TOUR_KEY = /^[a-z0-9_]{1,40}$/;

router.get("/me", async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const rows = await db.select({ tourKey: userToursTable.tourKey }).from(userToursTable).where(eq(userToursTable.userId, userId));
  res.json({ completed: rows.map(r => r.tourKey) });
});

const Body = z.object({ completed: z.literal(true) });

router.put("/me/:key", validate(Body), async (req: Request, res: Response) => {
  const key = String(req.params.key ?? "");
  if (!TOUR_KEY.test(key)) { res.status(400).json({ error: "Unknown walkthrough" }); return; }
  await db.insert(userToursTable).values({ userId: req.session.userId!, tourKey: key }).onConflictDoNothing();
  res.json({ ok: true });
});

export default router;
