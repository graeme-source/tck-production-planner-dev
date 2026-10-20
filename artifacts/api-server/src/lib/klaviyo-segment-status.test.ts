import { describe, expect, it } from "vitest";
import { segmentStatusFromAttributes } from "./klaviyo-segment-status";

describe("Klaviyo segment status", () => {
  it("treats a segment still processing as not counted yet, even though Klaviyo says 0", () => {
    expect(segmentStatusFromAttributes({ name: "Properoni buyers", profile_count: 0, is_processing: true }).profileCount).toBeNull();
  });

  it("returns the count once processing has finished", () => {
    expect(segmentStatusFromAttributes({ name: "Properoni buyers", profile_count: 38, is_processing: false }).profileCount).toBe(38);
  });

  it("keeps a genuine zero once finished", () => {
    expect(segmentStatusFromAttributes({ profile_count: 0, is_processing: false }).profileCount).toBe(0);
  });

  it("copes with missing fields", () => {
    expect(segmentStatusFromAttributes(undefined)).toEqual({ exists: true, name: null, profileCount: null });
  });
});
