/**
 * Team messages — the database half (Graeme, 2026-10-07). The rules are in
 * @workspace/messages (pure, tested); this file gathers facts and writes
 * rows. Used by routes/messages.ts and by the old /api/station-messages
 * endpoints (kept as a thin shim so a station iPad still running yesterday's
 * app keeps working until it reloads).
 *
 * Visibility is enforced twice on every read: once in SQL (visibleWhere, so
 * we never fetch what the viewer can't see) and again with the pure
 * canSeeMessage over every row returned — the tested rule has the last word.
 */
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import type { Request } from "express";
import {
  canSeeMessage, countsAsUnread, pendingAckTargets, pushRecipients, previewText,
  normaliseAudience, conversationKey, parseMentionIds, isManager, STATION_KEY_RE,
  STATION_BANNER_HOURS, UNREAD_WINDOW_DAYS, stationTarget,
  type Audience, type Viewer, type MessageFacts,
} from "@workspace/messages";
import { intArrayLiteral } from "./int-array-literal";
import { rosteredStationsForUser } from "./station-rota";

export interface TeamViewer extends Viewer {
  name: string | null;
}

/** Postgres text[] literal for station keys — keys are validated against
 *  STATION_KEY_RE first, so no quoting is ever needed. */
function stationArrayLiteral(keys: readonly string[]): string {
  return `{${keys.filter(k => STATION_KEY_RE.test(k)).join(",")}}`;
}

/** Station keys the client says this screen is (?at=packing,prep), cleaned. */
export function parseAtStations(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",") : [];
  return [...new Set(list.map(s => s.trim()).filter(s => STATION_KEY_RE.test(s)))].slice(0, 12);
}

/**
 * Who is asking. `stations` is the station screen they're on right now (the
 * app says so — it's how a shared station iPad shows that station's
 * messages to whoever is signed in there, exactly as station messages always
 * worked) plus whatever today's Planday rota puts them on.
 */
export async function loadViewer(req: Request, atStations: string[]): Promise<TeamViewer | null> {
  const userId = req.session.userId;
  if (!userId) return null;
  const r = await db.execute<{ name: string; role: string; is_bookkeeper: boolean }>(sql`
    SELECT name, role, is_bookkeeper FROM app_users WHERE id = ${userId} AND is_active
  `);
  const u = r.rows[0];
  if (!u) return null;
  const rostered = await rosteredStationsForUser(userId);
  return {
    userId,
    name: u.name,
    role: u.role,
    accountantOnly: Boolean(u.is_bookkeeper) && u.role !== "admin",
    stations: [...new Set([...atStations, ...rostered])],
  };
}

/** SQL twin of canSeeMessage. Expects aliases m (team_messages) and c
 *  (team_message_conversations). */
export function visibleWhere(v: TeamViewer): SQL {
  return sql`(
    m.sender_user_id = ${v.userId}
    OR m.parent_sender_user_id = ${v.userId}
    OR EXISTS (SELECT 1 FROM team_message_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ${v.userId})
    OR (c.is_everyone AND ${!v.accountantOnly})
    OR ${v.userId} = ANY(c.user_ids)
    OR c.station_keys && ${stationArrayLiteral(v.stations)}::text[]
    OR (${isManager(v.role)} AND cardinality(c.station_keys) > 0)
  )`;
}

type FactRow = {
  id: number;
  conversation_id: number;
  key: string;
  is_everyone: boolean;
  station_keys: string[];
  user_ids: number[];
  sender_user_id: number | null;
  parent_sender_user_id: number | null;
  mentioned: number[] | null;
};

const audienceOf = (r: Pick<FactRow, "is_everyone" | "station_keys" | "user_ids">): Audience => ({
  everyone: Boolean(r.is_everyone),
  stations: r.station_keys ?? [],
  userIds: (r.user_ids ?? []).map(Number),
});

const factsOf = (r: FactRow): MessageFacts => ({
  audience: audienceOf(r),
  senderUserId: r.sender_user_id == null ? null : Number(r.sender_user_id),
  parentSenderUserId: r.parent_sender_user_id == null ? null : Number(r.parent_sender_user_id),
  mentionedUserIds: (r.mentioned ?? []).map(Number),
});

