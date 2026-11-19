import { describe, it, expect } from "vitest";
import { labelNeededToday, londonDay, tickWaitsForLabel } from "./traced-label";

describe("londonDay", () => {
  it("uses the factory's day, not UTC", () => {
    // 23:30 UTC on 30 Jun is 00:30 on 1 Jul in London (BST).
    expect(londonDay("2026-06-30T23:30:00Z")).toBe("2026-07-01");
    expect(londonDay("2026-11-19T23:30:00Z")).toBe("2026-11-19");
  });
});

describe("labelNeededToday", () => {
  const now = new Date("2026-11-19T09:00:00Z");
  it("isn't asked for an ingredient that isn't traced", () => {
    expect(labelNeededToday(undefined, now)).toBe(false);
  });
  it("is asked when no pack has ever been recorded", () => {
    expect(labelNeededToday({ id: 7, current: null }, now)).toBe(true);
  });
  it("is asked once a day: yesterday's pack doesn't count, this morning's does", () => {
    expect(labelNeededToday({ id: 7, current: { openedAt: "2026-11-18T15:00:00Z" } }, now)).toBe(true);
    expect(labelNeededToday({ id: 7, current: { openedAt: "2026-11-19T07:10:00Z" } }, now)).toBe(false);
  });
});

describe("tickWaitsForLabel", () => {
  it("holds a tick only for people it's switched on for, and never an untick", () => {
    expect(tickWaitsForLabel({ canPhotograph: true, needed: true, tickingOn: true })).toBe(true);
    expect(tickWaitsForLabel({ canPhotograph: false, needed: true, tickingOn: true })).toBe(false);
    expect(tickWaitsForLabel({ canPhotograph: true, needed: true, tickingOn: false })).toBe(false);
    expect(tickWaitsForLabel({ canPhotograph: true, needed: false, tickingOn: true })).toBe(false);
  });
});
