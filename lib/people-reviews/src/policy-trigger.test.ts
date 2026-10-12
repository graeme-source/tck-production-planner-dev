import { describe, expect, it } from "vitest";
import {
  entryReviewFact, needsPolicyReview, policyTriggerLine, policyTriggerStatus, triggerReachedOn,
  type PolicyReviewFact,
} from "./policy-trigger";

const LATES = ["2026-03-02", "2026-04-07", "2026-05-11", "2026-06-01", "2026-07-06", "2026-08-03", "2026-09-07", "2026-10-05"];
const review = (date: string, held: boolean, extra: Partial<PolicyReviewFact> = {}): PolicyReviewFact =>
  ({ source: "entry", id: 1, date, held, covers: ["sickness", "lates"], ...extra });
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
    expect(s).toMatchObject({ state: "handled", count: 8, lastReview: { source: "entry", id: 42, date: "2026-10-12" }, sinceReview: 0 });
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

describe("review sources (one review, classified — migration 0178)", () => {
  const today = "2026-10-12";
  const e = { id: 7, meetingStatus: "held" as string | null, evidence: null as string | null, meetingDate: "2026-10-12" as string | null, entryDate: "2026-10-01" };

  it("any review that isn't cancelled counts, whatever its classification", () => {
    expect(entryReviewFact(e, today)).toMatchObject({ source: "entry", id: 7, date: "2026-10-12", held: true, covers: ["sickness", "lates"] });
    expect(entryReviewFact({ ...e, evidence: "timekeeping" }, today)?.covers).toEqual(["sickness", "lates"]);
    expect(entryReviewFact({ ...e, meetingStatus: "cancelled" }, today)).toBeNull();
    expect(entryReviewFact({ ...e, meetingStatus: "cancelled", evidence: "attendance" }, today)).toBeNull();
  });

  it("booked = not held until it's marked held or its day comes", () => {
    expect(entryReviewFact({ ...e, meetingStatus: "booked", meetingDate: "2026-10-20" }, today)).toMatchObject({ held: false });
    expect(entryReviewFact({ ...e, meetingStatus: "booked", meetingDate: "2026-10-12" }, today)).toMatchObject({ held: true });
    expect(entryReviewFact({ ...e, meetingStatus: "held", meetingDate: "2026-10-20" }, today)).toMatchObject({ held: true });
  });

  it("dated by its meeting, else the entry date", () => {
    expect(entryReviewFact({ ...e, meetingDate: null }, today)).toMatchObject({ date: "2026-10-01" });
  });

  it("an entry with no meeting counts only through its classification's attendance evidence", () => {
    const plain = { ...e, meetingStatus: null, meetingDate: null };
    expect(entryReviewFact(plain, today)).toBeNull();
    expect(entryReviewFact({ ...plain, evidence: "timekeeping" }, today)).toMatchObject({ covers: ["lates"], held: true });
    expect(entryReviewFact({ ...plain, evidence: "attendance" }, today)).toMatchObject({ covers: ["sickness", "lates"] });
  });

  it("Nozomi after the migration: her old 'review' meeting (held 12 Oct) is now a Performance appraisal entry — still handled", () => {
    // 0178 maps kind review -> Performance appraisal (no attendance evidence),
    // meeting_status held, meeting_date 12 Oct.
    const migrated = entryReviewFact({ id: 31, meetingStatus: "held", evidence: null, meetingDate: "2026-10-12", entryDate: "2026-10-12" }, today)!;
    expect(lates(LATES, [migrated])).toMatchObject({ state: "handled", count: 8, lastReview: { source: "entry", id: 31, date: "2026-10-12" } });
    expect(policyTriggerLine(lates(LATES, [migrated])!, 12)).toBe("Policy trigger reached (8 lates) — reviewed 12 Oct 2026");
  });

  it("a review booked after the day it was reached, any classification, is booked; cancelling it puts the trigger back to due", () => {
    const booked = entryReviewFact({ id: 5, meetingStatus: "booked", evidence: null, meetingDate: "2026-10-26", entryDate: "2026-10-12" }, today)!;
    expect(lates(LATES, [booked])?.state).toBe("booked");
    const cancelled = entryReviewFact({ id: 5, meetingStatus: "cancelled", evidence: null, meetingDate: "2026-10-26", entryDate: "2026-10-12" }, today);
    expect(cancelled).toBeNull();
    expect(lates(LATES, [])?.state).toBe("due");
  });
});
