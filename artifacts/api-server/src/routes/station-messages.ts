/**
 * Station messages (Graeme, 2026-09-15): a note sent to a station shows as
 * a banner on that station's screen until someone there dismisses it.
 * Anyone signed in can send — passing word to a station is exactly the
 * kind of communication we want more of, not gatekept. Messages older
 * than 48 hours stop showing (stale operational notes are noise), but
 * stay in the table as history.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate } from "../middleware/validate";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
}
router.use(requireAuth);

// GET /?station=packing — open messages for one station, newest first.
router.get("/", async (req: Request, res: Response) => {
  const station = String(req.query["station"] ?? "");
  if (!station || station.length > 40) { res.status(400).json({ error: "station is required" }); return; }
  const rows = await db.execute<{ id: number; body: string; created_by_name: string | null; created_at: string }>(sql`
    SELECT id, body, created_by_name, created_at FROM station_messages
    WHERE station_type = ${station}
      AND dismissed_at IS NULL
      AND created_at > NOW() - INTERVAL '48 hours'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  res.json({ messages: rows.rows.map(r => ({
    id: Number(r.id),
    body: r.body,
    fromName: r.created_by_name,
    createdAt: r.created_at,
  })) });
});

const sendSchema = z.object({
  stationType: z.string().min(1).max(40),
  body: z.string().min(1).max(1000),
});

// POST / — send a message to a station.
router.post("/", validate(sendSchema), async (req: Request, res: Response) => {
  const { stationType, body } = req.body as z.infer<typeof sendSchema>;
  const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  await db.execute(sql`
    INSERT INTO station_messages (station_type, body, created_by_user_id, created_by_name)
    VALUES (${stationType}, ${body.trim()}, ${req.session.userId}, ${me.rows[0]?.name ?? null})
  `);
  res.json({ ok: true });
});

// POST /:id/dismiss — the station has read it.
router.post("/:id/dismiss", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid message" }); return; }
  const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  await db.execute(sql`
    UPDATE station_messages SET dismissed_at = NOW(), dismissed_by_name = ${me.rows[0]?.name ?? null}
    WHERE id = ${id} AND dismissed_at IS NULL
  `);
  res.json({ ok: true });
});

export default router;
