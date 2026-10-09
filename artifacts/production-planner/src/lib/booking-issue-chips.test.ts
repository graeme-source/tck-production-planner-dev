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
