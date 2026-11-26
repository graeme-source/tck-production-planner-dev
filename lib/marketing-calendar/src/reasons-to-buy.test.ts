import { describe, expect, it } from "vitest";
import { reasonForTag, reasonsPerEmail, tagKey, clickSort, DEFAULT_REASON_SORT, efficacyOf, plannableSoon, rankEfficacy, sortReasonRows, emailText, evidenceFound, restState, sentSyncFrom, gapWords, guideWords, isReady, planningOrder, readyFrom, groupUses, reasonsSignature, sinceWords, summariseReasons, type ReasonEmail } from "./reasons-to-buy";

const email = (date: string, revenue = 100, extra: Partial<ReasonEmail> = {}): ReasonEmail => ({
  campaignId: `c-${date}`, date, subject: "You've got credit", name: "Credit", recipients: 1000, orders: 5, revenue, ...extra,
});

describe("Reasons to Buy — uses", () => {
  // Graeme, 18 Nov 2026: "If we send 4 emails in a week about the same
  // thing, that's one instance of it being used" — the credit emails at the
  // end of September went out over 7 or 8 days.
  it("counts a burst of emails as one use, with its totals", () => {
    const uses = groupUses([email("2026-09-24"), email("2026-09-26"), email("2026-09-29"), email("2026-10-01", 50.5)]);
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ from: "2026-09-24", to: "2026-10-01", recipients: 4000, orders: 20, revenue: 350.5 });
    expect(uses[0].emails).toHaveLength(4);
  });
  it("starts a new use after a long gap, newest first", () => {
    const uses = groupUses([email("2026-06-01"), email("2026-06-04"), email("2026-09-24")]);
    expect(uses.map(u => [u.from, u.to])).toEqual([["2026-09-24", "2026-09-24"], ["2026-06-01", "2026-06-04"]]);
  });
});

describe("Reasons to Buy — order", () => {
  const reasons = [
    { id: 1, name: "Free pack", description: null },
    { id: 2, name: "You've got credit", description: "Unused credit expiring" },
    { id: 3, name: "New recipe", description: null },
    { id: 4, name: "Price drop", description: null },
  ];
  it("puts never-used first, then the oldest last use", () => {
    const byReason = new Map([
      [1, [email("2026-11-17")]],
      [2, [email("2026-09-24"), email("2026-10-01")]],
      [4, [email("2026-08-01")]],
    ]);
    const s = summariseReasons(reasons, byReason, "2026-11-18");
    expect(s.map(r => r.reason.name)).toEqual(["New recipe", "Price drop", "You've got credit", "Free pack"]);
    expect(s[2].daysSince).toBe(48);
    expect(s[0].lastUse).toBeNull();
  });
  it("says how long since in plain words", () => {
    expect(sinceWords(null)).toBe("Not used in the last year");
    expect(sinceWords(0)).toBe("Used today");
    expect(sinceWords(5)).toBe("Not used for 5 days");
    expect(sinceWords(48)).toBe("Not used for 6 weeks");
    expect(sinceWords(120)).toBe("Not used for 3 months");
  });
});

describe("Reasons to Buy — signature", () => {
  it("changes when a reason is reworded, not when the list is reordered", () => {
    const a = [{ id: 1, name: "Credit", description: "x" }, { id: 2, name: "Free pack", description: null }];
    expect(reasonsSignature(a)).toBe(reasonsSignature([...a].reverse()));
    expect(reasonsSignature(a)).not.toBe(reasonsSignature([{ ...a[0], description: "y" }, a[1]]));
  });
});


describe("Reasons to Buy — reading an email", () => {
  it("turns the email's HTML into plain words", () => {
    const html = `<html><head><style>p{color:red}</style></head><body><p>You&rsquo;ve got <b>&pound;4.50</b> credit</p><p>Use it by Sunday&nbsp;{{ first_name }}</p></body></html>`;
    expect(emailText(html)).toBe("You've got £4.50 credit\nUse it by Sunday");
  });
  it("caps long emails", () => {
    expect(emailText("a".repeat(30), 10)).toBe("aaaaaaaaaa…");
    expect(emailText(null)).toBe("");
  });
});

