/**
 * The OLD station-messages endpoints, kept as a thin shim over team
 * messages (2026-10-07). Station messages now live in the team chat
 * (routes/messages.ts, migration 0148, which carried every old message
 * over). A station iPad still running yesterday's app talks to these until
 * it reloads, so they read and write the NEW tables — nothing sent or
 * confirmed from an old screen is lost. Nothing in today's app calls them;
 * delete this file once every screen has reloaded.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { normaliseAudience, STATION_KEY_RE, stationTarget } from "@workspace/messages";
import { loadViewer, sendMessage, stationBanner, ackTargets, visibleMessageRow, notifySenderOfAck } from "../lib/team-messages";

const router: IRouter = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
});

// GET /?station=packing — open messages for one station, newest first.
router.get("/", async (req: Request, res: Response) => {
  const station = String(req.query["station"] ?? "");
  if (!STATION_KEY_RE.test(station)) { res.status(400).json({ error: "station is required" }); return; }
  const v = await loadViewer(req, [station]);
  if (!v) { res.status(401).json({ error: "Not authenticated" }); return; }
  const list = await stationBanner(v, station);
  res.json({ messages: list.map(m => ({
    id: m.id,
    stationType: station,
    body: m.body ?? "",
    fromName: m.senderName,
    createdAt: m.createdAt,
    requiresAck: m.requiresAck,
  })) });
});

const sendSchema = z.object({
  stationType: z.string().regex(STATION_KEY_RE),
  body: z.string().trim().min(1).max(1000),
  requiresAck: z.boolean().optional(),
});

// POST / — send a message to a station.
router.post("/", validate(sendSchema), async (req: Request, res: Response) => {
  const { stationType, body, requiresAck } = req.body as z.infer<typeof sendSchema>;
  const v = await loadViewer(req, []);
  if (!v) { res.status(401).json({ error: "Not authenticated" }); return; }
  const audience = normaliseAudience({ everyone: false, stations: [stationType], userIds: [] }, v.userId);
  await sendMessage(v, { audience, body, requiresAck: requiresAck ?? false, parent: null });
  res.json({ ok: true });
});

// POST /:id/dismiss — the station has read it. Old screens send the
// message id they were shown, which is now a team_messages id.
router.post("/:id/dismiss", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid message" }); return; }
  const first = await loadViewer(req, []);
  if (!first) { res.status(401).json({ error: "Not authenticated" }); return; }
  // The old screen doesn't say which station it is; the message does.
  const peek = await visibleMessageRow({ ...first, role: "admin" }, id);
  const stations = peek?.facts.audience.stations ?? [];
  const v = await loadViewer(req, stations);
  const found = v ? await visibleMessageRow(v, id) : null;
  if (!v || !found) { res.json({ ok: true }); return; }
  const closed = await ackTargets(v, id, stations.map(stationTarget));
  res.json({ ok: true });
  void notifySenderOfAck(v, found.row, closed);
});

export default router;
