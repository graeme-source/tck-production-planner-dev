import { describe, it, expect } from "vitest";
import { safeTestPath, tabCount, noticeStatusLine } from "./issue-pipeline";

describe("safeTestPath", () => {
  it("keeps in-app paths", () => {
    expect(safeTestPath("/recipes")).toBe("/recipes");
    expect(safeTestPath(" /plans/12/station/ovens?tab=q ")).toBe("/plans/12/station/ovens?tab=q");
  });
  it("drops anything that could leave the app", () => {
    expect(safeTestPath(null)).toBeNull();
    expect(safeTestPath("")).toBeNull();
    expect(safeTestPath("https://evil.example")).toBeNull();
    expect(safeTestPath("//evil.example")).toBeNull();
    expect(safeTestPath("/\\evil.example")).toBeNull();
    expect(safeTestPath("/javascript:alert(1)")).toBeNull();
    expect(safeTestPath("recipes")).toBeNull();
  });
});

describe("tabCount", () => {
  const counts = { proposed: 3, approved: 1, rejected: 2, in_progress: 0, fixed: 4, wont_fix: 1, awaitingReply: 1 };
  it("reads each tab's count, folding won't-fix into Rejected", () => {
    expect(tabCount(counts, "proposed")).toBe(2);
    expect(tabCount(counts, "rejected")).toBe(3);
    expect(tabCount(undefined, "fixed")).toBe(0);
  });
  it("To review leaves out cards waiting on Claude's answer to a reply", () => {
    expect(tabCount({ ...counts, proposed: 2, awaitingReply: 2 }, "proposed")).toBe(0);
    expect(tabCount({ ...counts, proposed: 0, awaitingReply: 1 }, "proposed")).toBe(0);
  });
});

describe("noticeStatusLine", () => {
  it("says whether the reporter has seen it and what they chose", () => {
    expect(noticeStatusLine({ ackAction: null, acknowledgedAt: null })).toMatch(/not seen yet/);
    expect(noticeStatusLine({ ackAction: "test_now", acknowledgedAt: "2026-09-24T10:00:00Z" })).toMatch(/testing it now/);
    expect(noticeStatusLine({ ackAction: "later", acknowledgedAt: "2026-09-24T10:00:00Z" })).toMatch(/will test later/);
  });
});