describe("evidenceFound", () => {
  const email = "💷 Your credit expires tomorrow! ⚠️\nYou have £6.38 of credit on your account — use it before Sunday.";
  it("accepts words that are really in the email, ignoring case, punctuation and emoji", () => {
    expect(evidenceFound("your credit expires tomorrow", email)).toBe(true);
    expect(evidenceFound("You have £6.38 of credit", email)).toBe(true);
    expect(evidenceFound("“Your Credit expires TOMORROW!”", email)).toBe(true);
  });
  it("rejects words the email doesn't say — a free pack isn't credit", () => {
    const freePack = "ENDS TODAY - Last day to claim your Free Pack Offer ⏰\nYOU HAVE AN UNCLAIMED FREE PACK EXPIRING TODAY";
    expect(evidenceFound("free pack credit expiring", freePack)).toBe(false);
    expect(evidenceFound("your credit expires today", freePack)).toBe(false);
    expect(evidenceFound("unclaimed free pack expiring today", freePack)).toBe(true);
  });
  it("checks quotes joined with … piece by piece", () => {
    expect(evidenceFound("Your credit expires tomorrow! … use it before Sunday", email)).toBe(true);
    expect(evidenceFound("Your credit expires tomorrow... use it before Sunday", email)).toBe(true);
    expect(evidenceFound("Your credit expires tomorrow … loyalty credit which expires today", email)).toBe(false);
    expect(evidenceFound("credit … tomorrow", email)).toBe(false);
  });
  it("needs at least two whole words", () => {
    expect(evidenceFound("credit", email)).toBe(false);
    expect(evidenceFound("", email)).toBe(false);
    expect(evidenceFound(null, email)).toBe(false);
    expect(evidenceFound("our cred", email)).toBe(false);
  });
});

describe("guidance", () => {
  it("says the guide in one line", () => {
    expect(guideWords({ emailsPerUse: 4, daysPerUse: 7, minGapDays: 60, audiences: ["existing"] }))
      .toBe("4 emails over 7 days · Existing customers · at most every 2 months");
    expect(guideWords({ emailsPerUse: 1, daysPerUse: 1, minGapDays: 30, audiences: ["subscription", "not_ordered"] }))
      .toBe("1 email · Subscription customers, Haven't ordered yet · at most every month");
    expect(guideWords({ emailsPerUse: null, daysPerUse: null, minGapDays: null, audiences: [] })).toBe("");
  });
  it("words gaps in months, weeks or days", () => {
    expect(gapWords(90)).toBe("every 3 months");
    expect(gapWords(14)).toBe("every 2 weeks");
    expect(gapWords(7)).toBe("every week");
    expect(gapWords(10)).toBe("every 10 days");
  });
  it("is ready once the shortest gap has passed since the last use ended", () => {
    expect(readyFrom("2026-09-27", 60)).toBe("2026-11-26");
    expect(isReady("2026-09-27", 60, "2026-11-25")).toBe(false);
    expect(isReady("2026-09-27", 60, "2026-11-26")).toBe(true);
    expect(isReady("2026-09-27", null, "2026-09-28")).toBe(true);
    expect(isReady(null, 60, "2026-09-28")).toBe(true);
  });
  it("plans from ready reasons first (least recently used on top), then resting ones soonest first", () => {
    const row = (id: number, to: string | null, from: string | null, ready: boolean) => ({ id, lastUse: to ? { to } : null, readyFrom: from, ready });
    const order = planningOrder([
      row(1, "2026-11-10", "2026-12-10", false),
      row(2, "2026-10-01", null, true),
      row(3, null, null, true),
      row(4, "2026-11-01", "2026-11-29", false),
      row(5, "2026-08-01", "2026-10-01", true),
    ]).map(r => r.id);
    expect(order).toEqual([3, 5, 2, 4, 1]);
  });
});

