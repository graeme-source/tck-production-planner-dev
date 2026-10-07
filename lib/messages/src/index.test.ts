import { describe, it, expect } from "vitest";
import {
  normaliseAudience, audienceProblem, conversationKey, parseConversationKey, isDirect,
  canSeeMessage, isAddressedTo, canStartTo, countsAsUnread, defaultRequiresAck,
  pendingAckTargets, canEditMessage, canDeleteMessage, pushRecipients,
  parseMentionIds, splitMentions, encodeMentions, decodeMentions, activeMentionQuery,
  previewText, conversationTitle, STATION_DEFAULT_REQUIRES_ACK,
  type Audience, type MessageFacts, type Viewer,
} from "./index";

const aud = (p: Partial<Audience>): Audience => ({ everyone: false, stations: [], userIds: [], ...p });
const msg = (p: Partial<MessageFacts> & { audience: Audience }): MessageFacts => ({
  senderUserId: 1, parentSenderUserId: null, mentionedUserIds: [], ...p,
});
const viewer = (p: Partial<Viewer>): Viewer => ({ userId: 50, role: "viewer", stations: [], ...p });

describe("audiences and chats", () => {
  it("adds the sender to a person-addressed chat so replies come back to them", () => {
    expect(normaliseAudience(aud({ userIds: [7, 3, 7] }), 5)).toEqual(aud({ userIds: [3, 5, 7] }));
  });

  it("doesn't add the sender to a station-only chat", () => {
    expect(normaliseAudience(aud({ stations: ["packing", "ovens", "packing"] }), 5)).toEqual(aud({ stations: ["ovens", "packing"] }));
  });

  it("Everyone stands alone", () => {
    expect(normaliseAudience(aud({ everyone: true, stations: ["packing"], userIds: [2] }), 5)).toEqual(aud({ everyone: true }));
  });

  it("A to B and B to A are the same chat", () => {
    const ab = conversationKey(normaliseAudience(aud({ userIds: [9] }), 4));
    const ba = conversationKey(normaliseAudience(aud({ userIds: [4] }), 9));
    expect(ab).toBe("u:4,u:9");
    expect(ba).toBe(ab);
  });

  it("round-trips keys and refuses non-canonical aliases", () => {
    const a = normaliseAudience(aud({ stations: ["packing"], userIds: [12] }), 3);
    const key = conversationKey(a);
    expect(key).toBe("s:packing,u:3,u:12");
    expect(parseConversationKey(key)).toEqual(a);
    expect(parseConversationKey("everyone")).toEqual(aud({ everyone: true }));
    expect(parseConversationKey("u:12,u:3")).toBeNull();
    expect(parseConversationKey("s:Packing")).toBeNull();
    expect(parseConversationKey("x:1")).toBeNull();
  });

  it("explains an empty or self-only audience", () => {
    expect(audienceProblem(aud({}), 5)).toMatch(/Choose who/);
    expect(audienceProblem(normaliseAudience(aud({ userIds: [5] }), 5), 5)).toMatch(/other than yourself/);
    expect(audienceProblem(aud({ stations: ["packing"] }), 5)).toBeNull();
    expect(audienceProblem(aud({ stations: ["Bad Key"] }), 5)).toMatch(/Unknown station/);
  });

  it("knows person-to-person from group/station chats", () => {
    expect(isDirect(aud({ userIds: [1, 2] }))).toBe(true);
    expect(isDirect(aud({ stations: ["packing"], userIds: [1, 2] }))).toBe(false);
    expect(isDirect(aud({ everyone: true }))).toBe(false);
  });
});

