/**
 * "Close down the packing and wrapping shift" (Graeme, 24 Nov 2026) — the
 * button on the Packing and Wrapping stations. Rules: lib/shift-close-down.ts;
 * data: services/shift-close-down.ts; table: migration 0395.
 *
 *   GET  /shift-close-down?date=YYYY-MM-DD   closed down (when, by whom), or
 *        what's still to do in plain words
 *   POST /shift-close-down          { date }  close it down now — today only,
 *        and only once everything is packed, wrapped and checked (re-checked
 *        here, not trusted from the screen)
 *   POST /shift-close-down/reopen   { date }  undo, same day only
 *
 * Anyone signed in (the team at the bench presses it). Every close and
 * reopen is written to shift_close_down_events.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { validate } from "../middleware/validate";
import { londonDateString } from "../lib/london-time";
import { closeDown, closeDownOutstandingFor, closeDownStatus, reopen } from "../services/shift-close-down";
import { forgetRoomDay } from "../services/room-live";

const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DayBody = z.object({ date: z.string().regex(DATE_RE) });

async function currentUser(req: Request): Promise<{ id: number; name: string } | null> {
  const id = req.session.userId;
  if (!id) return null;
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? `user ${id}` };
}

const statusBody = async (date: string) => ({ ...(await closeDownStatus(date)), isToday: date === londonDateString() });

router.get("/", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" && DATE_RE.test(req.query.date) ? req.query.date : null;
  if (!date) { res.status(400).json({ error: "date is required (YYYY-MM-DD)" }); return; }
  try {
    res.json(await statusBody(date));
  } catch (err) {
    console.error("[shift-close-down] status failed:", err);
    res.status(500).json({ error: "Couldn't check the shift" });
  }
});

router.post("/", validate(DayBody), async (req: Request, res: Response) => {
  const { date } = req.body as z.infer<typeof DayBody>;
  if (date !== londonDateString()) {
    res.status(400).json({ error: "Only today's shift can be closed down" });
    return;
  }
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const outstanding = await closeDownOutstandingFor(date);
  if (outstanding.length > 0) {
    res.status(409).json({ error: "Not everything is done yet", outstanding });
    return;
  }
  await closeDown(date, user);
  forgetRoomDay(date);
  res.json(await statusBody(date));
});

router.post("/reopen", validate(DayBody), async (req: Request, res: Response) => {
  const { date } = req.body as z.infer<typeof DayBody>;
  if (date !== londonDateString()) {
    res.status(400).json({ error: "Only today's shift can be reopened" });
    return;
  }
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  await reopen(date, user);
  forgetRoomDay(date);
  res.json(await statusBody(date));
});

export default router;