describe("restState", () => {
  it("is yellow while the gap is more than two weeks off", () => {
    expect(restState("2026-11-17", 30, "2026-11-18")).toEqual({ kind: "resting", date: "2026-12-17" });
  });
  it("turns green (due soon) within two weeks of the date — credit for Black Friday", () => {
    expect(restState("2026-09-27", 60, "2026-11-18")).toEqual({ kind: "due_soon", date: "2026-11-26" });
    expect(restState("2026-11-17", 30, "2026-12-03")).toEqual({ kind: "due_soon", date: "2026-12-17" });
  });
  it("is due today on the date, and overdue after it while unused", () => {
    expect(restState("2026-09-27", 60, "2026-11-26")).toEqual({ kind: "due_today", date: "2026-11-26" });
    expect(restState("2026-09-27", 60, "2026-11-27")).toEqual({ kind: "overdue", date: "2026-11-26" });
  });
  it("says nothing with no gap set or no use yet", () => {
    expect(restState("2026-09-27", null, "2026-11-18")).toBeNull();
    expect(restState(null, 60, "2026-11-18")).toBeNull();
  });
});

describe("sentSyncFrom", () => {
  it("asks for the whole year the first time", () => {
    expect(sentSyncFrom(null, "2026-11-18", 365)).toBe("2025-11-18");
  });
  it("then only from a few days before the newest saved send", () => {
    expect(sentSyncFrom("2026-11-17", "2026-11-18", 365)).toBe("2026-11-14");
  });
  it("never further back than the year", () => {
    expect(sentSyncFrom("2025-11-19", "2026-11-18", 365)).toBe("2025-11-18");
  });
});

describe("efficacyOf — revenue per use, so regular reasons aren't over-credited", () => {
  it("averages over each use and each email", () => {
    // Two uses: 4 emails earning £1,000 in Sep, 1 email earning £200 in Jun.
    const uses = groupUses([
      email("2026-09-20", 250), email("2026-09-23", 250), email("2026-09-26", 250), email("2026-09-27", 250),
      email("2026-06-01", 200),
    ]);
    expect(efficacyOf(uses)).toMatchObject({ perUse: 600, perEmail: 240, uses: 2 });
  });
  it("is nothing for a reason never used", () => {
    expect(efficacyOf([])).toBeNull();
  });
});

describe("rankEfficacy — ranked, banded by thirds", () => {
  it("live 19 Nov: six reasons split two deep, two mid, two light — none left looking the same", () => {
    const m = rankEfficacy([
      { id: 1, perUse: 40731 }, // You've got credit
      { id: 2, perUse: 8358 },  // Recipe leaving the menu
      { id: 3, perUse: 4952 },  // Payday
      { id: 4, perUse: 3985 },  // Ends in 0 offer
      { id: 5, perUse: 3133 },  // Wonkyzone
      { id: 6, perUse: 3106 },  // UPF
      { id: 7, perUse: null },  // never used
    ]);
    expect([1, 2, 3, 4, 5, 6].map(id => m.get(id)?.tier)).toEqual(["top", "top", "good", "good", "low", "low"]);
    expect(m.get(6)?.rank).toBe(6);
    expect(m.has(7)).toBe(false);
  });
  it("a single reason is top", () => {
    expect(rankEfficacy([{ id: 1, perUse: 100 }]).get(1)).toEqual({ rank: 1, tier: "top" });
  });
});

describe("plannableSoon — the 'due in the next 2 weeks' filter", () => {
  it("keeps ready, due soon, due today and overdue; drops still resting", () => {
    expect(plannableSoon({ ready: true, rest: null })).toBe(true);
    expect(plannableSoon({ ready: false, rest: { kind: "due_soon", date: "2026-11-26" } })).toBe(true);
    expect(plannableSoon({ ready: true, rest: { kind: "overdue", date: "2026-04-30" } })).toBe(true);
    expect(plannableSoon({ ready: false, rest: { kind: "resting", date: "2026-12-17" } })).toBe(false);
  });
});

