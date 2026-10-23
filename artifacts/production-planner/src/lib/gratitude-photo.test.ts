import { describe, it, expect } from "vitest";
import { fallbackGratitudePhotoUrl, gratitudeImageMode } from "./gratitude-photo";

describe("gratitudeImageMode", () => {
  // Regression (23 Oct 2026): the prep-page thumbnail showed broken-image
  // alt text when the automatic image service failed. A failed image must
  // always fall back to the prompt, never stay an <img>.
  it("falls back to the prompt when the automatic image fails to load", () => {
    expect(gratitudeImageMode(false, true)).toBe("prompt");
  });
  it("falls back to the prompt when an uploaded photo fails to load", () => {
    expect(gratitudeImageMode(true, true)).toBe("prompt");
  });
  it("shows the uploaded photo, else the automatic image", () => {
    expect(gratitudeImageMode(true, false)).toBe("uploaded");
    expect(gratitudeImageMode(false, false)).toBe("automatic");
  });
});

describe("fallbackGratitudePhotoUrl", () => {
  it("is the same all day and changes when shuffled", () => {
    const a = fallbackGratitudePhotoUrl("2026-10-23");
    expect(fallbackGratitudePhotoUrl("2026-10-23")).toBe(a);
    expect(fallbackGratitudePhotoUrl("2026-10-23", 1)).not.toBe(a);
    expect(a).toMatch(/^https:\/\/loremflickr\.com\/1200\/800\/[^?]+\?lock=\d+$/);
  });
});
