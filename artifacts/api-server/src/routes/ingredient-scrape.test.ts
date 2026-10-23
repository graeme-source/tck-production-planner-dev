import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Never reach the Anthropic API from a test, even on a machine with a key set.
vi.mock("../lib/ai/claude", () => ({
  isClaudeConfigured: () => false,
  getClaudeClient: () => { throw new Error("no AI in tests"); },
  CLAUDE_MODELS: { haiku: "h", sonnet: "s", opus: "o" },
}));

import {
  allergenCodesFromNames,
  applyMissingNutrientZeros,
  base64DecodedBytes,
  dataWindows,
  distillHtml,
  fieldsNeedingAi,
  mergeAiFields,
  scrapedFromBrakes,
  scrapedFromParsed,
  AMAZON_BLOCKED_MESSAGE,
  scrapePhotoBodySchema,
  normaliseScrapedFields,
} from "./ingredient-scrape";
import { brakesProductFromHtml, parseBrakesProduct, type BrakesProductJson } from "../lib/brakes-product";
import { parseAmazonProduct } from "../lib/amazon-product";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../lib/__fixtures__/brakes/${name}`, import.meta.url)), "utf8");
const brakes = (code: string) => scrapedFromBrakes(parseBrakesProduct(JSON.parse(fixture(`brakes-${code}.occ.json`)) as BrakesProductJson));

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

describe("Brakes scrape — one fell swoop, no AI needed", () => {
  for (const code of ["85659", "85753", "149839"]) {
    it(`${code}: every core field parsed, so the AI is not called`, () => {
      const { fields, sources } = brakes(code);
      expect(fieldsNeedingAi(sources)).toEqual([]);
      expect(sources.ingredients).toBe("parsed");
      expect(sources.allergens).toBe("parsed");
      expect(sources.energyKcal).toBe("parsed");
      expect(fields.ingredients).toBeTruthy();
    });
  }

  it("reports a nutrient the page leaves as '-' as missing and keeps it blank (null)", () => {
    const { fields, sources } = brakes("149839");
    expect(fields.fibre).toBeNull();
    expect(sources.fibre).toBe("missing");
  });

  it("keeps a label's 0 as 0 (vegetable oil)", () => {
    const { fields, sources } = brakes("85753");
    expect(fields.protein).toBe(0);
    expect(fields.salt).toBe(0);
    expect(sources.salt).toBe("parsed");
  });

  it("puts 'may contain' in the notes, not the allergen ticks", () => {
    const { fields } = brakes("85659");
    expect(fields.allergens).toEqual(["milk"]);
    expect(fields.notes).toBe("May contain: Almonds, Cashew Nut, Mustard and Peanuts");
  });

  it("brand isn't on Brakes product data — reported missing, but doesn't trigger the AI", () => {
    const { sources } = brakes("85659");
    expect(sources.brand).toBe("missing");
  });
});

describe("fieldsNeedingAi / mergeAiFields — AI only fills the gaps", () => {
  it("a parse with no ingredients and no nutrition table asks the AI for those only", () => {
    const { fields, sources } = brakes("85659");
    const noDeck = { ...sources, ingredients: "missing" as const };
    for (const k of ["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "fibre", "salt"] as const) noDeck[k] = "missing";
    const need = fieldsNeedingAi(noDeck);
    expect(need).toContain("ingredients");
    expect(need).toContain("fat");
    expect(need).not.toContain("name");

    const ai = { ...normaliseScrapedFields({}), name: "WRONG NAME", ingredients: "Water, sugar", fat: 17, fibre: null, allergens: ["Milk"] };
    const merged = mergeAiFields({ ...fields, ingredients: null, fat: null, fibre: null }, noDeck, ai, need);
    expect(merged.fields.name).toBe(fields.name); // parsed value wins
    expect(merged.fields.ingredients).toBe("Water, sugar");
    expect(merged.sources.ingredients).toBe("ai");
    expect(merged.fields.fat).toBe(17);
    expect(merged.sources.fat).toBe("ai");
    expect(merged.fields.fibre).toBeNull(); // AI didn't find it: stays blank
    expect(merged.sources.fibre).toBe("missing");
  });

  it("AI allergen names become UK14 codes", () => {
    expect(allergenCodesFromNames(["Milk", "Wheat", "Sesame seeds", "soya", "Dairy", "Tree nuts", "mustard", "cereals_containing_gluten"]))
      .toEqual(["cereals_containing_gluten", "milk", "mustard", "nuts", "sesame", "soybeans"]);
  });
});

describe("distillHtml — the AI fallback sees the collapsed sections and the embedded data", () => {
  it("keeps the hidden nutrition table as label | value rows and the product JSON from deep in ng-state", () => {
    const d = distillHtml(fixture("brakes-85659.html"));
    expect(d).toContain("Fat (g) | 17");
    expect(d).toContain("single cream (MILK)");
    expect(d).toContain("saturates_per_100");
  });

  it("windows around data words find content far into a big blob (old 30 KB cut-off missed it)", () => {
    const blob = "x".repeat(400_000) + '"name":"Of which saturates (g)","value":"9.7"' + "y".repeat(10_000);
    const w = dataWindows(blob);
    expect(w.some(x => x.includes('"value":"9.7"'))).toBe(true);
  });

  it("the page's own ng-state parses to the same fields as the product API", () => {
    const fromPage = brakesProductFromHtml(fixture("brakes-149839.html"), "149839")!;
    expect(scrapedFromBrakes(parseBrakesProduct(fromPage))).toEqual(brakes("149839"));
  });
});

describe("Amazon scrape — parsed first, AI only for what the page lacks", () => {
  const amazon = (asin: string) => scrapedFromParsed(parseAmazonProduct(fixture(`../amazon/amazon-${asin}.html`)));

  it("vanilla extract: ingredients, brand, pack and price parsed; nutrition left for the AI to look for (it isn't on the page)", () => {
    const { fields, sources } = amazon("B0FX9Q7BFM");
    expect(fields.ingredients).toBe("Water, Alcohol (35%), Sugar, Vanilla Bean Extractives.");
    expect(sources.ingredients).toBe("parsed");
    expect(sources.brand).toBe("parsed");
    expect(sources.energyKj).toBe("missing");
    const need = fieldsNeedingAi(sources);
    expect(need).not.toContain("ingredients");
    expect(need).toContain("energyKj");
    expect(need).toContain("allergens");
  });

  it("ketchup with a nutrition table and allergen row needs no AI", () => {
    const { sources, fields } = amazon("B07CS54584");
    expect(fieldsNeedingAi(sources)).toEqual([]);
    expect(fields.allergens).toEqual(["celery"]);
    expect(fields.saturates).toBe(0);
    expect(fields.fibre).toBeNull();
  });

  it("the blocked message tells the person what to do", () => {
    expect(AMAZON_BLOCKED_MESSAGE).toMatch(/paste the ingredients/i);
  });
});
