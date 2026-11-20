import { describe, it, expect } from "vitest";
import { leanVideoUrl, parseByteRange } from "./lean-video-rules";

describe("parseByteRange", () => {
  it("sends the whole file with no Range header", () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
    expect(parseByteRange("items=0-5", 1000)).toBeNull();
  });
  it("reads start-end, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-1", 1000)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("refuses ranges past the end", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=5-2", 1000)).toBe("unsatisfiable");
  });
});

describe("leanVideoUrl", () => {
  it("points at the lesson's video with a cache-busting time", () => {
    expect(leanVideoUrl(42, new Date(1_700_000_000_000))).toBe("/api/lean-videos/42?v=1700000000000");
  });
});
