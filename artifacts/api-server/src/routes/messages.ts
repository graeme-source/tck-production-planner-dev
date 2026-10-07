/**
 * Team messages (Graeme, 2026-10-07) — mounted at /api/messages.
 *
 * "Turn the station messages into more of an almost WhatsApp group chat,
 * where we can tag people but also see replies to messages … with the
 * ability to send messages to certain stations or to certain people."
 *
 * Every read is filtered by who is asking (lib/team-messages.ts, rules in
 * @workspace/messages): you see what you sent, what is to you, to Everyone,
 * to a station you're at (the screen says which — ?at=packing — or the rota
 * puts you on), what replies to you and what mentions you. Managers and
 * admins see every station's chat. Nobody sees a person-to-person chat
 * they aren't in.
 *
 * Anyone signed in may message any station or person and reply anywhere
 * they can read. Starting an Everyone message is managers/admins only.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validate, validateQuery } from "../middleware/validate";
import {
  normaliseAudience, audienceProblem, parseConversationKey, canStartTo, defaultRequiresAck,
  canEditMessage, canDeleteMessage, pendingAckTargets, MAX_BODY_LENGTH, STATION_KEY_RE,
  type Audience,
} from "@workspace/messages";
import {
  loadViewer, parseAtStations, chatPage, conversationList, unreadSummary, markRead, namesFor,
  sendMessage, notifyByPush, messageById, visibleMessageRow, resetMentions, ackTargets,
  notifySenderOfAck, stationBanner, activeUserIds, type TeamViewer,
} from "../lib/team-messages";

const router: IRouter = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  next();
});

async function viewerOr401(req: Request, res: Response, at: unknown): Promise<TeamViewer | null> {
  const v = await loadViewer(req, parseAtStations(at));
  if (!v) res.status(401).json({ error: "Not authenticated" });
  return v;
}

const atQuery = z.object({ at: z.string().max(400).optional() });

// GET /people — everyone you can message or @mention (active, not
// external accountants).
router.get("/people", async (_req: Request, res: Response) => {
  const r = await db.execute<{ id: number; name: string; avatar_url: string | null }>(sql`
    SELECT id, name, avatar_url FROM app_users
    WHERE is_active AND NOT (is_bookkeeper AND role <> 'admin')
    ORDER BY name
  `);
  res.json({ people: r.rows.map(p => ({ id: Number(p.id), name: p.name, avatarUrl: p.avatar_url })) });
});

// GET /unread — the badge: unread count + must-confirm messages waiting.
router.get("/unread", validateQuery(atQuery), async (req: Request, res: Response) => {
  const v = await viewerOr401(req, res, (res.locals["query"] as z.infer<typeof atQuery>).at);
  if (!v) return;
  res.json(await unreadSummary(v));
});

// GET /conversations — the chat list, latest first.
router.get("/conversations", validateQuery(atQuery), async (req: Request, res: Response) => {
  const v = await viewerOr401(req, res, (res.locals["query"] as z.infer<typeof atQuery>).at);
  if (!v) return;
  const conversations = await conversationList(v);
  const ids = new Set<number>();
  for (const c of conversations) c.audience.userIds.forEach(id => ids.add(id));
  res.json({
    conversations,
    names: await namesFor(ids),
    me: {
      userId: v.userId,
      stations: v.stations,
      canMessageEveryone: canStartTo({ everyone: true, stations: [], userIds: [] }, v),
      seesEveryone: !v.accountantOnly,
    },
  });
});

const pageQuery = z.object({
  at: z.string().max(400).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// GET /conversations/:key/messages — one chat, 20 at a time, oldest first;
// ?before=<id> loads the older page.
router.get("/conversations/:key/messages", validateQuery(pageQuery), async (req: Request, res: Response) => {
  const q = res.locals["query"] as z.infer<typeof pageQuery>;
  const key = String(req.params["key"]);
  const audience = parseConversationKey(key);
  if (!audience) { res.status(400).json({ error: "Unknown chat" }); return; }
  const v = await viewerOr401(req, res, q.at);
  if (!v) return;
  const page = await chatPage(v, key, q.before ?? null, q.limit ?? 20);
  const ids = new Set<number>(audience.userIds);
  for (const m of page.messages) m.mentionIds.forEach(id => ids.add(id));
  res.json({ ...page, audience, names: await namesFor(ids) });
});

const readSchema = z.object({ upToId: z.number().int().positive(), at: z.array(z.string().max(64)).max(12).optional() });

// POST /conversations/:key/read — I've seen everything up to this message.
router.post("/conversations/:key/read", validate(readSchema), async (req: Request, res: Response) => {
  const { upToId, at } = req.body as z.infer<typeof readSchema>;
  const key = String(req.params["key"]);
  if (!parseConversationKey(key)) { res.status(400).json({ error: "Unknown chat" }); return; }
  const v = await viewerOr401(req, res, at);
  if (!v) return;
  await markRead(v, key, upToId);
  res.json({ ok: true });
});

const audienceSchema = z.object({
  everyone: z.boolean().optional(),
  stations: z.array(z.string().regex(STATION_KEY_RE)).max(20).optional(),
  userIds: z.array(z.number().int().positive()).max(100).optional(),
});

const sendSchema = z.object({
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH),
  // Either a new audience, an existing chat, or a reply (which always goes
  // to the replied-to message's chat).
  audience: audienceSchema.optional(),
  conversationKey: z.string().max(2000).optional(),
  parentId: z.number().int().positive().optional(),
  requiresAck: z.boolean().optional(),
  at: z.array(z.string().max(64)).max(12).optional(),
});

// POST / — send a message (or a reply).
router.post("/", validate(sendSchema), async (req: Request, res: Response) => {
  const input = req.body as z.infer<typeof sendSchema>;
  const v = await viewerOr401(req, res, input.at);
  if (!v) return;

  let audience: Audience;
  let parent: { id: number; senderUserId: number | null } | null = null;
  if (input.parentId) {
    const p = await visibleMessageRow(v, input.parentId);
    if (!p) { res.status(404).json({ error: "That message isn't there any more" }); return; }
    // Replies go to the same audience as the message they answer.
    audience = p.facts.audience;
    parent = { id: Number(p.row.id), senderUserId: p.facts.senderUserId };
  } else {
    let raw: Audience | null = null;
    if (input.conversationKey) raw = parseConversationKey(input.conversationKey);
    else if (input.audience) raw = { everyone: !!input.audience.everyone, stations: input.audience.stations ?? [], userIds: input.audience.userIds ?? [] };
    if (!raw) { res.status(400).json({ error: "Choose who the message is for" }); return; }
    audience = normaliseAudience(raw, v.userId);
    const problem = audienceProblem(audience, v.userId);
    if (problem) { res.status(400).json({ error: problem }); return; }
    if (!canStartTo(audience, v)) {
      res.status(403).json({ error: "Only managers can message Everyone — pick stations or people instead" });
      return;
    }
    const others = audience.userIds.filter(id => id !== v.userId);
    const active = await activeUserIds(others);
    if (others.some(id => !active.has(id))) { res.status(400).json({ error: "One of those people can't be messaged" }); return; }
  }

  const requiresAck = input.requiresAck ?? (parent ? false : defaultRequiresAck(audience));
  const sent = await sendMessage(v, { audience, body: input.body, requiresAck, parent });
  const message = await messageById(v, sent.id);
  res.status(201).json({ message, conversationKey: sent.key });
  // Station and Everyone messages push only to mentions; person-addressed
  // ones also to the people in the chat. After the response — never slows
  // or fails the send.
  void notifyByPush(v, audience, sent.mentionIds, sent.key, input.body);
});

const editSchema = z.object({ body: z.string().trim().min(1).max(MAX_BODY_LENGTH) });

// PATCH /:id — fix a typo within 10 minutes (shows "edited").
router.patch("/:id", validate(editSchema), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid message" }); return; }
  const v = await viewerOr401(req, res, undefined);
  if (!v) return;
  const found = await visibleMessageRow(v, id);
  if (!found) { res.status(404).json({ error: "Message not found" }); return; }
  const { row, facts } = found;
  if (!canEditMessage({ senderUserId: facts.senderUserId, createdAt: row.created_at, deleted: row.deleted_at != null }, v, new Date())) {
    res.status(403).json({ error: "Messages can only be edited by whoever sent them, within 10 minutes" });
    return;
  }
  const { body } = req.body as z.infer<typeof editSchema>;
  await db.execute(sql`UPDATE team_messages SET body = ${body}, edited_at = NOW() WHERE id = ${id}`);
  const added = await resetMentions(id, body);
  res.json({ message: await messageById(v, id) });
  if (added.length) void notifyByPush(v, facts.audience, added, row.key, body, true);
});

// DELETE /:id — soft delete: sender within 10 minutes, managers any time.
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid message" }); return; }
  const v = await viewerOr401(req, res, undefined);
  if (!v) return;
  const found = await visibleMessageRow(v, id);
  if (!found) { res.status(404).json({ error: "Message not found" }); return; }
  if (!canDeleteMessage({ senderUserId: found.facts.senderUserId, createdAt: found.row.created_at, deleted: found.row.deleted_at != null }, v, new Date())) {
    res.status(403).json({ error: "You can delete your own message within 10 minutes; managers can delete any time" });
    return;
  }
  await db.execute(sql`UPDATE team_messages SET deleted_at = NOW(), deleted_by_user_id = ${v.userId} WHERE id = ${id} AND deleted_at IS NULL`);
  res.json({ ok: true });
});

const ackSchema = z.object({
  at: z.array(z.string().max(64)).max(12).optional(),
  /** Confirm only these (e.g. the station this screen is); default: all of mine. */
  targets: z.array(z.string().max(80)).max(20).optional(),
});

