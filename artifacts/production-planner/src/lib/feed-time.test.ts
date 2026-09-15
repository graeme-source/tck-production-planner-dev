import { describe, it, expect } from "vitest";
import { feedTimestamp } from "./feed-time";

// Fixed "now": Tuesday 15 Sep 2026, 14:00 London (13:00 UTC — BST).
const NOW = new Date("2026-09-15T13:00:00Z");

describe("feedTimestamp", () => {
  it("moments ago reads 'just now'", () => {
    expect(feedTimestamp("2026-09-15T12:59:40Z", NOW)).toBe("just now");
  });

  it("earlier today reads minutes/hours ago", () => {
    expect(feedTimestamp("2026-09-15T12:18:00Z", NOW)).toBe("42 minutes ago");
    expect(feedTimestamp("2026-09-15T07:00:00Z", NOW)).toBe("6 hours ago");
    expect(feedTimestamp("2026-09-15T11:59:00Z", NOW)).toBe("1 hour ago");
  });

  it("yesterday reads 'Yesterday HH:MM' in London time", () => {
    expect(feedTimestamp("2026-09-14T13:32:00Z", NOW)).toBe("Yesterday 14:32");
  });

  it("older this year reads day + date + time", () => {
    expect(feedTimestamp("2026-09-10T13:32:00Z", NOW)).toMatch(/^Thu 10 Sept?, 14:32$/);
  });

  it("a different year includes the year", () => {
    expect(feedTimestamp("2025-12-24T18:00:00Z", NOW)).toBe("24 Dec 2025, 18:00");
  });

  it("garbage in, empty out", () => {
    expect(feedTimestamp("not-a-date", NOW)).toBe("");
  });
});
