import { describe, expect, it } from "vitest";
import { approvalLabel, awaitsApproval, changedSinceApproval, emailApprovalStatus, klaviyoApprovalKey, sameSendTime, type ApprovalSnapshot, type EmailFacts } from "./email-approvals";

const email: EmailFacts = {
  status: "Scheduled", date: "2026-10-22", sendAt: "2026-10-22T09:00:00+00:00",
  subject: "Halloween is coming", previewText: "Free pack inside",
};
const approved: ApprovalSnapshot = {
  approved: true, subject: "Halloween is coming", previewText: "Free pack inside", sendAt: "2026-10-22T09:00:00.000Z", full: true,
};

describe("approval changed detection", () => {
  it("stays approved when nothing changed (send time spelt differently)", () => {
    expect(sameSendTime("2026-10-22T09:00:00+00:00", "2026-10-22T09:00:30.000Z")).toBe(true);
    expect(emailApprovalStatus(approved, email)).toEqual({ status: "approved", changed: [] });
  });
  it("goes back to Needs approval when the subject, preview or send time changes", () => {
    expect(emailApprovalStatus(approved, { ...email, subject: "Halloween is HERE" }))
      .toEqual({ status: "needs_approval", changed: ["subject line"] });
    expect(emailApprovalStatus(approved, { ...email, previewText: null }).changed).toEqual(["preview text"]);
    expect(emailApprovalStatus(approved, { ...email, sendAt: "2026-10-23T09:00:00Z" }).changed).toEqual(["send time"]);
    expect(emailApprovalStatus(approved, { ...email, sendAt: null }).changed).toEqual(["send time"]);
  });
  it("ignores spacing in the words", () => {
    expect(changedSinceApproval(approved, { ...email, subject: " Halloween  is coming " })).toEqual([]);
  });
  it("judges an older subject-only approval on the subject alone", () => {
    const old = { ...approved, previewText: null, sendAt: null, full: false };
    expect(emailApprovalStatus(old, email).status).toBe("approved");
    expect(emailApprovalStatus(old, { ...email, subject: "x" }).status).toBe("needs_approval");
  });
  it("needs approval when never approved or approval undone", () => {
    expect(emailApprovalStatus(null, email).status).toBe("needs_approval");
    expect(emailApprovalStatus({ ...approved, approved: false }, email)).toEqual({ status: "needs_approval", changed: [] });
  });
});

describe("what waits for approval", () => {
  const today = "2026-10-20";
  it("counts unapproved drafts and scheduled emails from today on", () => {
    expect(awaitsApproval({ ...email, status: "Draft", date: "2026-10-20" }, "needs_approval", today)).toBe(true);
    expect(awaitsApproval(email, "needs_approval", today)).toBe(true);
    expect(awaitsApproval(email, "approved", today)).toBe(false);
  });
  it("counts a draft with no date yet", () => {
    expect(awaitsApproval({ ...email, status: "Draft", date: null, sendAt: null }, "needs_approval", today)).toBe(true);
  });
  it("never counts sent emails or a draft parked on a past day", () => {
    expect(awaitsApproval({ ...email, status: "Sent", date: "2026-10-21" }, "needs_approval", today)).toBe(false);
    expect(awaitsApproval({ ...email, status: "Draft", date: "2026-10-01" }, "needs_approval", today)).toBe(false);
  });
});

describe("labels and keys", () => {
  it("words the status", () => {
    expect(approvalLabel("approved", "Graeme Carter")).toBe("Approved by Graeme");
    expect(approvalLabel("approved", null)).toBe("Approved");
    expect(approvalLabel("needs_approval", null)).toBe("Needs approval");
    expect(approvalLabel("needs_approval", null, ["subject line"])).toBe("Needs approval — subject line changed");
  });
  it("keys approvals by Klaviyo campaign", () => {
    expect(klaviyoApprovalKey("01ABC")).toBe("klaviyo:01ABC");
  });
});
