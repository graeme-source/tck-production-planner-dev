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
  const rows = await db.execute<{ id: number; body: string; created_by_name: string | null; created_at: string; requires_ack: boolean }>(sql`
    SELECT id, body, created_by_name, created_at, requires_ack FROM station_messages
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
    requiresAck: Boolean(r.requires_ack),
  })) });
});

/**
 * GET /must-confirm — every open must-confirm message, whatever the station.
 *
 * The blocking overlay used to render only on that station's own screen, so a
 * message sent to packing reached nobody who happened to be on the production
 * plans or the dashboard — which is exactly when an urgent one needs to land
 * (Graeme, 2026-09-17).
 *
 * Not filtered to "your" station on purpose: ticking Must be confirmed IS the
 * sender saying "stop what you are doing", and the app cannot reliably tell
 * who is stood at which station. Confirming clears it for everyone, which is
 * the same rule the station banner has always had ("everyone here has seen
 * it"). Ordinary messages are unaffected and stay on their station's screen.
 */
router.get("/must-confirm", async (_req: Request, res: Response) => {
  const rows = await db.execute<{ id: number; station_type: string; body: string; created_by_name: string | null; created_at: string }>(sql`
    SELECT id, station_type, body, created_by_name, created_at FROM station_messages
    WHERE requires_ack = true
      AND dismissed_at IS NULL
      AND created_at > NOW() - INTERVAL '48 hours'
    ORDER BY created_at ASC
    LIMIT 10
  `);
  res.json({ messages: rows.rows.map(r => ({
    id: Number(r.id),
    stationType: r.station_type,
    body: r.body,
    fromName: r.created_by_name,
    createdAt: r.created_at,
    requiresAck: true,
  })) });
});

const sendSchema = z.object({
  stationType: z.string().min(1).max(40),
  body: z.string().min(1).max(1000),
  // Must-acknowledge mode: locks the station's screen behind the message
  // until someone there explicitly confirms they'll action it.
  requiresAck: z.boolean().optional(),
});

// POST / — send a message to a station.
router.post("/", validate(sendSchema), async (req: Request, res: Response) => {
  const { stationType, body, requiresAck } = req.body as z.infer<typeof sendSchema>;
  const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  await db.execute(sql`
    INSERT INTO station_messages (station_type, body, created_by_user_id, created_by_name, requires_ack)
    VALUES (${stationType}, ${body.trim()}, ${req.session.userId}, ${me.rows[0]?.name ?? null}, ${requiresAck ?? false})
  `);
  res.json({ ok: true });
});

// POST /:id/dismiss — the station has read it.
//
// Tells the SENDER it landed. Sending a message into a station and never
// learning whether anyone saw it is how people stop trusting the channel and
// go back to walking over (Graeme, 2026-09-17). Only for must-confirm
// messages: a notification for every routine "Got it" would be noise, and
// noisy notifications get ignored, including the ones that matter.
router.post("/:id/dismiss", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid message" }); return; }
  const me = await db.execute<{ name: string }>(sql`SELECT name FROM app_users WHERE id = ${req.session.userId}`);
  const who = me.rows[0]?.name ?? null;

  // RETURNING tells us whether this call is the one that closed it — a second
  // tap, or another person confirming at the same moment, must not notify twice.
  const updated = await db.execute<{ created_by_user_id: number | null; requires_ack: boolean; station_type: string; body: string }>(sql`
    UPDATE station_messages SET dismissed_at = NOW(), dismissed_by_name = ${who}
    WHERE id = ${id} AND dismissed_at IS NULL
    RETURNING created_by_user_id, requires_ack, station_type, body
  `);

  const row = updated.rows[0];
  if (row?.requires_ack && row.created_by_user_id && row.created_by_user_id !== req.session.userId) {
    const preview = row.body.length > 60 ? `${row.body.slice(0, 60)}…` : row.body;
    try {
      await db.execute(sql`
        INSERT INTO notifications (user_id, type, message, read)
        VALUES (
          ${row.created_by_user_id},
          'station_message_ack',
          ${`${who ?? "Someone"} confirmed your message to ${row.station_type.replace(/_/g, " ")}: "${preview}"`},
          false
        )
      `);
    } catch (err) {
      // A missed bell must never fail the confirmation itself — the person
      // at the station has acknowledged it, and that is what matters.
      console.warn("[station-messages] ack notification failed:", err);
    }
  }
  res.json({ ok: true });
});

export default router;
