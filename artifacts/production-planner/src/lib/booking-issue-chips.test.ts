import { describe, it, expect } from "vitest";
import { issueChips, shortDay, type ChipInput } from "./booking-issue-chips";

const base = (over: Partial<ChipInput> = {}): ChipInput => ({
  done: false, scenario: "other", resolvedAt: null, resolvedNote: null, dealtWithAt: null, dealtWithBy: null,
  state: { emailedAt: null, rescheduledTo: null, escalatedAt: null, escalatedBy: null, refundDone: false },
  ...over,
});

describe("issueChips", () => {
  it("nothing done yet → no chips (except a refund still needed)", () => {
    expect(issueChips(base())).toEqual([]);
    expect(issueChips(base({ scenario: "cant_deliver" })).map(c => c.label)).toEqual(["Refund needed"]);
  });
  it("shows what has been done, in a fixed order", () => {
    const chips = issueChips(base({
      scenario: "cant_deliver",
      state: { emailedAt: "2026-10-09T09:00:00Z", rescheduledTo: null, escalatedAt: "2026-10-09T09:01:00Z", escalatedBy: "Grant", refundDone: true },
    }));
    expect(chips.map(c => c.label)).toEqual(["Email sent ✓", "Escalated by Grant", "Refund done ✓"]);
  });
  it("a reschedule names the new day", () => {
    const chips = issueChips(base({ state: { emailedAt: null, rescheduledTo: "2026-10-13", escalatedAt: null, escalatedBy: null, refundDone: false } }));
    expect(chips[0].label).toBe("Rescheduled to Tue 13 Oct ✓");
  });
  it("booked later carries the waybill", () => {
    expect(issueChips(base({ resolvedAt: "x", resolvedNote: "Booked — WB1" }))[0].label).toBe("Booked ✓ — WB1");
  });
});

describe("shortDay", () => {
  it("formats a tag date", () => { expect(shortDay("2026-10-10")).toBe("Sat 10 Oct"); });
  it("passes anything else through", () => { expect(shortDay("another day")).toBe("another day"); });
});

import { issueWarnings, stableIssueOrder } from "./booking-issue-chips";

describe("issueWarnings", () => {
  const w = (o: Partial<Parameters<typeof issueWarnings>[0]> = {}) => issueWarnings({
    done: false, scenario: "saturday_temporary", resolvedAt: null, attempts: 1, postcode: "SS7 2UJ",
    postcodeAdvice: null, state: { refundDone: false, escalatedAt: null }, ...o,
  }).map(x => x.label);
  it("a plain open issue has none", () => expect(w()).toEqual([]));
  it("flags a call to APC, a refund, repeated failures, no postcode and a manager", () => {
    expect(w({ postcodeAdvice: { call: { phone: "01908" } } })).toEqual(["Call APC"]);
    expect(w({ scenario: "cant_deliver" })).toEqual(["Refund needed"]);
    expect(w({ scenario: "cant_deliver", state: { refundDone: true, escalatedAt: null } })).toEqual([]);
    expect(w({ attempts: 3, postcode: null })).toEqual(["No postcode", "Failed 3 times"]);
    expect(w({ state: { refundDone: false, escalatedAt: "2026-11-27T10:00:00Z" } })).toEqual(["With a manager"]);
  });
  it("a done row warns about nothing", () => expect(w({ done: true, attempts: 5 })).toEqual([]));
});

describe("stableIssueOrder", () => {
  it("puts open first, then done, and never moves a row once placed", () => {
    const ranks = new Map<number, number>();
    const first = stableIssueOrder([{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: true }, { id: 4, done: false }], ranks);
    expect(first.map(i => i.id)).toEqual([2, 4, 1, 3]);
    // 2 gets done while the report is open, and a new open one (5) arrives.
    const later = stableIssueOrder([{ id: 1, done: true }, { id: 2, done: true }, { id: 3, done: true }, { id: 4, done: false }, { id: 5, done: false }], ranks);
    expect(later.map(i => i.id)).toEqual([2, 4, 5, 1, 3]);
  });
});
