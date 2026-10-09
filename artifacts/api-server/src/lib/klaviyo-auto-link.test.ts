import { describe, expect, it } from "vitest";
import {
  AUTO_LINK_MIN, autoLinkInfo, describeAutoLink, matchKlaviyoToPlans, matchWords, scorePairs, textScore, unlinkedPairsFrom,
  type CampaignForMatch, type PlanForMatch,
} from "./klaviyo-auto-link";

const plan = (id: number, subject: string, sendDate = "2026-11-20", extra: Partial<PlanForMatch> = {}): PlanForMatch =>
  ({ id, subject, sendDate, klaviyoCampaignId: null, ...extra });
const camp = (id: string, name: string, subject: string | null = null, date = "2026-10-09", status: CampaignForMatch["status"] = "Draft"): CampaignForMatch =>
  ({ id, name, subject, status, date });

// A few unrelated campaigns, as Klaviyo always has.
const background = [
  camp("bg1", "Payday Freepack", "Payday treat: a free pack on us 🎁", "2026-09-25", "Sent"),
  camp("bg2", "Philly 2.0 launch", "Philly 2.0 is here", "2026-09-12", "Sent"),
  camp("bg3", "Winter Warmers announcement", "Pies are back", "2026-10-01", "Sent"),
];

describe("matchWords — normalising names and subject lines", () => {
  it("drops emoji, punctuation, little words, Klaviyo noise and dates", () => {
    expect(matchWords("🖤 Black Friday – Early Access!! (Copy) 24 Nov 2026")).toEqual(["black", "friday", "early", "access"]);
    expect(matchWords("Your early access starts NOW")).toEqual(["early", "access", "start"]);
    expect(matchWords("Draft v2: VIP launch")).toEqual(["vip", "launch"]);
  });
  it("ignores accents and plurals", () => {
    expect(matchWords("Crème brûlée boxes")).toEqual(["creme", "brulee", "box"]);
  });
});

describe("textScore", () => {
  it("treats initials as the words they stand for (BF = Black Friday)", () => {
    const r = textScore(matchWords("BF early access"), matchWords("Black Friday – early access (draft)"));
    expect(r.score).toBe(1);
  });
  it("needs at least two words in common unless both sides are the whole thing", () => {
    expect(textScore(matchWords("Launch day"), matchWords("Properoni launch")).score).toBe(0);
    expect(textScore(matchWords("Halloween"), matchWords("Halloween (copy)")).score).toBe(1);
  });
});

