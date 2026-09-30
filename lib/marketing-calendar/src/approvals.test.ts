import { describe, it, expect } from "vitest";
import {
  approvalBadge, approvalKey, approvalState, buildApprovalItems, effectiveStage, needsApproval, stageFromKlaviyo,
} from "./index";

const TODAY = "2026-10-01";

describe("stages", () => {
  it("maps Klaviyo's status to a stage", () => {
    expect(stageFromKlaviyo("Draft")).toBe("created");
    expect(stageFromKlaviyo("Scheduled")).toBe("scheduled");
    expect(stageFromKlaviyo("Sending")).toBe("scheduled");
    expect(stageFromKlaviyo("Sent")).toBe("sent");
    expect(stageFromKlaviyo("Cancelled")).toBeNull();
  });

  it("a linked plan takes its stage from Klaviyo; unlinked keeps the hand-set one", () => {
    expect(effectiveStage({ status: "planned", klaviyoCampaignId: "k1" }, { status: "Draft" })).toEqual({ stage: "created", fromKlaviyo: true });
    expect(effectiveStage({ status: "planned", klaviyoCampaignId: "k1" }, { status: "Sent" })).toEqual({ stage: "sent", fromKlaviyo: true });
    expect(effectiveStage({ status: "scheduled", klaviyoCampaignId: null }, null)).toEqual({ stage: "scheduled", fromKlaviyo: false });
    // Linked but the campaign is out of view: fall back, don't guess.
    expect(effectiveStage({ status: "created", klaviyoCampaignId: "k1" }, null)).toEqual({ stage: "created", fromKlaviyo: false });
    // Old values read as planned.
    expect(effectiveStage({ status: "idea", klaviyoCampaignId: null }, null).stage).toBe("planned");
  });
});

describe("approval keys — one approval per thing", () => {
  it("an unlinked plan is keyed by its id; a linked plan shares its campaign's key", () => {
    expect(approvalKey({ kind: "plan", emailId: 7, klaviyoCampaignId: null })).toBe("plan:7");
    expect(approvalKey({ kind: "plan", emailId: 7, klaviyoCampaignId: "01ABC" })).toBe("klaviyo:01ABC");
    expect(approvalKey({ kind: "klaviyo", klaviyoCampaignId: "01ABC" })).toBe("klaviyo:01ABC");
  });
});

describe("approvalState", () => {
  const a = { key: "klaviyo:1", approved: true, subject: "Early access starts now" };
  it("approved while the subject line is what was approved (spacing ignored)", () => {
    expect(approvalState(a, "Early access starts now")).toBe("approved");
    expect(approvalState(a, "  Early access  starts now ")).toBe("approved");
  });
  it("changed since approval when the subject line differs", () => {
    expect(approvalState(a, "Early access starts NOW")).toBe("changed");
    expect(approvalState(a, null)).toBe("changed");
  });
  it("an unknown current subject never flags a change", () => {
    expect(approvalState(a, undefined)).toBe("approved");
  });
  it("none when never approved or undone", () => {
    expect(approvalState(null, "x")).toBe("none");
    expect(approvalState({ ...a, approved: false }, "Early access starts now")).toBe("none");
  });
});

describe("needsApproval — the reminder rule", () => {
  const base = { date: TODAY, stage: "created" as const, approval: "none" as const, today: TODAY };
  it("nags for a draft or scheduled email from today on that isn't approved", () => {
    expect(needsApproval(base)).toBe(true);
    expect(needsApproval({ ...base, stage: "scheduled", date: "2026-11-20" })).toBe(true);
  });
  it("nags again when it changed since approval", () => {
    expect(needsApproval({ ...base, approval: "changed" })).toBe(true);
  });
  it("doesn't nag once approved", () => {
    expect(needsApproval({ ...base, approval: "approved" })).toBe(false);
  });
  it("plans still only planned don't nag; sent is too late", () => {
    expect(needsApproval({ ...base, stage: "planned" })).toBe(false);
    expect(needsApproval({ ...base, stage: "sent" })).toBe(false);
  });
  it("past emails and undated ones don't nag", () => {
    expect(needsApproval({ ...base, date: "2026-09-30" })).toBe(false);
    expect(needsApproval({ ...base, date: null })).toBe(false);
  });
});

