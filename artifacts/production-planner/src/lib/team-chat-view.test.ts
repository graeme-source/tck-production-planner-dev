import { describe, it, expect } from "vitest";
import { buildChatList, readStatus, stationAckState, personAckCount, startsGroup, type ChatListEntry } from "./team-chat-view";

const aud = (p: Partial<{ everyone: boolean; stations: string[]; userIds: number[] }>) => ({ everyone: false, stations: [], userIds: [], ...p });
const chat = (key: string, at: string | null, p: Partial<ChatListEntry> = {}): ChatListEntry => ({
  key, audience: aud({}), unread: 0, pendingAck: false,
  lastMessage: at ? { id: 1, senderUserId: 1, senderName: "A", body: "x", deleted: false, createdAt: at } : null,
  ...p,
});

describe("buildChatList", () => {
  const known = (k: string) => ["packing", "ovens", "prep"].includes(k);

  it("sorts by latest message and adds Everyone + this screen's station when quiet", () => {
    const list = buildChatList(
      [chat("u:1,u:2", "2026-10-07T09:00:00Z"), chat("s:ovens", "2026-10-07T10:00:00Z")],
      { seesEveryone: true, screenStations: ["packing"], knownStation: known },
    );
    expect(list.map(c => c.key)).toEqual(["s:ovens", "u:1,u:2", "s:packing", "everyone"]);
  });

  it("doesn't duplicate chats that already have messages, or invent unknown stations", () => {
    const list = buildChatList(
      [chat("everyone", "2026-10-07T09:00:00Z"), chat("s:prep", "2026-10-07T08:00:00Z")],
      { seesEveryone: true, screenStations: ["main_prep", "prep"], knownStation: known },
    );
    expect(list.map(c => c.key)).toEqual(["everyone", "s:prep"]);
  });

  it("no Everyone chat for people outside Everyone", () => {
    expect(buildChatList([], { seesEveryone: false, screenStations: [], knownStation: known })).toEqual([]);
  });
});

describe("readStatus", () => {
  it("one-to-one: Seen once the other person has read it", () => {
    expect(readStatus({ readers: [] }, aud({ userIds: [1, 2] }), 1)).toBe("Sent");
    expect(readStatus({ readers: [{ id: 2 }] }, aud({ userIds: [1, 2] }), 1)).toBe("Seen");
  });
  it("groups, stations and Everyone: Seen by N", () => {
    expect(readStatus({ readers: [{ id: 2 }, { id: 3 }] }, aud({ stations: ["packing"] }), 1)).toBe("Seen by 2");
    expect(readStatus({ readers: [{ id: 2 }] }, aud({ userIds: [1, 2, 3] }), 1)).toBe("Seen by 1");
    expect(readStatus({ readers: [] }, aud({ everyone: true }), 1)).toBe("Sent");
  });
});

describe("confirmations", () => {
  it("splits stations into confirmed and waiting", () => {
    const s = stationAckState({ acks: [{ target: "station:packing", byName: "Grant", at: "t" }, { target: "user:4", byName: "X", at: "t" }] }, aud({ stations: ["ovens", "packing"] }));
    expect(s.confirmed).toEqual([{ station: "packing", byName: "Grant", at: "t" }]);
    expect(s.waiting).toEqual(["ovens"]);
  });
  it("counts people who confirmed", () => {
    expect(personAckCount({ acks: [{ target: "station:packing" }, { target: "user:4" }, { target: "user:5" }] })).toBe(2);
  });
});

describe("startsGroup", () => {
  const m = (sender: number, at: string, parentId: number | null = null) => ({ senderUserId: sender, createdAt: at, parentId });
  it("groups the same sender within 5 minutes, unless it's a reply", () => {
    expect(startsGroup(undefined, m(1, "2026-10-07T10:00:00Z"))).toBe(true);
    expect(startsGroup(m(1, "2026-10-07T10:00:00Z"), m(1, "2026-10-07T10:03:00Z"))).toBe(false);
    expect(startsGroup(m(1, "2026-10-07T10:00:00Z"), m(1, "2026-10-07T10:06:00Z"))).toBe(true);
    expect(startsGroup(m(1, "2026-10-07T10:00:00Z"), m(2, "2026-10-07T10:01:00Z"))).toBe(true);
    expect(startsGroup(m(1, "2026-10-07T10:00:00Z"), m(1, "2026-10-07T10:01:00Z", 5))).toBe(true);
  });
});