// The common SELECT list: facts the pure rules need.
const FACT_COLUMNS = sql`
  m.id, m.conversation_id, c.key, c.is_everyone, c.station_keys, c.user_ids,
  m.sender_user_id, m.parent_sender_user_id,
  (SELECT array_agg(mm.user_id) FROM team_message_mentions mm WHERE mm.message_id = m.id) AS mentioned
`;

// ── Serialising messages ────────────────────────────────────────────────────

type FullRow = FactRow & {
  parent_id: number | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  body: string;
  requires_ack: boolean;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
};

export interface ApiMessage {
  id: number;
  conversationKey: string;
  audience: Audience;
  parentId: number | null;
  parent: { id: number; senderName: string | null; body: string | null; deleted: boolean } | null;
  senderUserId: number | null;
  senderName: string | null;
  senderAvatarUrl: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  requiresAck: boolean;
  mentionIds: number[];
  readers: Array<{ id: number; name: string }>;
  acks: Array<{ target: string; byName: string | null; at: string }>;
  myPendingAcks: string[];
}

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

/** Load messages by id, already filtered by the caller's SQL, and turn the
 *  ones the viewer may see into API shape (oldest first). */
async function hydrate(rows: FullRow[], v: TeamViewer): Promise<ApiMessage[]> {
  const visible = rows.filter(r => canSeeMessage(factsOf(r), v));
  if (visible.length === 0) return [];
  const ids = intArrayLiteral(visible.map(r => r.id));

  const [reads, acks, parents] = await Promise.all([
    db.execute<{ message_id: number; user_id: number; name: string }>(sql`
      SELECT r.message_id, r.user_id, u.name FROM team_message_reads r JOIN app_users u ON u.id = r.user_id
      WHERE r.message_id = ANY(${ids}::int[]) ORDER BY r.read_at
    `),
    db.execute<{ message_id: number; target: string; acked_by_name: string | null; acked_at: Date }>(sql`
      SELECT message_id, target, acked_by_name, acked_at FROM team_message_acks
      WHERE message_id = ANY(${ids}::int[]) ORDER BY acked_at
    `),
    // Quoted parents — only shown when the viewer may see the parent too.
    db.execute<FactRow & { sender_name: string | null; body: string; deleted_at: Date | null }>(sql`
      SELECT ${FACT_COLUMNS}, m.sender_name, m.body, m.deleted_at
      FROM team_messages m JOIN team_message_conversations c ON c.id = m.conversation_id
      WHERE m.id = ANY(${intArrayLiteral(visible.map(r => r.parent_id).filter((x): x is number => x != null))}::int[])
        AND ${visibleWhere(v)}
    `),
  ]);
  const parentById = new Map(parents.rows.filter(p => canSeeMessage(factsOf(p), v)).map(p => [Number(p.id), p]));

  return visible.map(r => {
    const id = Number(r.id);
    const myAcks = acks.rows.filter(a => Number(a.message_id) === id);
    const deleted = r.deleted_at != null;
    const p = r.parent_id != null ? parentById.get(Number(r.parent_id)) : undefined;
    const facts = factsOf(r);
    return {
      id,
      conversationKey: r.key,
      audience: facts.audience,
      parentId: r.parent_id == null ? null : Number(r.parent_id),
      parent: p ? { id: Number(p.id), senderName: p.sender_name, body: p.deleted_at ? null : p.body, deleted: p.deleted_at != null } : null,
      senderUserId: facts.senderUserId,
      senderName: r.sender_name,
      senderAvatarUrl: r.sender_avatar_url,
      body: deleted ? null : r.body,
      deleted,
      editedAt: iso(r.edited_at),
      createdAt: iso(r.created_at)!,
      requiresAck: Boolean(r.requires_ack),
      mentionIds: deleted ? [] : [...facts.mentionedUserIds],
      readers: reads.rows
        .filter(x => Number(x.message_id) === id && Number(x.user_id) !== facts.senderUserId)
        .map(x => ({ id: Number(x.user_id), name: x.name })),
      acks: myAcks.map(a => ({ target: a.target, byName: a.acked_by_name, at: iso(a.acked_at)! })),
      myPendingAcks: pendingAckTargets({ ...facts, requiresAck: Boolean(r.requires_ack), deleted, ackedTargets: myAcks.map(a => a.target) }, v),
    };
  });
}

