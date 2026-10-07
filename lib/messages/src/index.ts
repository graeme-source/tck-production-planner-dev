/**
 * Team messages — the rules, with no database or screen in sight
 * (Graeme, 2026-10-07: "turn the station messages into more of an almost
 * WhatsApp group chat, where we can tag people but also see replies").
 *
 * Shared by the API (routes/messages.ts — which asks these functions who may
 * see, send, confirm, edit and delete) and the app (the Messages panel —
 * which asks them how to title a chat and how to show a mention). One copy,
 * so the server and the screen can never disagree about who a message is for.
 *
 * The model:
 *   - A message goes to an AUDIENCE: Everyone, or one or more stations
 *     and/or one or more people. Every message with the same audience is
 *     one chat (a "conversation"), like a WhatsApp group.
 *   - A person-addressed chat always includes whoever started it, so the
 *     other side's replies come back to them.
 *   - A reply quotes the message it answers (one level, like WhatsApp) and
 *     goes to the same audience; the person who wrote the quoted message
 *     always sees the reply.
 *   - An @mention always reaches that person, even outside the audience.
 */

export type Role = "admin" | "manager" | "viewer";

export interface Audience {
  everyone: boolean;
  stations: string[];
  userIds: number[];
}

/** Who is looking. `stations` = the station screen they are on now plus the
 *  stations today's rota puts them on. */
export interface Viewer {
  userId: number;
  role: Role | string;
  stations: readonly string[];
  /** External accountants (bookkeeper without admin) are not "Everyone" —
   *  the factory's announcements are not theirs. */
  accountantOnly?: boolean;
}

export interface MessageFacts {
  audience: Audience;
  senderUserId: number | null;
  /** Who wrote the message this one replies to (null when not a reply). */
  parentSenderUserId: number | null;
  mentionedUserIds: readonly number[];
}

export const STATION_KEY_RE = /^[a-z0-9_]{1,64}$/;

/** Must-confirm starts ON for anything sent to a station — forgetting to
 *  tick it should never be how an urgent message fails to land (Graeme,
 *  2026-09-29). Person-to-person chat starts OFF: it's a conversation. */
export const STATION_DEFAULT_REQUIRES_ACK = true;

/** Station banners stop showing after this long; the chat keeps them. */
export const STATION_BANNER_HOURS = 48;

/** Older than this never counts towards the unread badge. */
export const UNREAD_WINDOW_DAYS = 14;

/** Sender may edit or delete their own message for this long. */
export const EDIT_WINDOW_MS = 10 * 60 * 1000;

export const MAX_BODY_LENGTH = 2000;

export function isManager(role: Role | string): boolean {
  return role === "admin" || role === "manager";
}

// ── Audiences and chats ─────────────────────────────────────────────────────

/** The canonical form of an audience: sorted, de-duplicated, Everyone on
 *  its own, and the sender added to any person-addressed chat. */
export function normaliseAudience(a: Audience, senderUserId: number): Audience {
  if (a.everyone) return { everyone: true, stations: [], userIds: [] };
  const stations = [...new Set(a.stations.map(s => s.trim()).filter(Boolean))].sort();
  const users = new Set(a.userIds.filter(n => Number.isInteger(n) && n > 0));
  if (users.size > 0) users.add(senderUserId);
  return { everyone: false, stations, userIds: [...users].sort((x, y) => x - y) };
}

/** Why this (normalised) audience can't be sent to, or null when it can. */
export function audienceProblem(a: Audience, senderUserId: number): string | null {
  if (a.everyone) return null;
  const bad = a.stations.find(s => !STATION_KEY_RE.test(s));
  if (bad) return `Unknown station "${bad}"`;
  if (a.stations.length === 0 && a.userIds.length === 0) return "Choose who the message is for";
  if (a.stations.length === 0 && a.userIds.every(id => id === senderUserId)) return "Choose someone other than yourself";
  return null;
}

/** One chat per audience: "everyone", "s:packing", "s:ovens,s:packing",
 *  "u:3,u:7", "s:packing,u:3,u:7". */
export function conversationKey(a: Audience): string {
  if (a.everyone) return "everyone";
  return [...a.stations.map(s => `s:${s}`), ...a.userIds.map(u => `u:${u}`)].join(",");
}

