import { describe, expect, it } from "vitest";
import { buildRequestStatus, claimBuild, finishBuild, parseBuildRequest, pressBuildNow, approvedBlocker, hasCodeToWrite } from "./fix-queue-build-request-rules";

const T1 = "2026-11-02T08:10:00.000Z";
const T2 = "2026-11-02T08:15:00.000Z";
const T3 = "2026-11-02T09:00:00.000Z";

describe("Build approved fixes now", () => {
  it("never pressed → idle", () => expect(buildRequestStatus(null)).toBe("idle"));
  it("press → requested; reviewer claims → building; finishes → done", () => {
    const pressed = pressBuildNow(null, T1, "Graeme");
    expect(pressed.changed).toBe(true);
    expect(buildRequestStatus(pressed.next)).toBe("requested");
    const claimed = claimBuild(pressed.next, T2)!;
    expect(buildRequestStatus(claimed)).toBe("building");
    const done = finishBuild(claimed, T3, "Built #372, #373")!;
    expect(buildRequestStatus(done)).toBe("done");
    expect(done.note).toBe("Built #372, #373");
  });
  it("pressing twice while waiting or building doesn't start a second build", () => {
    const first = pressBuildNow(null, T1, "Graeme").next;
    expect(pressBuildNow(first, T2, "Graeme")).toEqual({ next: first, changed: false });
    const building = claimBuild(first, T2)!;
    expect(pressBuildNow(building, T3, "Graeme").changed).toBe(false);
  });
  it("pressing after a finished build starts a new one", () => {
    const done = finishBuild(claimBuild(pressBuildNow(null, T1, "Graeme").next, T2)!, T3, "ok")!;
    const again = pressBuildNow(done, "2026-11-02T10:00:00.000Z", "Graeme");
    expect(again.changed).toBe(true);
    expect(buildRequestStatus(again.next)).toBe("requested");
  });
  it("only a waiting request can be claimed (two reviewer runs can't both build)", () => {
    const claimed = claimBuild(pressBuildNow(null, T1, null).next, T2)!;
    expect(claimBuild(claimed, T3)).toBeNull();
    expect(claimBuild(null, T3)).toBeNull();
  });
  it("bad or empty stored value reads as never pressed", () => {
    expect(parseBuildRequest("not json")).toBeNull();
    expect(parseBuildRequest("")).toBeNull();
    expect(parseBuildRequest(JSON.stringify({ requestedAt: T1 }))).toMatchObject({ requestedAt: T1, claimedAt: null });
  });
});

describe("hasCodeToWrite", () => {
  // Live on 9 Nov 2026: seven approved cards, none with code, and the button
  // still said "Build 7 approved now" every time Graeme pressed it.
  it("counts only defects and improvements as buildable", () => {
    expect(hasCodeToWrite("defect")).toBe(true);
    expect(hasCodeToWrite("improvement")).toBe(true);
    for (const lane of ["data_fix", "understanding", "needs_info", "not_app"]) expect(hasCodeToWrite(lane)).toBe(false);
  });
});

describe("approvedBlocker", () => {
  it("says what an approved card without code is waiting for", () => {
    expect(approvedBlocker("data_fix")).toBe("a live data change");
    expect(approvedBlocker("needs_info")).toBe("more information");
    expect(approvedBlocker("understanding")).toBe("an answer, not code");
    expect(approvedBlocker("something new")).toBe("something other than code");
  });
});