const FULL_SELECT = sql`
  SELECT ${FACT_COLUMNS}, m.parent_id, m.sender_name, u.avatar_url AS sender_avatar_url, m.body,
         m.requires_ack, m.created_at, m.edited_at, m.deleted_at
  FROM team_messages m
  JOIN team_message_conversations c ON c.id = m.conversation_id
  LEFT JOIN app_users u ON u.id = m.sender_user_id
`;

/** A page of one chat, newest page first, returned oldest-first. */
export async function chatPage(v: TeamViewer, key: string, beforeId: number | null, limit: number) {
  const rows = await db.execute<FullRow>(sql`
    ${FULL_SELECT}
    WHERE c.key = ${key} AND ${visibleWhere(v)}
      ${beforeId != null ? sql`AND m.id < ${beforeId}` : sql``}
    ORDER BY m.id DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.rows.length > limit;
  const page = rows.rows.slice(0, limit).reverse();
  return { messages: await hydrate(page, v), hasMore };
}

export async function messageById(v: TeamViewer, id: number): Promise<ApiMessage | null> {
  const rows = await db.execute<FullRow>(sql`${FULL_SELECT} WHERE m.id = ${id} AND ${visibleWhere(v)}`);
  return (await hydrate(rows.rows, v))[0] ?? null;
}

/** Raw row for edit/delete/ack checks — only when the viewer can see it. */
export async function visibleMessageRow(v: TeamViewer, id: number) {
  const rows = await db.execute<FullRow>(sql`${FULL_SELECT} WHERE m.id = ${id} AND ${visibleWhere(v)}`);
  const r = rows.rows[0];
  return r && canSeeMessage(factsOf(r), v) ? { row: r, facts: factsOf(r) } : null;
}

// ── Chat list, unread and pending confirmations ─────────────────────────────

type UnreadRow = FactRow & { created_at: Date; deleted: boolean; read: boolean; requires_ack: boolean; acked: string[] | null };

async function recentForViewer(v: TeamViewer) {
  const rows = await db.execute<UnreadRow>(sql`
    SELECT ${FACT_COLUMNS}, m.created_at, (m.deleted_at IS NOT NULL) AS deleted, m.requires_ack,
      EXISTS (SELECT 1 FROM team_message_reads r WHERE r.message_id = m.id AND r.user_id = ${v.userId}) AS read,
      (SELECT array_agg(a.target) FROM team_message_acks a WHERE a.message_id = m.id) AS acked
    FROM team_messages m JOIN team_message_conversations c ON c.id = m.conversation_id
    WHERE m.created_at > NOW() - make_interval(days => ${UNREAD_WINDOW_DAYS})
      AND m.legacy_station_message_id IS NULL
      AND ${visibleWhere(v)}
  `);
  const now = new Date();
  return rows.rows.map(r => {
    const facts = factsOf(r);
    return {
      key: r.key,
      unread: countsAsUnread({ ...facts, createdAt: r.created_at, deleted: Boolean(r.deleted), readByViewer: Boolean(r.read) }, v, now),
      pendingAck: pendingAckTargets({ ...facts, requiresAck: Boolean(r.requires_ack), deleted: Boolean(r.deleted), ackedTargets: r.acked ?? [] }, v).length > 0,
    };
  });
}

export async function unreadSummary(v: TeamViewer) {
  const recent = await recentForViewer(v);
  return {
    unread: recent.filter(r => r.unread).length,
    pendingAcks: recent.filter(r => r.pendingAck).length,
  };
}

export async function conversationList(v: TeamViewer) {
  const latest = await db.execute<FullRow>(sql`
    SELECT DISTINCT ON (m.conversation_id)
      ${FACT_COLUMNS}, m.parent_id, m.sender_name, NULL::text AS sender_avatar_url, m.body,
      m.requires_ack, m.created_at, m.edited_at, m.deleted_at
    FROM team_messages m JOIN team_message_conversations c ON c.id = m.conversation_id
    WHERE ${visibleWhere(v)}
    ORDER BY m.conversation_id, m.id DESC
  `);
  const recent = await recentForViewer(v);
  const list = latest.rows
    .filter(r => canSeeMessage(factsOf(r), v))
    .map(r => ({
      key: r.key,
      audience: audienceOf(r),
      lastMessage: {
        id: Number(r.id),
        senderUserId: r.sender_user_id == null ? null : Number(r.sender_user_id),
        senderName: r.sender_name,
        body: r.deleted_at ? null : r.body,
        deleted: r.deleted_at != null,
        createdAt: iso(r.created_at)!,
      },
      unread: recent.filter(x => x.key === r.key && x.unread).length,
      pendingAck: recent.some(x => x.key === r.key && x.pendingAck),
    }))
    .sort((a, b) => b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt));
  return list;
}

/** Names for every person a chat list / page refers to. */
export async function namesFor(ids: Iterable<number>): Promise<Record<number, string>> {
  const list = [...new Set([...ids].map(Number).filter(n => n > 0))];
  if (list.length === 0) return {};
  const r = await db.execute<{ id: number; name: string }>(sql`SELECT id, name FROM app_users WHERE id = ANY(${intArrayLiteral(list)}::int[])`);
  return Object.fromEntries(r.rows.map(x => [Number(x.id), x.name]));
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Mark everything in a chat up to a message as read by the viewer. */
export async function markRead(v: TeamViewer, key: string, upToId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO team_message_reads (message_id, user_id)
    SELECT m.id, ${v.userId} FROM team_messages m JOIN team_message_conversations c ON c.id = m.conversation_id
    WHERE c.key = ${key} AND m.id <= ${upToId}
      AND m.sender_user_id IS DISTINCT FROM ${v.userId}
      AND ${visibleWhere(v)}
    ON CONFLICT DO NOTHING
  `);
}

