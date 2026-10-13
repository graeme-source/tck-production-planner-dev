import { describe, it, expect } from "vitest";
import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it("no header → the whole file", () => {
    expect(parseByteRange(undefined, 100)).toEqual({ kind: "whole" });
    expect(parseByteRange("", 100)).toEqual({ kind: "whole" });
  });

  it("Safari's opening probe", () => {
    expect(parseByteRange("bytes=0-1", 100)).toEqual({ kind: "partial", start: 0, end: 1 });
  });

  it("open-ended and over-long ranges stop at the last byte", () => {
    expect(parseByteRange("bytes=40-", 100)).toEqual({ kind: "partial", start: 40, end: 99 });
    expect(parseByteRange("bytes=40-500", 100)).toEqual({ kind: "partial", start: 40, end: 99 });
  });

  it("suffix ranges", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({ kind: "partial", start: 90, end: 99 });
    expect(parseByteRange("bytes=-500", 100)).toEqual({ kind: "partial", start: 0, end: 99 });
  });

  it("past the end or backwards → 416", () => {
    expect(parseByteRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=50-10", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
  });

  it("anything it doesn't understand → the whole file", () => {
    expect(parseByteRange("bytes=0-1,5-9", 100)).toEqual({ kind: "whole" });
    expect(parseByteRange("items=0-1", 100)).toEqual({ kind: "whole" });
    expect(parseByteRange("bytes=-", 100)).toEqual({ kind: "whole" });
  });
});
