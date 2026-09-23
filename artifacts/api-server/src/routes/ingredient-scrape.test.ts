import { describe, it, expect } from "vitest";
import {
  applyMissingNutrientZeros,
  base64DecodedBytes,
  scrapePhotoBodySchema,
  normaliseScrapedFields,
} from "./ingredient-scrape";

/** A ScrapedFields with every field null/empty — the shape the routes build on. */
function emptyFields() {
  return normaliseScrapedFields({});
}

describe("applyMissingNutrientZeros", () => {
  it("zero-fills nutrients omitted from a real per-100g listing (energy + ≥4 values)", () => {
    const input = {
      ...emptyFields(),
      energyKj: 1500,
      energyKcal: 356,
      fat: 1.2,
      saturates: 0.3,
      carbohydrate: 72,
      protein: 10,
      // sugars, fibre, salt omitted by the label — should become 0
    };
    const out = applyMissingNutrientZeros(input);
    expect(out.sugars).toBe(0);
    expect(out.fibre).toBe(0);
    expect(out.salt).toBe(0);
    // Stated values untouched
    expect(out.energyKj).toBe(1500);
    expect(out.fat).toBe(1.2);
  });

  it("leaves everything null when there is no listing at all", () => {
    const out = applyMissingNutrientZeros(emptyFields());
    expect(out.energyKj).toBeNull();
    expect(out.fibre).toBeNull();
    expect(out.salt).toBeNull();
  });

  it("does not zero-fill when energy is missing, even with several other values", () => {
    const input = {
      ...emptyFields(),
      fat: 10, saturates: 2, carbohydrate: 30, sugars: 5, protein: 8,
    };
    const out = applyMissingNutrientZeros(input);
    expect(out.energyKj).toBeNull();
    expect(out.fibre).toBeNull();
    expect(out.salt).toBeNull();
  });

  it("does not zero-fill a too-sparse listing (energy but fewer than 4 values total)", () => {
    const input = { ...emptyFields(), energyKcal: 100, fat: 1 };
    const out = applyMissingNutrientZeros(input);
    expect(out.protein).toBeNull();
    expect(out.salt).toBeNull();
  });

  it("treats 0 as a stated value, not a gap", () => {
    const input = {
      ...emptyFields(),
      energyKj: 0, energyKcal: 0, fat: 0, saturates: 0, carbohydrate: 0,
    };
    const out = applyMissingNutrientZeros(input);
    expect(out.sugars).toBe(0);
    expect(out.protein).toBe(0);
  });

  it("never mutates its input", () => {
    const input = {
      ...emptyFields(),
      energyKj: 1500, energyKcal: 356, fat: 1.2, carbohydrate: 72, protein: 10,
    };
    const before = { ...input };
    applyMissingNutrientZeros(input);
    expect(input).toEqual(before);
  });
});

describe("base64DecodedBytes", () => {
  it("computes decoded sizes with and without padding", () => {
    // "abc" → "YWJj" (no padding), "ab" → "YWI=" (1 pad), "a" → "YQ==" (2 pads)
    expect(base64DecodedBytes("YWJj")).toBe(3);
    expect(base64DecodedBytes("YWI=")).toBe(2);
    expect(base64DecodedBytes("YQ==")).toBe(1);
    expect(base64DecodedBytes("")).toBe(0);
  });
});

describe("scrapePhotoBodySchema", () => {
  const validImage = { data: "YWJj", mediaType: "image/jpeg" as const };

  it("accepts 1 valid image", () => {
    expect(scrapePhotoBodySchema.safeParse({ images: [validImage] }).success).toBe(true);
  });

  it("accepts 4 valid images across the allowed media types", () => {
    const result = scrapePhotoBodySchema.safeParse({
      images: [
        validImage,
        { data: "YWJj", mediaType: "image/png" },
        { data: "YWJj", mediaType: "image/webp" },
        validImage,
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty images array", () => {
    expect(scrapePhotoBodySchema.safeParse({ images: [] }).success).toBe(false);
  });

  it("rejects a missing images field", () => {
    expect(scrapePhotoBodySchema.safeParse({}).success).toBe(false);
  });

  it("rejects 5 images", () => {
    const result = scrapePhotoBodySchema.safeParse({
      images: [validImage, validImage, validImage, validImage, validImage],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported media types", () => {
    for (const mediaType of ["image/gif", "image/heic", "text/html", "application/pdf"]) {
      const result = scrapePhotoBodySchema.safeParse({ images: [{ data: "YWJj", mediaType }] });
      expect(result.success).toBe(false);
    }
  });

  it("rejects empty image data", () => {
    expect(
      scrapePhotoBodySchema.safeParse({ images: [{ data: "", mediaType: "image/jpeg" }] }).success,
    ).toBe(false);
  });

  it("rejects a base64 payload whose decoded size exceeds 4 MB", () => {
    // 4 MB decoded ≈ 5.59M base64 chars; go comfortably over.
    const oversized = "A".repeat(Math.ceil(((4 * 1024 * 1024) + 1024) * 4 / 3));
    const result = scrapePhotoBodySchema.safeParse({
      images: [{ data: oversized, mediaType: "image/jpeg" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a base64 payload just under the 4 MB decoded cap", () => {
    // 3 MB decoded — a realistic large JPEG after client re-encode.
    const large = "A".repeat(4 * 1024 * 1024); // 4M chars ≈ 3 MB decoded
    const result = scrapePhotoBodySchema.safeParse({
      images: [{ data: large, mediaType: "image/jpeg" }],
    });
    expect(result.success).toBe(true);
  });
});
