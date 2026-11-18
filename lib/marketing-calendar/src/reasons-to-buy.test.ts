import { describe, expect, it } from "vitest";
import { emailText, evidenceFound, restState, gapWords, guideWords, isReady, planningOrder, readyFrom, groupUses, reasonsSignature, sinceWords, summariseReasons, type ReasonEmail } from "./reasons-to-buy";

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