// POST /:id/ack — "Got it" / "I understand and will action this".
router.post("/:id/ack", validate(ackSchema), async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid message" }); return; }
  const input = req.body as z.infer<typeof ackSchema>;
  const v = await viewerOr401(req, res, input.at);
  if (!v) return;
  const found = await visibleMessageRow(v, id);
  if (!found) { res.status(404).json({ error: "Message not found" }); return; }
  const { row, facts } = found;
  const acked = await db.execute<{ target: string }>(sql`SELECT target FROM team_message_acks WHERE message_id = ${id}`);
  // Ordinary station messages are "Got it"-dismissed from the station
  // banner too (not just must-confirm ones), so the station can always
  // clear its own banner.
  const pending = pendingAckTargets({ ...facts, requiresAck: true, deleted: row.deleted_at != null, ackedTargets: acked.rows.map(a => a.target) }, v);
  const targets = input.targets ? pending.filter(t => input.targets!.includes(t)) : pending;
  const closed = await ackTargets(v, id, targets);
  res.json({ ok: true, confirmed: closed });
  void notifySenderOfAck(v, row, closed);
});

const bannerQuery = z.object({ station: z.string().regex(STATION_KEY_RE) });

// GET /station-banner?station=packing — what this station's screen still
// shows (banner, or full-screen lock for must-confirm ones).
router.get("/station-banner", validateQuery(bannerQuery), async (req: Request, res: Response) => {
  const { station } = res.locals["query"] as z.infer<typeof bannerQuery>;
  const v = await viewerOr401(req, res, station);
  if (!v) return;
  res.json({ messages: await stationBanner(v, station) });
});

export default router;