describe("sortReasonRows — Excel-style column sorting", () => {
  const row = (id: number, name: string, ready: boolean, readyFrom: string | null, lastTo: string | null) =>
    ({ reason: { id, name }, ready, readyFrom, lastUse: lastTo ? { to: lastTo } : null });
  const rows = [
    row(1, "Wonkyzone", false, "2026-12-17", "2026-11-17"),
    row(2, "Payday", true, "2026-04-30", "2026-03-31"),
    row(3, "Recipe leaving", false, "2026-11-29", "2026-10-30"),
    row(4, "Credit", false, "2026-11-26", "2026-09-27"),
    row(5, "UPF", true, "2026-11-08", "2026-11-05"),
    row(6, "New one", true, null, null),
  ];
  const per = new Map<number, number | null>([[1, 3133], [2, 4952], [3, 8358], [4, 40731], [5, 3106], [6, null]]);
  it("opens available soonest, then biggest earner among those available now", () => {
    expect(sortReasonRows(rows, DEFAULT_REASON_SORT, per).map(r => r.reason.id)).toEqual([2, 5, 6, 4, 3, 1]);
  });
  it("sorts by what it pulls in, never-used last either way", () => {
    expect(sortReasonRows(rows, [{ key: "revenue", dir: "desc" }], per).map(r => r.reason.id)).toEqual([4, 3, 2, 1, 5, 6]);
    expect(sortReasonRows(rows, [{ key: "revenue", dir: "asc" }], per).map(r => r.reason.id)).toEqual([5, 1, 2, 3, 4, 6]);
  });
  it("sorts by last used, most recent first, and by name", () => {
    expect(sortReasonRows(rows, [{ key: "last", dir: "desc" }], per).map(r => r.reason.id)).toEqual([1, 5, 3, 4, 2, 6]);
    expect(sortReasonRows(rows, [{ key: "name", dir: "asc" }], per).map(r => r.reason.name)).toEqual(["Credit", "New one", "Payday", "Recipe leaving", "UPF", "Wonkyzone"]);
  });
});

describe("clickSort — header clicks", () => {
  it("clicking the main column flips it", () => {
    expect(clickSort(DEFAULT_REASON_SORT, "available")).toEqual([{ key: "available", dir: "desc" }, { key: "revenue", dir: "desc" }]);
  });
  it("clicking another column makes it the main sort, keeping the old one behind it", () => {
    expect(clickSort(DEFAULT_REASON_SORT, "revenue")).toEqual([{ key: "revenue", dir: "desc" }, { key: "available", dir: "asc" }]);
    expect(clickSort(DEFAULT_REASON_SORT, "last")).toEqual([{ key: "last", dir: "desc" }, { key: "available", dir: "asc" }, { key: "revenue", dir: "desc" }]);
  });
  it("keeps at most three", () => {
    const three = clickSort(DEFAULT_REASON_SORT, "last");
    expect(clickSort(three, "name")).toHaveLength(3);
  });
});

describe("Klaviyo tags first (Graeme, 26 Nov 2026)", () => {
  const reasons = [{ id: 1, name: "You've got credit" }, { id: 6, name: "UPF" }, { id: 7, name: "Delivery slots sold out - (80% full next week)" }];
  it("matches a tag to a reason's name, ignoring case, spacing and curly quotes", () => {
    expect(reasonForTag("You've got credit", reasons)?.id).toBe(1);
    expect(reasonForTag("you\u2019ve  got Credit ", reasons)?.id).toBe(1);
    expect(reasonForTag("upf", reasons)?.id).toBe(6);
    expect(tagKey("  Delivery slots sold out - (80% full next week) ")).toBe("delivery slots sold out - (80% full next week)");
  });
  it("ignores tags that aren't a reason's name", () => {
    for (const t of ["Credit Offer", "B2B", "Winback", "UPF free", "", "credit"]) expect(reasonForTag(t, reasons)).toBeNull();
  });
  it("uses an email's tags when it has any, otherwise what reading it found", () => {
    const read = new Map([["a", new Map([[6, "ultra-processed"]])], ["b", new Map([[6, "no UPF"], [1, "credit to spend"]])]]);
    const tagged = new Map([["b", [{ reasonId: 1, tag: "You've got credit" }]], ["c", [{ reasonId: 6, tag: "UPF" }]]]);
    const out = reasonsPerEmail(read, tagged);
    expect([...out.get("a")!]).toEqual([[6, { why: "ultra-processed", source: "read" }]]);
    expect([...out.get("b")!]).toEqual([[1, { why: 'Tagged "You\'ve got credit" in Klaviyo', source: "tag" }]]);
    expect([...out.get("c")!]).toEqual([[6, { why: 'Tagged "UPF" in Klaviyo', source: "tag" }]]);
  });
});
