import { describe, it, expect } from "vitest";
import { normaliseJobTitle, jobTitleAfterIssue, JOB_TITLE_MAX } from "./job-title";

describe("normaliseJobTitle", () => {
  it("trims and collapses spacing", () => {
    expect(normaliseJobTitle("  Head   Chef ")).toBe("Head Chef");
  });
  it("treats blank as no title", () => {
    expect(normaliseJobTitle("   ")).toBeNull();
    expect(normaliseJobTitle("")).toBeNull();
    expect(normaliseJobTitle(null)).toBeNull();
    expect(normaliseJobTitle(undefined)).toBeNull();
  });
  it("cuts an over-long title at the limit instead of refusing it", () => {
    const out = normaliseJobTitle("x".repeat(JOB_TITLE_MAX + 50));
    expect(out).toHaveLength(JOB_TITLE_MAX);
  });
});

describe("jobTitleAfterIssue", () => {
  it("updates when the contract names a different title", () => {
    expect(jobTitleAfterIssue("Food Production Operative", "Head Chef")).toBe("Head Chef");
  });
  it("fills a blank title", () => {
    expect(jobTitleAfterIssue(null, "Production Operative")).toBe("Production Operative");
  });
  it("leaves the same title alone, even with different spacing", () => {
    expect(jobTitleAfterIssue("Head Chef", "  Head  Chef ")).toBeNull();
  });
  it("never blanks a title because the contract's was empty", () => {
    expect(jobTitleAfterIssue("Head Chef", "  ")).toBeNull();
  });
});
