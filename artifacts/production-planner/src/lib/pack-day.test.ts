import { describe, it, expect } from "vitest";
import { packDayName, packDayNameCap } from "./pack-day";

// Regression: on a Friday afternoon the next pack is Monday's, and the pack
// report used to label it "tomorrow" — which, combined with a calendar-tomorrow
// dispatch lookup, showed an empty Saturday dispatch all Friday afternoon.
describe("packDayName", () => {
  it("says 'tomorrow' mid-week, when the next pack really is tomorrow", () => {
    // Thursday 2026-08-20 → Friday 2026-08-21
    expect(packDayName("2026-08-20", "2026-08-21")).toBe("tomorrow");
  });

  it("names the day on a Friday, when the next pack is Monday's", () => {
    // Friday 2026-08-21 → Monday 2026-08-24
    expect(packDayName("2026-08-21", "2026-08-24")).toBe("Monday");
  });

  it("names the day across a bank-holiday Monday", () => {
    // Friday 2026-08-28 → Tuesday 2026-09-01 (Mon 31st is the August bank holiday)
    expect(packDayName("2026-08-28", "2026-09-01")).toBe("Tuesday");
  });

  it("handles a month boundary for the literal-tomorrow check", () => {
    expect(packDayName("2026-08-31", "2026-09-01")).toBe("tomorrow");
  });
});

describe("packDayNameCap", () => {
  it("capitalises 'tomorrow' and leaves day names as-is", () => {
    expect(packDayNameCap("2026-08-20", "2026-08-21")).toBe("Tomorrow");
    expect(packDayNameCap("2026-08-21", "2026-08-24")).toBe("Monday");
  });
});
