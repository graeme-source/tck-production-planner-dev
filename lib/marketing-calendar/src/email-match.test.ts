import { describe, expect, it } from "vitest";
import { campaignTargetScore, matchCampaignsToTargets, nameWords, planEmailMerges, type PlanForMerge } from "./email-match";

const camp = (id: string, name: string, date: string, status = "Sent", subject: string | null = null) => ({ id, name, date, status, subject });

describe("matching Klaviyo campaigns to planned emails and cycle slots", () => {
  const targets = [
    { key: "slot:2026-10-12", date: "2026-10-12", expectedName: "12 Oct – O1 Free Pack £39.95 – 1 Launch", subject: "Free pack on orders over £39.95" },
    { key: "slot:2026-10-14", date: "2026-10-14", expectedName: "14 Oct – O1 Free Pack £39.95 – 2 Follow-up", subject: "Your free pack is waiting" },
    { key: "plan:7", date: "2026-10-16", expectedName: "16 Oct – Email – Autumn Free pack Offer £39.95- Ending Tonight", subject: "Autumn Free pack Offer £39.95- Ending Tonight" },
  ];

  it("exact campaign name first — the day doesn't matter (a draft on its placeholder day)", () => {
    const r = matchCampaignsToTargets({ targets, campaigns: [camp("a", "12 oct - O1 Free Pack £39.95 - 1 Launch", "2026-10-01", "Draft")] });
    expect(r.matches).toEqual([{ campaignId: "a", campaignName: "12 oct - O1 Free Pack £39.95 - 1 Launch", targetKey: "slot:2026-10-12", how: "exact", score: 1 }]);
  });

  it("a clone with the same name: the one furthest along wins, the other stays unplanned", () => {
    const r = matchCampaignsToTargets({
      targets,
      campaigns: [camp("d", "12 Oct – O1 Free Pack £39.95 – 1 Launch (clone)", "2026-10-12", "Draft"), camp("s", "12 Oct – O1 Free Pack £39.95 – 1 Launch", "2026-10-12", "Sent")],
    });
    expect(r.matches.map(m => m.campaignId)).toEqual(["s"]);
    expect(r.unmatchedCampaignIds).toEqual(["d"]);
  });

  it("same day + similar name when the name wasn't pasted", () => {
    const r = matchCampaignsToTargets({ targets, campaigns: [camp("b", "Free pack waiting - follow up", "2026-10-14")] });
    expect(r.matches).toMatchObject([{ campaignId: "b", targetKey: "slot:2026-10-14", how: "similar" }]);
  });

  it("the only target and the only campaign that day need less", () => {
    const c = camp("c", "Free Pack - £39.95 - Last Call (clone)", "2026-10-16", "Draft", "Ends Today - FREE PACK on Orders over £39.95");
    expect(campaignTargetScore(c, targets[2])).toBeGreaterThanOrEqual(0.25);
    expect(matchCampaignsToTargets({ targets, campaigns: [c] }).matches).toMatchObject([{ campaignId: "c", targetKey: "plan:7" }]);
  });

  it("an untouched cycle slot never takes a weak match, even alone that day", () => {
    const slot = { key: "slot:2026-09-17", date: "2026-09-17", expectedName: "17 Sep – O1 Free Pack £39.95 – 3 New Angle", subject: "Family night sorted, free pack included", strict: true };
    const c = camp("w", "Free pack this weekend... + Next day delivery available", "2026-09-17");
    expect(matchCampaignsToTargets({ targets: [slot], campaigns: [c] }).matches).toEqual([]);
    expect(matchCampaignsToTargets({ targets: [{ ...slot, strict: false }], campaigns: [c] }).matches).toHaveLength(1);
  });

  it("leaves it unmatched when nothing is alike, or on another day", () => {
    const r = matchCampaignsToTargets({
      targets,
      campaigns: [camp("x", "£6.38 credit reminder", "2026-10-14"), camp("y", "Free pack waiting - follow up", "2026-10-20")],
    });
    // Two campaigns that day? No — only x is on the 14th; it isn't alike enough.
    expect(r.matches).toEqual([]);
    expect(r.unmatchedCampaignIds.sort()).toEqual(["x", "y"]);
  });

  it("never re-links an unlinked pair or a campaign already linked", () => {
    const c = camp("a", "12 Oct – O1 Free Pack £39.95 – 1 Launch", "2026-10-12");
    expect(matchCampaignsToTargets({ targets, campaigns: [c], rejected: [{ targetKey: "slot:2026-10-12", campaignId: "a" }] }).matches).toEqual([]);
    expect(matchCampaignsToTargets({ targets, campaigns: [c], linkedCampaignIds: ["a"] }).matches).toEqual([]);
  });

  it("two lookalike targets on one day: no guess", () => {
    const t2 = [
      { key: "plan:1", date: "2026-10-20", expectedName: "x", subject: "Philly launch VIP" },
      { key: "plan:2", date: "2026-10-20", expectedName: "y", subject: "Philly launch public" },
    ];
    const r = matchCampaignsToTargets({ targets: t2, campaigns: [camp("p", "Philly launch", "2026-10-20")] });
    expect(r.matches).toEqual([]);
  });

  it("keeps prices whole and drops day numbers", () => {
    expect(nameWords("12 Oct – O1 Free Pack £39.95 – 1 Launch")).toEqual(["o1", "free", "pack", "39.95", "launch"]);
  });
});