describe("buildApprovalItems", () => {
  const plans = [
    { id: 1, sendDate: "2026-10-05", subject: "Plan only", status: "planned", klaviyoCampaignId: null },
    { id: 2, sendDate: "2026-10-06", subject: "Hand-set scheduled", status: "scheduled", klaviyoCampaignId: null },
    { id: 3, sendDate: "2026-10-09", subject: "Linked plan", status: "planned", klaviyoCampaignId: "kLinked" },
  ];
  const klaviyo = [
    { id: "kLinked", name: "BF early", status: "Draft", date: "2026-09-20", subject: "Early access" },
    { id: "kSched", name: "Payday", status: "Scheduled", date: "2026-10-10", subject: "Payday treats" },
    { id: "kSent", name: "Old", status: "Sent", date: "2026-09-01", subject: "Gone" },
    { id: "kDraftPast", name: "Stale draft", status: "Draft", date: "2026-08-01", subject: "" },
  ];

  it("lists a linked plan once, with Klaviyo's stage and the plan's day while it's a draft", () => {
    const items = buildApprovalItems({ planned: plans, klaviyo, approvals: [], today: TODAY });
    expect(items.map(i => i.key)).toEqual(["klaviyo:kDraftPast", "klaviyo:kSent", "plan:1", "plan:2", "klaviyo:kLinked", "klaviyo:kSched"]);
    const linked = items.find(i => i.key === "klaviyo:kLinked")!;
    expect(linked.kind).toBe("plan");
    expect(linked.stage).toBe("created");
    expect(linked.date).toBe("2026-10-09");
    expect(linked.subject).toBe("Early access");
  });

  it("flags exactly the upcoming drafts/scheduled that aren't approved", () => {
    const items = buildApprovalItems({ planned: plans, klaviyo, approvals: [], today: TODAY });
    expect(items.filter(i => i.needsApproval).map(i => i.key)).toEqual(["plan:2", "klaviyo:kLinked", "klaviyo:kSched"]);
  });

  it("an approval on the campaign covers the linked plan; a changed subject needs it again", () => {
    const approvals = [
      { key: "klaviyo:kLinked", approved: true, subject: "Early access" },
      { key: "klaviyo:kSched", approved: true, subject: "Payday treats (old)" },
      { key: "plan:2", approved: true, subject: "Hand-set scheduled" },
    ];
    const items = buildApprovalItems({ planned: plans, klaviyo, approvals, today: TODAY });
    const by = new Map(items.map(i => [i.key, i]));
    expect(by.get("klaviyo:kLinked")!.state).toBe("approved");
    expect(by.get("plan:2")!.state).toBe("approved");
    expect(by.get("klaviyo:kSched")!.state).toBe("changed");
    expect(items.filter(i => i.needsApproval).map(i => i.key)).toEqual(["klaviyo:kSched"]);
  });

  it("a scheduled campaign's own day wins over the plan's", () => {
    const items = buildApprovalItems({
      planned: [{ ...plans[2], klaviyoCampaignId: "kSched" }],
      klaviyo, approvals: [], today: TODAY,
    });
    expect(items.find(i => i.key === "klaviyo:kSched")!.date).toBe("2026-10-10");
  });
});

describe("approvalBadge", () => {
  it("says who approved, or what's needed", () => {
    expect(approvalBadge("approved", false, "Graeme Carter")).toEqual({ label: "Approved by Graeme", tone: "green" });
    expect(approvalBadge("changed", true, "Graeme Carter")).toEqual({ label: "Changed since approval", tone: "amber" });
    expect(approvalBadge("none", true, null)).toEqual({ label: "Needs approval", tone: "amber" });
    expect(approvalBadge("none", false, null)).toEqual({ label: "Not approved", tone: "grey" });
  });
});