export function parseConversationKey(key: string): Audience | null {
  if (key === "everyone") return { everyone: true, stations: [], userIds: [] };
  if (!key || key.length > 2000) return null;
  const stations: string[] = [];
  const userIds: number[] = [];
  for (const part of key.split(",")) {
    if (part.startsWith("s:") && STATION_KEY_RE.test(part.slice(2))) stations.push(part.slice(2));
    else if (/^u:\d{1,9}$/.test(part)) userIds.push(Number(part.slice(2)));
    else return null;
  }
  const a = { everyone: false, stations, userIds };
  // Only canonical keys are real chats — no aliases of the same audience.
  return conversationKey({ everyone: false, stations: [...new Set(stations)].sort(), userIds: [...new Set(userIds)].sort((x, y) => x - y) }) === key ? a : null;
}

/** Person-to-person only: no stations, not Everyone. */
export function isDirect(a: Audience): boolean {
  return !a.everyone && a.stations.length === 0 && a.userIds.length > 0;
}

// ── Who sees what ───────────────────────────────────────────────────────────

/** Is this message FOR the viewer — the things that make it theirs to read
 *  (and count as unread): they sent it, it's to them, to Everyone, to a
 *  station they're at, it replies to them, or it mentions them. */
export function isAddressedTo(m: MessageFacts, v: Viewer): boolean {
  if (m.senderUserId === v.userId) return true;
  if (m.parentSenderUserId === v.userId) return true;
  if (m.mentionedUserIds.includes(v.userId)) return true;
  const a = m.audience;
  if (a.everyone) return !v.accountantOnly;
  if (a.userIds.includes(v.userId)) return true;
  return a.stations.some(s => v.stations.includes(s));
}

/** May the viewer see this message at all? Everything addressed to them,
 *  plus: managers and admins see every STATION message (they run the
 *  floor). Nobody — managers included — sees person-to-person messages
 *  they aren't part of. */
export function canSeeMessage(m: MessageFacts, v: Viewer): boolean {
  if (isAddressedTo(m, v)) return true;
  return isManager(v.role) && m.audience.stations.length > 0;
}

/** May the viewer START a new message to this audience? Anyone signed in
 *  may message any station or person. Everyone is managers/admins only:
 *  it reaches every person on every screen, so it is the announcement
 *  channel — anyone may still reply in it. */
export function canStartTo(a: Audience, v: Viewer): boolean {
  if (a.everyone) return isManager(v.role);
  return true;
}

// ── Unread ──────────────────────────────────────────────────────────────────

export interface UnreadFacts extends MessageFacts {
  createdAt: string | Date;
  deleted: boolean;
  readByViewer: boolean;
}

/** Counts towards the viewer's badge: addressed to them (a manager merely
 *  being ABLE to see every station's chat doesn't make it theirs to read),
 *  not their own, not read, not deleted, and recent. */
