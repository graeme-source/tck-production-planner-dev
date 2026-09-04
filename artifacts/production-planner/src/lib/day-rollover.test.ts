import { describe, it, expect } from "vitest";
import { londonDay, crossedLondonMidnight } from "./day-rollover";

const ts = (iso: string) => new Date(iso).getTime();

describe("londonDay", () => {
  it("renders the London calendar day as YYYY-MM-DD", () => {
    expect(londonDay(ts("2026-01-15T12:00:00Z"))).toBe("2026-01-15");
  });

  it("uses London wall-clock, not UTC, in summer", () => {
    // 23:30 UTC on 3 Sep is 00:30 on 4 Sep in London (BST = UTC+1).
    expect(londonDay(ts("2026-09-03T23:30:00Z"))).toBe("2026-09-04");
    // 23:30 UTC in January IS 23:30 London (GMT) — still the same day.
    expect(londonDay(ts("2026-01-03T23:30:00Z"))).toBe("2026-01-03");
  });
});

describe("crossedLondonMidnight", () => {
  it("is false within the same working day", () => {
    expect(crossedLondonMidnight(ts("2026-09-04T06:00:00+01:00"), ts("2026-09-04T22:00:00+01:00"))).toBe(false);
  });

  it("is true once London midnight has passed — the next-morning login case", () => {
    // Locked up at 9pm, back at 6am: bounce to the dashboard.
    expect(crossedLondonMidnight(ts("2026-09-03T21:00:00+01:00"), ts("2026-09-04T06:00:00+01:00"))).toBe(true);
  });

  it("is true just past midnight, even minutes apart", () => {
    expect(crossedLondonMidnight(ts("2026-09-03T23:58:00+01:00"), ts("2026-09-04T00:02:00+01:00"))).toBe(true);
  });

  it("handles the BST/UTC seam: an evening UTC timestamp is already 'tomorrow' in London", () => {
    // 23:30Z on the 3rd and 05:00Z on the 4th are BOTH 4 Sep in London.
    expect(crossedLondonMidnight(ts("2026-09-03T23:30:00Z"), ts("2026-09-04T05:00:00Z"))).toBe(false);
  });

  it("is false when nothing was recorded", () => {
    expect(crossedLondonMidnight(0, Date.now())).toBe(false);
    expect(crossedLondonMidnight(Number.NaN, Date.now())).toBe(false);
  });

  it("spans weekends and month boundaries", () => {
    expect(crossedLondonMidnight(ts("2026-08-31T18:00:00+01:00"), ts("2026-09-01T07:00:00+01:00"))).toBe(true);
    expect(crossedLondonMidnight(ts("2026-09-04T18:00:00+01:00"), ts("2026-09-07T07:00:00+01:00"))).toBe(true);
  });
});
