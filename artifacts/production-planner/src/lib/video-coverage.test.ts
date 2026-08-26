import { describe, it, expect } from "vitest";
import { describeVideoCoverage } from "./video-coverage";

describe("describeVideoCoverage", () => {
  it("flags a week that is short of the clips it was meant to have", () => {
    expect(describeVideoCoverage({ wanted: 3, present: 1 })).toEqual({
      state: "missing",
      label: "1 of 3 videos",
    });
  });

  it("counts a week with none of its wanted clips as missing, not as empty", () => {
    expect(describeVideoCoverage({ wanted: 2, present: 0 })).toEqual({
      state: "missing",
      label: "0 of 2 videos",
    });
  });

  it("is complete once every wanted day has a clip", () => {
    expect(describeVideoCoverage({ wanted: 3, present: 3 })).toEqual({
      state: "complete",
      label: "3 videos",
    });
  });

  it("treats a week that wanted no video and has none as finished, not unfinished", () => {
    expect(describeVideoCoverage({ wanted: 0, present: 0 })).toEqual({
      state: "complete",
      label: "no video needed",
    });
  });

  it("says one video in the singular", () => {
    expect(describeVideoCoverage({ wanted: 1, present: 1 }).label).toBe("1 video");
  });

  it("doesn't nag when there are more clips than were asked for", () => {
    expect(describeVideoCoverage({ wanted: 2, present: 3 })).toEqual({
      state: "complete",
      label: "3 videos",
    });
  });
});