describe("matchKlaviyoToPlans", () => {
  it("links an exact match", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Your early access starts now")],
      campaigns: [...background, camp("k1", "BF early access", "Your early access starts now")],
    });
    expect(r.links.map(l => [l.emailId, l.campaignId])).toEqual([[1, "k1"]]);
    expect(r.links[0].field).toBe("subject");
  });

  it("links a partial match: abbreviation and a longer Klaviyo name", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "BF early access"), plan(2, "Properoni launch", "2026-10-20")],
      campaigns: [
        ...background,
        camp("k1", "Black Friday – early access (draft)"),
        camp("k2", "VIP: Properoni Test Box launch", "Meet the Properoni 🍕"),
      ],
    });
    expect(r.links.map(l => [l.emailId, l.campaignId]).sort()).toEqual([[1, "k1"], [2, "k2"]]);
    expect(r.links.every(l => l.score >= AUTO_LINK_MIN)).toBe(true);
  });

  it("emoji and punctuation noise don't stop a match", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Winter warmers are here!")],
      campaigns: [camp("k1", "❄️❄️ WINTER-WARMERS… are HERE 🔥 (Copy)")],
    });
    expect(r.links.map(l => l.campaignId)).toEqual(["k1"]);
  });

  it("two similar drafts: no automatic link, both offered as suggestions", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Black Friday early access")],
      campaigns: [
        ...background,
        camp("k1", "Black Friday early access – VIPs"),
        camp("k2", "Black Friday early access – everyone"),
      ],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions.map(s => s.campaignId).sort()).toEqual(["k1", "k2"]);
  });

  it("suggests only close contenders, not a weak match behind two strong ones", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(42, "Properoni Test Box — VIP launch", "2026-10-02")],
      campaigns: [
        camp("k1", "Properoni Test Box (VIP)", null, "2026-10-02", "Sent"),
        camp("k2", "Properoni Test Box 2 (VIP)", null, "2026-10-05", "Sent"),
        camp("old", "Create TCK June Test Box Launch (VIP) REMINDER", "Last chance to order June test box", "2023-06-11", "Draft"),
      ],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions.map(s => s.campaignId)).toEqual(["k1", "k2"]);
  });

  it("two similar plans for one draft: no automatic link either", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Black Friday early access"), plan(2, "Black Friday early access reminder")],
      campaigns: [camp("k1", "Black Friday early access")],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it("scheduled or sent more than 21 days from the plan: never linked or suggested", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Properoni launch", "2026-11-20")],
      campaigns: [camp("k1", "Properoni launch", null, "2026-10-01", "Sent")],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("a draft's placeholder day barely counts — weeks away still links", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Properoni launch", "2026-12-20")],
      campaigns: [camp("k1", "Properoni launch", null, "2026-10-09", "Draft")],
    });
    expect(r.links.map(l => l.campaignId)).toEqual(["k1"]);
  });

  it("a scheduled send a few days from the plan still links", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Properoni launch", "2026-11-20")],
      campaigns: [camp("k1", "Properoni launch", null, "2026-11-23", "Scheduled")],
    });
    expect(r.links.map(l => l.campaignId)).toEqual(["k1"]);
  });

  it("skips plans already linked, deleted plans, and campaigns linked elsewhere", () => {
    const r = matchKlaviyoToPlans({
      plans: [
        plan(1, "Properoni launch", "2026-11-20", { klaviyoCampaignId: "kX" }),
        plan(2, "Black Friday early access", "2026-11-20", { deleted: true }),
        plan(3, "Winter warmers are here"),
      ],
      campaigns: [camp("k1", "Properoni launch"), camp("k2", "Black Friday early access"), camp("k3", "Winter warmers are here")],
      linkedCampaignIds: ["k3"],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("never re-links (or suggests) a pair someone unlinked", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Properoni launch")],
      campaigns: [camp("k1", "Properoni launch")],
      unlinkedPairs: [{ emailId: 1, campaignId: "k1" }],
    });
    expect(r.links).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("unrelated campaigns are not suggested", () => {
    const r = matchKlaviyoToPlans({ plans: [plan(1, "Christmas order deadline")], campaigns: background });
    expect(r.links).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it("words in lots of campaigns count for less", () => {
    const pairs = scorePairs({
      plans: [plan(1, "VIP offer Properoni")],
      campaigns: [
        camp("k1", "VIP offer – winter"), camp("k2", "VIP offer – payday"), camp("k3", "VIP offer – autumn"),
        camp("k4", "Properoni VIP"),
      ],
    });
    expect(pairs[0].campaignId).toBe("k4");
  });
});

describe("history: unlinked pairs and how the current link was made", () => {
  const at = new Date("2026-10-09T10:00:00Z");
  it("an unlink, or switching to another campaign, marks the old pair as unlinked on purpose", () => {
    expect(unlinkedPairsFrom([
      { emailId: 1, changes: { klaviyoCampaignId: { from: null, to: "k1" } } },
      { emailId: 1, changes: { klaviyoCampaignId: { from: "k1", to: null } } },
      { emailId: 2, changes: { klaviyoCampaignId: { from: "k2", to: "k3" } } },
      { emailId: 3, changes: { subject: { from: "a", to: "b" } } },
      { emailId: 4, changes: null },
    ])).toEqual([{ emailId: 1, campaignId: "k1" }, { emailId: 2, campaignId: "k2" }]);
  });
  it("feeds the matcher: a pair taken apart in history is never re-linked", () => {
    const r = matchKlaviyoToPlans({
      plans: [plan(1, "Properoni launch")],
      campaigns: [camp("k1", "Properoni launch")],
      unlinkedPairs: unlinkedPairsFrom([{ emailId: 1, changes: { klaviyoCampaignId: { from: "k1", to: null } } }]),
    });
    expect(r.links).toEqual([]);
  });
  it("says Linked automatically only when the latest link to the current campaign was automatic", () => {
    const auto = { changes: { klaviyoCampaignId: { from: null, to: "k1" }, auto: { matched: "name “Properoni launch”" } }, createdAt: at };
    const manual = { changes: { klaviyoCampaignId: { from: null, to: "k1" } }, createdAt: at };
    expect(autoLinkInfo("k1", [auto])).toEqual({ matched: "name “Properoni launch”", at: at.toISOString() });
    expect(autoLinkInfo("k1", [manual, auto])).toBeNull();
    expect(autoLinkInfo(null, [auto])).toBeNull();
    expect(autoLinkInfo("k2", [auto])).toBeNull();
  });
});

describe("describeAutoLink", () => {
  it("says what matched", () => {
    expect(describeAutoLink({ campaignName: "Black Friday – early access", planSubject: "BF early access", field: "name", fieldText: "Black Friday – early access" }))
      .toBe("linked automatically to the Klaviyo email “Black Friday – early access” (matched “BF early access” to its name)");
    expect(describeAutoLink({ campaignName: "BF1", planSubject: "Early access", field: "subject", fieldText: "Early access starts now" }))
      .toBe("linked automatically to the Klaviyo email “BF1” (matched “Early access” to its subject line “Early access starts now”)");
  });
});