describe("who can see what", () => {
  const direct = msg({ audience: aud({ userIds: [1, 2] }), senderUserId: 1 });

  it("a person can't read a direct conversation they're not in — not even an admin", () => {
    expect(canSeeMessage(direct, viewer({ userId: 3 }))).toBe(false);
    expect(canSeeMessage(direct, viewer({ userId: 3, role: "admin" }))).toBe(false);
    expect(canSeeMessage(direct, viewer({ userId: 3, role: "manager", stations: ["packing"] }))).toBe(false);
  });

  it("both people in a direct conversation can read it", () => {
    expect(canSeeMessage(direct, viewer({ userId: 1 }))).toBe(true);
    expect(canSeeMessage(direct, viewer({ userId: 2 }))).toBe(true);
  });

  it("an @mention reaches someone outside the audience", () => {
    const m = msg({ audience: aud({ userIds: [1, 2] }), mentionedUserIds: [3] });
    expect(canSeeMessage(m, viewer({ userId: 3 }))).toBe(true);
  });

  it("whoever wrote the quoted message sees the reply", () => {
    const reply = msg({ audience: aud({ stations: ["packing"] }), senderUserId: 8, parentSenderUserId: 3 });
    expect(canSeeMessage(reply, viewer({ userId: 3 }))).toBe(true);
  });

  it("station messages: people at (or rostered on) that station, and managers", () => {
    const m = msg({ audience: aud({ stations: ["packing"] }) });
    expect(canSeeMessage(m, viewer({ stations: ["packing"] }))).toBe(true);
    expect(canSeeMessage(m, viewer({ stations: ["ovens"] }))).toBe(false);
    expect(canSeeMessage(m, viewer({ role: "manager" }))).toBe(true);
    // ...but a manager seeing every station is not the same as it being for them.
    expect(isAddressedTo(m, viewer({ role: "manager" }))).toBe(false);
  });

  it("Everyone is everyone except external accountants", () => {
    const m = msg({ audience: aud({ everyone: true }) });
    expect(canSeeMessage(m, viewer({}))).toBe(true);
    expect(canSeeMessage(m, viewer({ accountantOnly: true }))).toBe(false);
  });

  it("only managers and admins start an Everyone message", () => {
    expect(canStartTo(aud({ everyone: true }), viewer({}))).toBe(false);
    expect(canStartTo(aud({ everyone: true }), viewer({ role: "manager" }))).toBe(true);
    expect(canStartTo(aud({ stations: ["packing"] }), viewer({}))).toBe(true);
    expect(canStartTo(aud({ userIds: [1, 50] }), viewer({}))).toBe(true);
  });
});

describe("unread", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const base = { audience: aud({ userIds: [1, 50] }), senderUserId: 1, parentSenderUserId: null, mentionedUserIds: [], createdAt: "2026-10-07T11:00:00Z", deleted: false, readByViewer: false };

  it("counts a recent unread message to me", () => {
    expect(countsAsUnread(base, viewer({}), now)).toBe(true);
  });
  it("never counts my own, read, deleted or old messages", () => {
    expect(countsAsUnread({ ...base, senderUserId: 50 }, viewer({}), now)).toBe(false);
    expect(countsAsUnread({ ...base, readByViewer: true }, viewer({}), now)).toBe(false);
    expect(countsAsUnread({ ...base, deleted: true }, viewer({}), now)).toBe(false);
    expect(countsAsUnread({ ...base, createdAt: "2026-09-01T00:00:00Z" }, viewer({}), now)).toBe(false);
  });
  it("a manager's badge ignores stations they aren't at", () => {
    const m = { ...base, audience: aud({ stations: ["packing"] }) };
    expect(countsAsUnread(m, viewer({ role: "admin" }), now)).toBe(false);
    expect(countsAsUnread(m, viewer({ role: "admin", stations: ["packing"] }), now)).toBe(true);
  });
});

describe("must-confirm", () => {
  it("defaults ON for stations, OFF for people", () => {
    expect(STATION_DEFAULT_REQUIRES_ACK).toBe(true);
    expect(defaultRequiresAck(aud({ stations: ["packing"] }))).toBe(true);
    expect(defaultRequiresAck(aud({ stations: ["packing"], userIds: [1, 2] }))).toBe(true);
    expect(defaultRequiresAck(aud({ userIds: [1, 2] }))).toBe(false);
    expect(defaultRequiresAck(aud({ everyone: true }))).toBe(false);
  });

  const m = { ...msg({ audience: aud({ stations: ["packing", "ovens"], userIds: [1, 9] }) }), requiresAck: true, deleted: false, ackedTargets: [] as string[] };

  it("station messages are confirmed once per station by whoever is there", () => {
    expect(pendingAckTargets(m, viewer({ stations: ["packing"] }))).toEqual(["station:packing"]);
    expect(pendingAckTargets({ ...m, ackedTargets: ["station:packing"] }, viewer({ stations: ["packing"] }))).toEqual([]);
  });
  it("person-addressed ones once per person; never the sender", () => {
    expect(pendingAckTargets(m, viewer({ userId: 9 }))).toEqual(["user:9"]);
    expect(pendingAckTargets(m, viewer({ userId: 1 }))).toEqual([]);
  });
  it("a station screen signed in as the sender can still clear its own lock", () => {
    expect(pendingAckTargets(m, viewer({ userId: 1, stations: ["packing"] }))).toEqual(["station:packing"]);
  });
  it("nothing to confirm when it isn't must-confirm or was deleted", () => {
    expect(pendingAckTargets({ ...m, requiresAck: false }, viewer({ stations: ["packing"] }))).toEqual([]);
    expect(pendingAckTargets({ ...m, deleted: true }, viewer({ stations: ["packing"] }))).toEqual([]);
  });
});

