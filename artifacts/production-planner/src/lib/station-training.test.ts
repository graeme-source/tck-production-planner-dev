import { describe, it, expect } from "vitest";
import { isLiveStationPlan, timeLeft, londonToday } from "./station-training";

const TODAY = "2026-09-24";

describe("isLiveStationPlan", () => {
  it("production-day stations: only today's plan is live", () => {
    expect(isLiveStationPlan("building_1", "2026-09-24", TODAY)).toBe(true);
    expect(isLiveStationPlan("dough_sheeting", "2026-09-24", TODAY)).toBe(true);
    expect(isLiveStationPlan("mixing", "2026-09-23", TODAY)).toBe(false);
    expect(isLiveStationPlan("packing", "2026-09-25", TODAY)).toBe(false);
  });

  it("yesterday's prep data is history, not work", () => {
    expect(isLiveStationPlan("prep", "2026-09-23", TODAY)).toBe(false);
    expect(isLiveStationPlan("prep_meat", "2026-09-22", TODAY)).toBe(false);
  });

  it("work-ahead stations: today's or a later plan is live", () => {
    expect(isLiveStationPlan("dough_prep", "2026-09-25", TODAY)).toBe(true);
    expect(isLiveStationPlan("dough_prep", "2026-09-24", TODAY)).toBe(true);
    expect(isLiveStationPlan("main_prep", "2026-09-28", TODAY)).toBe(true);
    expect(isLiveStationPlan("prep_bases", "2026-09-25", TODAY)).toBe(true);
  });

  it("accepts full ISO timestamps and rejects a missing date", () => {
    expect(isLiveStationPlan("ovens", "2026-09-24T00:00:00.000Z", TODAY)).toBe(true);
    expect(isLiveStationPlan("ovens", null, TODAY)).toBe(false);
  });
});

describe("timeLeft", () => {
  const now = new Date("2026-09-24T10:00:00Z");
  it("hours when an hour or more remains", () => {
    expect(timeLeft("2026-09-25T00:30:00Z", now)).toBe("14h");
  });
  it("minutes under an hour", () => {
    expect(timeLeft("2026-09-24T10:45:00Z", now)).toBe("45 min");
  });
  it("null once passed", () => {
    expect(timeLeft("2026-09-24T09:00:00Z", now)).toBeNull();
  });
});

describe("londonToday", () => {
  it("uses the London date, not UTC", () => {
    expect(londonToday(new Date("2026-09-24T23:30:00Z"))).toBe("2026-09-25");
  });
});
