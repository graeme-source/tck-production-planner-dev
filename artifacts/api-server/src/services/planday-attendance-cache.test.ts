import { describe, it, expect } from "vitest";
import { missingRanges, extendCoverage } from "./planday-attendance-ranges";

describe("missingRanges", () => {
  it("returns the whole request when nothing is covered", () => {
    expect(missingRanges({ from: "2026-03-01", to: "2026-09-01" }, { from: null, to: null }))
      .toEqual([{ from: "2026-03-01", to: "2026-09-01" }]);
  });

  it("returns nothing when the request is fully covered", () => {
    expect(missingRanges({ from: "2026-04-01", to: "2026-05-01" }, { from: "2026-03-01", to: "2026-09-01" }))
      .toEqual([]);
  });

  it("returns the piece before coverage", () => {
    expect(missingRanges({ from: "2026-01-01", to: "2026-04-01" }, { from: "2026-03-01", to: "2026-09-01" }))
      .toEqual([{ from: "2026-01-01", to: "2026-02-28" }]);
  });

  it("returns the piece after coverage (the daily one-day extension)", () => {
    expect(missingRanges({ from: "2026-09-01", to: "2026-09-14" }, { from: "2026-03-01", to: "2026-09-13" }))
      .toEqual([{ from: "2026-09-14", to: "2026-09-14" }]);
  });

  it("returns both pieces when the request straddles coverage", () => {
    expect(missingRanges({ from: "2026-01-01", to: "2026-12-01" }, { from: "2026-03-01", to: "2026-09-01" }))
      .toEqual([
        { from: "2026-01-01", to: "2026-02-28" },
        { from: "2026-09-02", to: "2026-12-01" },
      ]);
  });

  it("handles a request entirely before coverage", () => {
    expect(missingRanges({ from: "2026-01-01", to: "2026-01-31" }, { from: "2026-03-01", to: "2026-09-01" }))
      .toEqual([{ from: "2026-01-01", to: "2026-01-31" }]);
  });

  it("handles a request entirely after coverage", () => {
    expect(missingRanges({ from: "2026-10-01", to: "2026-10-31" }, { from: "2026-03-01", to: "2026-09-01" }))
      .toEqual([{ from: "2026-10-01", to: "2026-10-31" }]);
  });

  it("returns nothing for an inverted request", () => {
    expect(missingRanges({ from: "2026-05-01", to: "2026-04-01" }, { from: null, to: null }))
      .toEqual([]);
  });

  it("crosses leap-day boundaries correctly", () => {
    expect(missingRanges({ from: "2028-02-01", to: "2028-03-05" }, { from: "2028-03-01", to: "2028-04-01" }))
      .toEqual([{ from: "2028-02-01", to: "2028-02-29" }]);
  });
});

describe("extendCoverage", () => {
  it("starts coverage from scratch", () => {
    expect(extendCoverage({ from: null, to: null }, { from: "2026-03-01", to: "2026-04-01" }))
      .toEqual({ from: "2026-03-01", to: "2026-04-01" });
  });

  it("extends both ends", () => {
    expect(extendCoverage({ from: "2026-03-01", to: "2026-04-01" }, { from: "2026-02-01", to: "2026-05-01" }))
      .toEqual({ from: "2026-02-01", to: "2026-05-01" });
  });

  it("keeps coverage when the sync was inside it", () => {
    expect(extendCoverage({ from: "2026-03-01", to: "2026-09-01" }, { from: "2026-04-01", to: "2026-05-01" }))
      .toEqual({ from: "2026-03-01", to: "2026-09-01" });
  });
});
