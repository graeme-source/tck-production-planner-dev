import { describe, it, expect } from "vitest";
import { pendingDaysToRecheck, RECHECK_MIN_INTERVAL_MS, type RecheckInput } from "./team-efficiency-recheck";

const NOW = new Date("2026-10-14T10:05:00Z");
function input(p: Partial<RecheckInput> = {}): RecheckInput {
  return {
    days: [
      { date: "2026-10-07", status: "pending" },
      { date: "2026-10-08", status: "pending" },
      { date: "2026-10-09", status: "ok" },
      { date: "2026-10-13", status: "pending" },
    ],
    today: "2026-10-14", windowDays: 10, now: NOW, lastRecheckAt: null,
    ...p,
  };
}

describe("pendingDaysToRecheck", () => {
  it("picks only the pending days, sorted, with their span", () => {
    expect(pendingDaysToRecheck(input())).toEqual({
      dates: ["2026-10-07", "2026-10-08", "2026-10-13"], from: "2026-10-07", to: "2026-10-13",
    });
  });
  it("returns null when nothing is pending", () => {
    expect(pendingDaysToRecheck(input({
      days: [{ date: "2026-10-10", status: "ok" }, { date: "2026-10-11", status: "no_labour" }],
    }))).toBeNull();
  });
  it("ignores pending days outside the recent window (and today)", () => {
    const plan = pendingDaysToRecheck(input({
      days: [
        { date: "2026-10-03", status: "pending" }, // 11 days back — outside
        { date: "2026-10-04", status: "pending" }, // 10 days back — inside
        { date: "2026-10-14", status: "pending" }, // today — not a finished day
      ],
    }));
    expect(plan?.dates).toEqual(["2026-10-04"]);
  });
  it("waits an hour between rechecks", () => {
    const recent = new Date(NOW.getTime() - 20 * 60_000).toISOString();
    expect(pendingDaysToRecheck(input({ lastRecheckAt: recent }))).toBeNull();
    const old = new Date(NOW.getTime() - RECHECK_MIN_INTERVAL_MS).toISOString();
    expect(pendingDaysToRecheck(input({ lastRecheckAt: old }))?.dates).toHaveLength(3);
  });
  it("treats an unreadable last-run time as never run", () => {
    expect(pendingDaysToRecheck(input({ lastRecheckAt: "garbage" }))?.dates).toHaveLength(3);
  });
  it("de-duplicates dates", () => {
    const plan = pendingDaysToRecheck(input({
      days: [{ date: "2026-10-12", status: "pending" }, { date: "2026-10-12", status: "pending" }],
    }));
    expect(plan).toEqual({ dates: ["2026-10-12"], from: "2026-10-12", to: "2026-10-12" });
  });
});