// ── Sending ─────────────────────────────────────────────────────────────────

export interface SendInput {
  audience: Audience;          // already normalised + checked
  body: string;                // mentions already encoded as <@id>
  requiresAck: boolean;
  parent: { id: number; senderUserId: number | null } | null;
}

/** Active people among these ids. */
export async function activeUserIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const r = await db.execute<{ id: number }>(sql`SELECT id FROM app_users WHERE is_active AND id = ANY(${intArrayLiteral(ids)}::int[])`);
  return new Set(r.rows.map(x => Number(x.id)));
}

export async function sendMessage(v: TeamViewer, input: SendInput): Promise<{ id: number; key: string; mentionIds: number[] }> {
  const key = conversationKey(input.audience);
  const parsed = parseMentionIds(input.body);
  const valid = await activeUserIds(parsed);
  const mentionIds = parsed.filter(id => valid.has(id));

  const conv = await db.execute<{ id: number }>(sql`
    INSERT INTO team_message_conversations (key, is_everyone, station_keys, user_ids)
    VALUES (${key}, ${input.audience.everyone}, ${stationArrayLiteral(input.audience.stations)}::text[], ${intArrayLiteral(input.audience.userIds)}::int[])
    ON CONFLICT (key) DO UPDATE SET last_message_at = NOW()
    RETURNING id
  `);
  const conversationId = Number(conv.rows[0]!.id);
  const ins = await db.execute<{ id: number }>(sql`
    INSERT INTO team_messages (conversation_id, parent_id, parent_sender_user_id, sender_user_id, sender_name, body, requires_ack)
    VALUES (${conversationId}, ${input.parent?.id ?? null}, ${input.parent?.senderUserId ?? null}, ${v.userId}, ${v.name}, ${input.body}, ${input.requiresAck})
    RETURNING id
  `);
  const id = Number(ins.rows[0]!.id);
  if (mentionIds.length) {
    await db.execute(sql`
      INSERT INTO team_message_mentions (message_id, user_id)
      SELECT ${id}, x FROM unnest(${intArrayLiteral(mentionIds)}::int[]) AS x
      ON CONFLICT DO NOTHING
    `);
  }
  return { id, key, mentionIds };
}

/** Replace a message's mentions after an edit; returns the newly added. */
export async function resetMentions(messageId: number, body: string): Promise<number[]> {
  const parsed = parseMentionIds(body);
  const valid = await activeUserIds(parsed);
  const ids = parsed.filter(id => valid.has(id));
  const before = await db.execute<{ user_id: number }>(sql`SELECT user_id FROM team_message_mentions WHERE message_id = ${messageId}`);
  const had = new Set(before.rows.map(r => Number(r.user_id)));
  await db.execute(sql`DELETE FROM team_message_mentions WHERE message_id = ${messageId}`);
  if (ids.length) {
    await db.execute(sql`
      INSERT INTO team_message_mentions (message_id, user_id)
      SELECT ${messageId}, x FROM unnest(${intArrayLiteral(ids)}::int[]) AS x ON CONFLICT DO NOTHING
    `);
  }
  return ids.filter(id => !had.has(id));
}

