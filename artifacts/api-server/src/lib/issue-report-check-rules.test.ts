import { describe, expect, it } from "vitest";
import { checkedAnswer, isStillOpen, plainReportStatus, rankBySharedWords, reportWords } from "./issue-report-check-rules";

describe("plainReportStatus", () => {
  it("speaks the team's language at each stage", () => {
    expect(plainReportStatus(null, false)).toMatch(/not looked at yet/);
    expect(plainReportStatus({ status: "approved" }, false)).toMatch(/approved but not built/);
    expect(plainReportStatus({ status: "in_progress" }, false)).toBe("Being fixed now");
    expect(plainReportStatus({ status: "fixed" }, false)).toMatch(/next update/);
    expect(plainReportStatus({ status: "fixed", issueResolvedAt: new Date() }, true)).toBe("Fixed and live");
  });
});

describe("isStillOpen", () => {
  it("is followable until it's live or closed", () => {
    expect(isStillOpen(null, false)).toBe(true);
    expect(isStillOpen({ status: "fixed" }, false)).toBe(true);
    expect(isStillOpen({ status: "fixed", issueResolvedAt: new Date() }, false)).toBe(false);
    expect(isStillOpen({ status: "rejected" }, false)).toBe(false);
    expect(isStillOpen({ status: "proposed" }, true)).toBe(false);
  });
});

describe("rankBySharedWords", () => {
  it("puts the closest report first and drops the unrelated", () => {
    const rows = ["Printer label is blank", "Diced onions order wrong surplus", "Label printer jams on the blank label"];
    expect(rankBySharedWords("blank label from the printer", rows, r => r)).toEqual(["Printer label is blank", "Label printer jams on the blank label"]);
  });
  it("ignores small words", () => {
    expect(reportWords("Can you do this for the team?")).toEqual(["team"]);
    expect(rankBySharedWords("can you do this", ["this is the one"], r => r)).toEqual([]);
  });
});

describe("checkedAnswer — a wrong guess can't stop a real report", () => {
  const seen = { issueIds: new Set([12]), paths: new Set(["/orders"]) };
  it("accepts answers backed by what she looked up", () => {
    expect(checkedAnswer({ outcome: "already_reported", message: "Still queued.", issueId: 12 }, seen)).toMatchObject({ outcome: "already_reported", issueId: 12 });
    expect(checkedAnswer({ outcome: "already_possible", message: "It's here.", path: "/orders" }, seen)).toMatchObject({ outcome: "already_possible", path: "/orders" });
  });
  it("files it as new when the report or page isn't real", () => {
    expect(checkedAnswer({ outcome: "already_reported", message: "x", issueId: 99 }, seen).outcome).toBe("new");
    expect(checkedAnswer({ outcome: "already_possible", message: "x", path: "/made-up" }, seen).outcome).toBe("new");
    expect(checkedAnswer({ outcome: "already_possible", message: "x", path: "https://evil.example" }, seen).outcome).toBe("new");
    expect(checkedAnswer({}, seen).outcome).toBe("new");
  });
  it("lets her ask one thing", () => {
    expect(checkedAnswer({ outcome: "ask", message: "Which screen?" }, seen)).toMatchObject({ outcome: "ask", message: "Which screen?" });
  });
});
