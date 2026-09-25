import { describe, expect, it } from "vitest";
import { addDaysToDateString, londonDayStartUtc, londonDaysWindowUtc, londonLocalTimestamp } from "./london-time";

describe("londonDayStartUtc", () => {
  it("is 23:00 UTC the evening before in summer time", () => {
    expect(londonDayStartUtc("2026-09-24").toISOString()).toBe("2026-09-23T23:00:00.000Z");
  });
  it("is midnight UTC in winter", () => {
    expect(londonDayStartUtc("2026-12-01").toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("gets both clock-change Sundays right", () => {
    // Clocks go forward at 01:00 GMT on Sun 29 Mar 2026 and back at 02:00 BST
    // on Sun 25 Oct 2026 — both AFTER that day's midnight.
    expect(londonDayStartUtc("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(londonDayStartUtc("2026-03-30").toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(londonDayStartUtc("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(londonDayStartUtc("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
  it("refuses a non-date", () => {
    expect(() => londonDayStartUtc("yesterday")).toThrow();
  });
});

describe("londonDaysWindowUtc", () => {
  const hours = (w: { start: Date; end: Date }) => (w.end.getTime() - w.start.getTime()) / 3_600_000;
  it("covers whole London days, inclusive of `to`", () => {
    const w = londonDaysWindowUtc("2026-09-24", "2026-09-24");
    expect(w.start.toISOString()).toBe("2026-09-23T23:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-24T23:00:00.000Z");
    expect(hours(w)).toBe(24);
  });
  it("is 23 hours on spring-forward day and 25 on fall-back day", () => {
    expect(hours(londonDaysWindowUtc("2026-03-29", "2026-03-29"))).toBe(23);
    expect(hours(londonDaysWindowUtc("2026-10-25", "2026-10-25"))).toBe(25);
  });
});

describe("addDaysToDateString", () => {
  it("crosses month and year ends", () => {
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("londonLocalTimestamp", () => {
  it("gives London wall-clock time in Planday's shape, in BST and GMT", () => {
    expect(londonLocalTimestamp(new Date("2026-09-25T15:08:54Z"))).toBe("2026-09-25T16:08:54");
    expect(londonLocalTimestamp(new Date("2026-12-01T23:30:05Z"))).toBe("2026-12-01T23:30:05");
    expect(londonLocalTimestamp(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01T00:30:00");
  });
});
