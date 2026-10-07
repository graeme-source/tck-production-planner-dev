/**
 * How the Messages panel lays out what the server sends — pure, so it's
 * tested (team-chat-view.test.ts). Who may SEE what is not decided here;
 * that's the server and @workspace/messages.
 */
import { isDirect, stationTarget, type Audience } from "@workspace/messages";

export interface ChatListEntry {
  key: string;
  audience: Audience;
  lastMessage: { id: number; senderUserId: number | null; senderName: string | null; body: string | null; deleted: boolean; createdAt: string } | null;
  unread: number;
  pendingAck: boolean;
}

/**
 * The chat list: every chat with messages, newest first — plus, so they're
 * always one tap away even when quiet, the Everyone chat and the chat for
 * the station this screen is (at the bottom while empty).
 */
export function buildChatList(
  conversations: readonly ChatListEntry[],
  opts: { seesEveryone: boolean; screenStations: readonly string[]; knownStation: (key: string) => boolean },
): ChatListEntry[] {
  const list = [...conversations].sort((a, b) =>
    (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? ""));
  const have = new Set(list.map(c => c.key));
  const empty = (key: string, audience: Audience): ChatListEntry => ({ key, audience, lastMessage: null, unread: 0, pendingAck: false });
  for (const s of opts.screenStations) {
    const key = `s:${s}`;
    if (opts.knownStation(s) && !have.has(key)) { list.push(empty(key, { everyone: false, stations: [s], userIds: [] })); have.add(key); }
  }
  if (opts.seesEveryone && !have.has("everyone")) list.push(empty("everyone", { everyone: true, stations: [], userIds: [] }));
  return list;
}

/** Tick line under MY message: "Seen" / "Sent" in a one-to-one chat,
 *  "Seen by N" anywhere bigger. */
export function readStatus(m: { readers: readonly { id: number }[] }, audience: Audience, myId: number): string {
  if (isDirect(audience)) {
    const others = audience.userIds.filter(id => id !== myId);
    if (others.length === 1) return others.every(id => m.readers.some(r => r.id === id)) ? "Seen" : "Sent";
  }
  return m.readers.length ? `Seen by ${m.readers.length}` : "Sent";
}

/** For a must-confirm station message: which stations have confirmed (who,
 *  when) and which are still waiting. */
export function stationAckState(
  m: { acks: readonly { target: string; byName: string | null; at: string }[] },
  audience: Audience,
): { confirmed: Array<{ station: string; byName: string | null; at: string }>; waiting: string[] } {
  const confirmed: Array<{ station: string; byName: string | null; at: string }> = [];
  const waiting: string[] = [];
  for (const s of audience.stations) {
    const a = m.acks.find(x => x.target === stationTarget(s));
    if (a) confirmed.push({ station: s, byName: a.byName, at: a.at });
    else waiting.push(s);
  }
  return { confirmed, waiting };
}

/** How many people (not stations) have confirmed. */
export function personAckCount(m: { acks: readonly { target: string }[] }): number {
  return m.acks.filter(a => a.target.startsWith("user:")).length;
}

/** Messages from the same person within 5 minutes sit together without
 *  repeating the name — the WhatsApp look. */
export function startsGroup(prev: { senderUserId: number | null; createdAt: string } | undefined, cur: { senderUserId: number | null; createdAt: string; parentId?: number | null }): boolean {
  if (!prev) return true;
  if (prev.senderUserId !== cur.senderUserId) return true;
  if (cur.parentId) return true;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60 * 1000;
}
