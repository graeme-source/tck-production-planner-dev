import { describe, expect, it } from "vitest";
import {
  entryReviewFact, meetingReviewFact, needsPolicyReview, policyTriggerLine, policyTriggerStatus, triggerReachedOn,
  type PolicyReviewFact,
} from "./policy-trigger";

const LATES = ["2026-03-02", "2026-04-07", "2026-05-11", "2026-06-01", "2026-07-06", "2026-08-03", "2026-09-07", "2026-10-05"];
const review = (date: string, held: boolean, extra: Partial<PolicyReviewFact> = {}): PolicyReviewFact =>
  ({ source: "meeting", id: 1, date, held, covers: ["sickness", "lates"], ...extra });
const lates = (instanceDates: string[], reviews: PolicyReviewFact[] = []) =>
  policyTriggerStatus("lates", { threshold: 6, instanceDates, reviews });

describe("triggerReachedOn", () => {
  it("is the Nth instance, oldest first, whatever order they arrive in", () => {
    expect(triggerReachedOn([...LATES].reverse(), 6)).toBe("2026-08-03");
    expect(triggerReachedOn(LATES.slice(0, 5), 6)).toBeNull();
  });
});

describe("policyTriggerStatus", () => {
  it("not reached → null, and nothing nags", () => {
    expect(lates(LATES.slice(0, 5))).toBeNull();
    expect(needsPolicyReview(null)).toBe(false);
  });

  it("due: reached, no review since", () => {
    const s = lates(LATES);
    expect(s).toMatchObject({ state: "due", count: 8, reachedOn: "2026-08-03" });
    expect(needsPolicyReview(s)).toBe(true);
  });

  it("a review before the trigger was reached doesn't count", () => {
    expect(lates(LATES, [review("2026-08-02", true)])?.state).toBe("due");
  });

  it("booked: a review booked on/after the day it was reached, not held yet", () => {
    const s = lates(LATES, [review("2026-10-20", false)]);
    expect(s).toMatchObject({ state: "booked", booked: { date: "2026-10-20" } });
    expect(needsPolicyReview(s)).toBe(false);
    // On the very day it was reached counts too.
    expect(lates(LATES, [review("2026-08-03", false)])?.state).toBe("booked");
  });

  it("Nozomi: 8 lates, review held 12 Oct after the 8th late, none since → handled", () => {
    const s = lates(LATES, [review("2026-10-12", true, { id: 42 })]);
    expect(s).toMatchObject({ state: "handled", count: 8, lastReview: { source: "meeting", id: 42, date: "2026-10-12" }, sinceReview: 0 });
    expect(needsPolicyReview(s)).toBe(false);
    expect(policyTriggerLine(s!, 12)).toBe("Policy trigger reached (8 lates) — reviewed 12 Oct 2026");
  });

  it("due again: held, then more lates and still over the trigger", () => {
    const s = lates([...LATES, "2026-10-14", "2026-10-19"], [review("2026-10-12", true)]);
    expect(s).toMatchObject({ state: "due_again", sinceReview: 2 });
    expect(needsPolicyReview(s)).toBe(true);
    expect(policyTriggerLine(s!, 12)).toBe("2 more lates since the review on 12 Oct 2026 — the policy calls for a follow-up");
  });

  it("a late on the review day itself is not 'since' the review", () => {
    expect(lates(LATES, [review("2026-10-05", true)])?.state).toBe("handled");
  });

  it("due again with a follow-up already booked → booked", () => {
    const s = lates([...LATES, "2026-10-14"], [review("2026-10-12", true), review("2026-10-26", false, { id: 2 })]);
    expect(s).toMatchObject({ state: "booked", lastReview: { date: "2026-10-12" }, booked: { id: 2, date: "2026-10-26" }, sinceReview: 1 });
  });

  it("only reviews that cover this kind count", () => {
    const timekeepingOnly = review("2026-10-12", true, { source: "entry", covers: ["lates"] });
    expect(lates(LATES, [timekeepingOnly])?.state).toBe("handled");
    const sick = ["2026-01-05", "2026-03-02", "2026-05-04", "2026-08-03"];
    expect(policyTriggerStatus("sickness", { threshold: 4, instanceDates: sick, reviews: [timekeepingOnly] })?.state).toBe("due");
  });

  it("sickness: due again after a new instance", () => {
    const sick = ["2026-01-05", "2026-03-02", "2026-05-04", "2026-08-03", "2026-10-01"];
    const s = policyTriggerStatus("sickness", { threshold: 4, instanceDates: sick, reviews: [review("2026-08-20", true)] });
    expect(s).toMatchObject({ state: "due_again", sinceReview: 1 });
    expect(policyTriggerLine(s!, 12)).toBe("1 more sickness instance since the review on 20 Aug 2026 — the policy calls for a follow-up");
  });
});

describe("review sources", () => {
  const m = { id: 7, kind: "review", status: "held", scheduledFor: "2026-10-12", heldAt: "2026-10-12T15:00:00Z", createdAt: "2026-10-01T09:00:00Z" };

  it("meetings diary: a held review counts; cancelled never does", () => {
    expect(meetingReviewFact(m)).toMatchObject({ source: "meeting", id: 7, date: "2026-10-12", held: true });
    expect(meetingReviewFact({ ...m, status: "cancelled" })).toBeNull();
    expect(lates(LATES, [meetingReviewFact({ ...m, status: "cancelled" })].filter((x): x is PolicyReviewFact => x != null))?.state).toBe("due");
    expect(meetingReviewFact({ ...m, status: "booked" })).toMatchObject({ held: false });
  });

  it("meetings diary: only review meetings count", () => {
    expect(meetingReviewFact({ ...m, kind: "probation" })).toBeNull();
    expect(meetingReviewFact({ ...m, kind: "one_to_one" })).toBeNull();
  });

  it("employment record: attendance-evidence entries, dated by their meeting", () => {
    const today = "2026-10-12";
    expect(entryReviewFact({ id: 3, evidence: "timekeeping", meetingDate: "2026-10-12", entryDate: "2026-10-10" }, today))
      .toMatchObject({ source: "entry", date: "2026-10-12", held: true, covers: ["lates"] });
    expect(entryReviewFact({ id: 3, evidence: "attendance", meetingDate: "2026-10-20", entryDate: "2026-10-10" }, today))
      .toMatchObject({ held: false, covers: ["sickness", "lates"] });
    expect(entryReviewFact({ id: 3, evidence: "attendance", meetingDate: null, entryDate: "2026-10-10" }, today))
      .toMatchObject({ date: "2026-10-10", held: true });
    expect(entryReviewFact({ id: 3, evidence: null, meetingDate: "2026-10-12", entryDate: "2026-10-12" }, today)).toBeNull();
  });

  it("either source handles the trigger", () => {
    const entry = entryReviewFact({ id: 9, evidence: "timekeeping", meetingDate: "2026-10-12", entryDate: "2026-10-12" }, "2026-10-12")!;
    expect(lates(LATES, [entry])).toMatchObject({ state: "handled", lastReview: { source: "entry", id: 9 } });
    expect(lates(LATES, [meetingReviewFact(m)!])).toMatchObject({ state: "handled", lastReview: { source: "meeting", id: 7 } });
  });
});