/** Phone push for a new message — people it's addressed to personally and
 *  anyone mentioned (lib/messages pushRecipients). Only devices whose owner
 *  turned push on get it (push_subscriptions — the existing opt-in). Never
 *  throws: a push hiccup must not fail the send. */
export async function notifyByPush(v: TeamViewer, audience: Audience, mentionIds: number[], key: string, body: string, onlyMentions = false): Promise<void> {
  try {
    const wanted = onlyMentions ? mentionIds.filter(id => id !== v.userId) : pushRecipients(audience, mentionIds, v.userId);
    const active = await activeUserIds(wanted);
    const recipients = wanted.filter(id => active.has(id));
    if (recipients.length === 0) return;
    const names = await namesFor(parseMentionIds(body));
    const { sendPushToUsers } = await import("../services/push");
    const text = previewText(body, id => names[id], 140);
    const mentioned = new Set(mentionIds);
    // Mentioned people get "mentioned you"; the rest a plain message.
    const groups: Array<[number[], string]> = [
      [recipients.filter(id => mentioned.has(id)), `${v.name ?? "Someone"} mentioned you`],
      [recipients.filter(id => !mentioned.has(id)), `Message from ${v.name ?? "someone"}`],
    ];
    for (const [ids, title] of groups) {
      if (ids.length === 0) continue;
      await sendPushToUsers(ids, { title, body: text, url: `/?messages=${encodeURIComponent(key)}`, tag: `team-message-${key}` });
    }
  } catch (err) {
    console.warn("[team-messages] push failed:", err);
  }
}

// ── Confirming ("Got it") ───────────────────────────────────────────────────

/** Record the viewer's confirmations. Returns the targets this call closed
 *  (a second tap, or someone else confirming at the same moment, closes
 *  nothing and must not notify twice). */
export async function ackTargets(v: TeamViewer, messageId: number, targets: string[]): Promise<string[]> {
  const closed: string[] = [];
  for (const t of targets) {
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO team_message_acks (message_id, target, acked_by_user_id, acked_by_name)
      VALUES (${messageId}, ${t}, ${v.userId}, ${v.name})
      ON CONFLICT (message_id, target) DO NOTHING
      RETURNING id
    `);
    if (r.rows.length) closed.push(t);
  }
  return closed;
}

/** Tell the sender a must-confirm message landed (bell notification, as
 *  station messages always did — 2026-09-17). Never throws. */
export async function notifySenderOfAck(v: TeamViewer, row: { sender_user_id: number | null; body: string; requires_ack: boolean }, closed: string[]): Promise<void> {
  if (!row.requires_ack || !row.sender_user_id || row.sender_user_id === v.userId || closed.length === 0) return;
  const names = await namesFor(parseMentionIds(row.body));
  const preview = previewText(row.body, id => names[id], 60);
  const where = closed.map(t => (t.startsWith("station:") ? t.slice(8).replace(/_/g, " ") : "you")).filter(w => w !== "you");
  const message = where.length
    ? `${v.name ?? "Someone"} confirmed your message to ${where.join(", ")}: "${preview}"`
    : `${v.name ?? "Someone"} confirmed your message: "${preview}"`;
  try {
    await db.execute(sql`
      INSERT INTO notifications (user_id, type, message, read)
      VALUES (${row.sender_user_id}, 'station_message_ack', ${message}, false)
    `);
  } catch (err) {
    // A missed bell must never fail the confirmation itself.
    console.warn("[team-messages] ack notification failed:", err);
  }
}

// ── Station screen banner ───────────────────────────────────────────────────

/** Messages a station's screen still shows: sent to that station in the
 *  last 48 hours, not deleted, not yet confirmed for that station. */
export async function stationBanner(v: TeamViewer, station: string) {
  const rows = await db.execute<FullRow>(sql`
    ${FULL_SELECT}
    WHERE ${station} = ANY(c.station_keys)
      AND m.deleted_at IS NULL
      AND m.created_at > NOW() - make_interval(hours => ${STATION_BANNER_HOURS})
      AND NOT EXISTS (SELECT 1 FROM team_message_acks a WHERE a.message_id = m.id AND a.target = ${stationTarget(station)})
      AND ${visibleWhere(v)}
    ORDER BY m.id DESC
    LIMIT 10
  `);
  return hydrate(rows.rows.reverse(), v).then(list => list.reverse());
}

export { normaliseAudience };