export function countsAsUnread(m: UnreadFacts, v: Viewer, now: Date): boolean {
  if (m.deleted || m.readByViewer) return false;
  if (m.senderUserId === v.userId) return false;
  if (!isAddressedTo(m, v)) return false;
  const at = new Date(m.createdAt).getTime();
  return now.getTime() - at <= UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// ── Must-confirm ────────────────────────────────────────────────────────────

export function defaultRequiresAck(a: Audience): boolean {
  return a.stations.length > 0 ? STATION_DEFAULT_REQUIRES_ACK : false;
}

export const stationTarget = (station: string) => `station:${station}`;
export const userTarget = (userId: number) => `user:${userId}`;

export interface AckFacts extends MessageFacts {
  requiresAck: boolean;
  deleted: boolean;
  /** Targets already confirmed ("station:packing", "user:12"). */
  ackedTargets: readonly string[];
}

/** What this viewer still has to confirm on this message. A station message
 *  is confirmed once per station (a shared iPad — whoever is there confirms
 *  for the station, as before); a person-addressed one once per person. */
export function pendingAckTargets(m: AckFacts, v: Viewer): string[] {
  if (!m.requiresAck || m.deleted) return [];
  if (m.senderUserId === v.userId) return [];
  const out: string[] = [];
  for (const s of m.audience.stations) {
    if (v.stations.includes(s) && !m.ackedTargets.includes(stationTarget(s))) out.push(stationTarget(s));
  }
  const personally = (m.audience.everyone && !v.accountantOnly)
    || m.audience.userIds.includes(v.userId)
    || m.mentionedUserIds.includes(v.userId);
  if (personally && !m.ackedTargets.includes(userTarget(v.userId))) out.push(userTarget(v.userId));
  return out;
}

// ── Edit and delete ─────────────────────────────────────────────────────────

export interface OwnedFacts { senderUserId: number | null; createdAt: string | Date; deleted: boolean }

const withinWindow = (createdAt: string | Date, now: Date) =>
  now.getTime() - new Date(createdAt).getTime() <= EDIT_WINDOW_MS;

/** Sender only, within 10 minutes — "edited" shows afterwards. */
export function canEditMessage(m: OwnedFacts, v: Viewer, now: Date): boolean {
  return !m.deleted && m.senderUserId === v.userId && withinWindow(m.createdAt, now);
}

/** Sender within 10 minutes; managers and admins any time (soft delete —
 *  "This message was deleted" stays in the chat). */
export function canDeleteMessage(m: OwnedFacts, v: Viewer, now: Date): boolean {
  if (m.deleted) return false;
  if (isManager(v.role)) return true;
  return m.senderUserId === v.userId && withinWindow(m.createdAt, now);
}

// ── Notifications ───────────────────────────────────────────────────────────

/** Who gets a phone push: the people a person-addressed message is to, and
 *  anyone @mentioned — never the sender. Station and Everyone messages push
 *  to nobody but their mentions: they show on the station / in the chat. */
export function pushRecipients(a: Audience, mentionedUserIds: readonly number[], senderUserId: number): number[] {
  const out = new Set<number>(mentionedUserIds);
  if (!a.everyone) for (const u of a.userIds) out.add(u);
  out.delete(senderUserId);
  return [...out].sort((x, y) => x - y);
}

// ── Mentions ────────────────────────────────────────────────────────────────
//
// Stored in the body as <@12> so a rename never breaks a mention; shown as
// an @Name chip. Typed as "@Name" in the compose box and encoded on send.

const MENTION_RE = /<@(\d{1,9})>/g;

export const mentionToken = (userId: number) => `<@${userId}>`;

/** The people a body mentions, first appearance order, no repeats. */
export function parseMentionIds(body: string): number[] {
  const out: number[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    const id = Number(m[1]);
    if (id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

export type BodySegment = { type: "text"; text: string } | { type: "mention"; userId: number };

/** A body as text runs and mentions, for rendering chips. */
export function splitMentions(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: "text", text: body.slice(last, i) });
    out.push({ type: "mention", userId: Number(m[1]) });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ type: "text", text: body.slice(last) });
  return out;
}

export interface NamedPerson { id: number; name: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turn the "@Name" the person typed (for people they PICKED from the @
 *  list) into tokens. Longest names first so "@Jo Smith" beats "@Jo".
 *  An "@Name" that was deleted from the text simply isn't there to encode. */
export function encodeMentions(text: string, picked: readonly NamedPerson[]): string {
  const people = [...picked].filter(p => p.name.trim()).sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const p of people) {
    const re = new RegExp(`(^|[^\\w<])@${escapeRe(p.name.trim())}(?![\\w])`, "g");
    out = out.replace(re, (_all, pre: string) => `${pre}${mentionToken(p.id)}`);
  }
  return out;
}

/** Tokens back to "@Name" — for previews, push text and the edit box. */
export function decodeMentions(body: string, nameOf: (id: number) => string | undefined): string {
  return body.replace(MENTION_RE, (_all, id: string) => `@${nameOf(Number(id)) ?? "someone"}`);
}

/** The @-picker's live query: the text after an "@" that starts a word,
 *  up to the caret, or null when the caret isn't in a mention. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || /[\n@]/.test(query) || /\s\s/.test(query)) return null;
  return { start: at, query };
}

/** One-line preview for the chat list and the push text. */
export function previewText(body: string, nameOf: (id: number) => string | undefined, max = 80): string {
  const flat = decodeMentions(body, nameOf).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ── Chat titles ─────────────────────────────────────────────────────────────

/** "Everyone", "Packing", "Ovens & Packing", "Grant", "Grant, Lorna & Bodan",
 *  "Packing + Grant". The viewer is left out of a people list — it's their
 *  chat — unless they're the only one in it. */
export function conversationTitle(
  a: Audience,
  viewerId: number,
  stationLabel: (key: string) => string,
  userName: (id: number) => string | undefined,
): string {
  if (a.everyone) return "Everyone";
  const joinNames = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`;
  const stations = joinNames(a.stations.map(stationLabel));
  const others = a.userIds.filter(id => id !== viewerId);
  const people = joinNames((others.length ? others : a.userIds).map(id => userName(id) ?? "Someone"));
  if (stations && a.userIds.length) return `${stations} + ${people}`;
  return stations || people;
}