describe("tidying duplicates already in the planner", () => {
  const plan = (over: Partial<PlanForMerge> & { id: number; sendDate: string; subject: string }): PlanForMerge => ({
    status: "planned", klaviyoCampaignId: null, klaviyoCampaignName: null, campaignTitle: null, campaignName: null, cycleDate: null,
    fields: { offer: null, coreMessage: null }, notes: null, hasPlanApproval: false, ...over,
  });

  it("merges two planned emails that are the same email, keeping everything", () => {
    const r = planEmailMerges({
      plans: [
        plan({ id: 17, sendDate: "2026-11-05", subject: "End of Week Treat - Black Friday", notes: "Use the gold image", fields: { offer: "BTBF", coreMessage: null } }),
        plan({ id: 18, sendDate: "2026-11-05", subject: "End of week treat — Black Friday!", status: "created", klaviyoCampaignId: "k18", klaviyoCampaignName: "BF treat", notes: "Send 7pm", fields: { offer: null, coreMessage: "Treat yourself" } }),
      ],
      campaigns: [],
    });
    expect(r.merges).toEqual([{
      keepId: 18, dropId: 17, score: 1,
      fill: { offer: "BTBF" },
      notes: "Send 7pm\n\n(From the duplicate “End of Week Treat - Black Friday”:)\nUse the gold image",
      status: null, moveLink: null, moveApproval: false,
    }]);
  });

  it("moves the duplicate's Klaviyo link and approval to the kept one", () => {
    const r = planEmailMerges({
      plans: [
        plan({ id: 1, sendDate: "2026-10-20", subject: "Halloween starts now", hasPlanApproval: true, cycleDate: "2026-10-20" }),
        plan({ id: 2, sendDate: "2026-10-20", subject: "Halloween starts now!", status: "sent" }),
      ],
      campaigns: [],
    });
    expect(r.merges[0]).toMatchObject({ keepId: 1, dropId: 2, status: "sent", moveLink: null, moveApproval: false });
  });

  it("never merges emails linked to two different Klaviyo campaigns, or different subjects", () => {
    const r = planEmailMerges({
      plans: [
        plan({ id: 1, sendDate: "2026-10-20", subject: "Philly VIP", klaviyoCampaignId: "a" }),
        plan({ id: 2, sendDate: "2026-10-20", subject: "Philly VIP", klaviyoCampaignId: "b" }),
        plan({ id: 3, sendDate: "2026-10-20", subject: "Credit reminder" }),
      ],
      campaigns: [],
    });
    expect(r.merges).toEqual([]);
  });

  it("links plans to the Klaviyo campaign that is the same email, and is idempotent", () => {
    const plans = [plan({ id: 45, sendDate: "2026-10-16", subject: "Autumn Free pack Offer £39.95- Ending Tonight" })];
    const campaigns = [camp("c", "Free Pack - £39.95 - Last Call (clone)", "2026-10-16", "Draft", "Ends Today - FREE PACK on Orders over £39.95")];
    const r = planEmailMerges({ plans, campaigns });
    expect(r.links).toMatchObject([{ emailId: 45, campaignId: "c", how: "similar" }]);
    const again = planEmailMerges({ plans: [{ ...plans[0], klaviyoCampaignId: "c" }], campaigns });
    expect(again).toEqual({ merges: [], links: [] });
  });
});