describe("edit and delete", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const mine = { senderUserId: 50, createdAt: "2026-10-07T11:55:00Z", deleted: false };
  const old = { ...mine, createdAt: "2026-10-07T11:40:00Z" };

  it("sender may edit/delete within 10 minutes", () => {
    expect(canEditMessage(mine, viewer({}), now)).toBe(true);
    expect(canDeleteMessage(mine, viewer({}), now)).toBe(true);
    expect(canEditMessage(old, viewer({}), now)).toBe(false);
    expect(canDeleteMessage(old, viewer({}), now)).toBe(false);
  });
  it("nobody else edits; managers delete any time", () => {
    expect(canEditMessage(mine, viewer({ userId: 2, role: "admin" }), now)).toBe(false);
    expect(canDeleteMessage(old, viewer({ userId: 2, role: "manager" }), now)).toBe(true);
    expect(canDeleteMessage(old, viewer({ userId: 2 }), now)).toBe(false);
    expect(canDeleteMessage({ ...old, deleted: true }, viewer({ userId: 2, role: "admin" }), now)).toBe(false);
  });
});

describe("push recipients", () => {
  it("people in a person-addressed chat plus mentions, never the sender", () => {
    expect(pushRecipients(aud({ userIds: [1, 2, 3] }), [7], 1)).toEqual([2, 3, 7]);
  });
  it("station and Everyone messages push only to mentions", () => {
    expect(pushRecipients(aud({ stations: ["packing"] }), [], 1)).toEqual([]);
    expect(pushRecipients(aud({ everyone: true }), [4], 1)).toEqual([4]);
  });
});

describe("mentions", () => {
  it("parses ids once each", () => {
    expect(parseMentionIds("hi <@3> and <@12>, <@3> again")).toEqual([3, 12]);
  });
  it("splits a body into text and mentions", () => {
    expect(splitMentions("hi <@3>!")).toEqual([{ type: "text", text: "hi " }, { type: "mention", userId: 3 }, { type: "text", text: "!" }]);
    expect(splitMentions("plain")).toEqual([{ type: "text", text: "plain" }]);
  });
  it("encodes picked @Names, longest first, leaving emails and unpicked names alone", () => {
    const picked = [{ id: 1, name: "Jo" }, { id: 2, name: "Jo Smith" }];
    expect(encodeMentions("@Jo Smith and @Jo — mail jo@x.com, @Sam", picked)).toBe("<@2> and <@1> — mail jo@x.com, @Sam");
    expect(encodeMentions("@Joanne", [{ id: 1, name: "Jo" }])).toBe("@Joanne");
  });
  it("decodes for previews and names unknown people 'someone'", () => {
    const names = (id: number) => (id === 3 ? "Grant" : undefined);
    expect(decodeMentions("ask <@3> or <@9>", names)).toBe("ask @Grant or @someone");
    expect(previewText("a\n\nb <@3>", names)).toBe("a b @Grant");
    expect(previewText("x".repeat(100), names, 10)).toBe("xxxxxxxxx…");
  });
  it("finds the @-query under the caret", () => {
    expect(activeMentionQuery("hey @gr", 7)).toEqual({ start: 4, query: "gr" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("mail jo@x", 9)).toBeNull();
    expect(activeMentionQuery("no at here", 10)).toBeNull();
  });
});

describe("chat titles", () => {
  const label = (k: string) => ({ packing: "Packing", ovens: "Ovens" }[k] ?? k);
  const name = (id: number) => ({ 1: "Graeme", 2: "Grant", 3: "Lorna" }[id]);
  it("names chats the way people say them", () => {
    expect(conversationTitle(aud({ everyone: true }), 1, label, name)).toBe("Everyone");
    expect(conversationTitle(aud({ stations: ["ovens", "packing"] }), 1, label, name)).toBe("Ovens & Packing");
    expect(conversationTitle(aud({ userIds: [1, 2] }), 1, label, name)).toBe("Grant");
    expect(conversationTitle(aud({ userIds: [1, 2, 3] }), 1, label, name)).toBe("Grant & Lorna");
    expect(conversationTitle(aud({ stations: ["packing"], userIds: [1, 2] }), 1, label, name)).toBe("Packing + Grant");
  });
});
