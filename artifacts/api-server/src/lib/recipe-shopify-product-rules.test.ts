import { describe, expect, it } from "vitest";
import {
  PACK_VARIANT_TITLE, decideListingAction, listingChecks, perPackForProduct, photoLine, planVariants, recipeProductTags, leftOutTags,
  chooseNutritionTargets, defaultNutritionTicks, nutritionAddChecks,
  DECK_LEFT_OFF, barcodeAfterCreateLine, barcodePreviewLine,
  type ListingCheckInput, type NutritionTarget, type PackBarcodeAfter,
} from "./recipe-shopify-product-rules";

describe("the barcode line in the Create window", () => {
  it("held for the recipe (set on the label page) → shown, and it goes on the 2 Pack", () => {
    const l = barcodePreviewLine("create", { barcode: "5065018206009", mixed: false, pending: true, heldProblem: null });
    expect(l.code).toBe("5065018206009");
    expect(l.summary).toMatch(/^5065018206009 — from the label page/);
    expect(l.summary).toMatch(/never over a different number/);
  });
  it("none yet → says where to set it", () => {
    expect(barcodePreviewLine("create", null)).toEqual({ code: null, summary: "None yet — set one on the Label tab, or type it here" });
    expect(barcodePreviewLine("create", { barcode: null, mixed: false, pending: true, heldProblem: null }).summary).toMatch(/^None yet/);
  });
  it("a held number that couldn't be applied says so; an already-linked recipe isn't changed", () => {
    expect(barcodePreviewLine("update", { barcode: "1", mixed: false, pending: false, heldProblem: "another product you sell has it" }).summary).toMatch(/another product/);
    expect(barcodePreviewLine("linked", { barcode: "1", mixed: false, pending: false, heldProblem: null }).summary).toBe("Not changed");
  });
});

describe("the barcode line in the result", () => {
  const g = (state: string | null, extra: Partial<PackBarcodeAfter["variants"][number]> = {}): PackBarcodeAfter => ({
    barcode: "5065018206009", heldProblem: null,
    variants: [{ pushState: state, pushMessage: "Shopify writes are switched off", differentInShopify: false, shopifyBarcode: null, ...extra }],
  });
  it("sent / sending / waiting / failed each say what happened", () => {
    expect(barcodeAfterCreateLine(g("sent"))).toBe("Barcode 5065018206009 is on the 2 Pack and sent to Shopify ✓");
    expect(barcodeAfterCreateLine(g("sending"))).toMatch(/being sent to Shopify now/);
    expect(barcodeAfterCreateLine(g("waiting"))).toMatch(/not sent yet — Shopify writes are switched off/);
    expect(barcodeAfterCreateLine(g("failed"))).toMatch(/Retry/);
  });
  it("a different number already in Shopify is never overwritten — it's a choice for a person", () => {
    expect(barcodeAfterCreateLine(g("conflict", { differentInShopify: true, shopifyBarcode: "5000000000000" }))).toMatch(/Shopify has a different number \(5000000000000\)/);
  });
  it("no barcode → where to set it", () => {
    expect(barcodeAfterCreateLine(null)).toMatch(/^No barcode yet/);
    expect(barcodeAfterCreateLine({ barcode: null, heldProblem: null, variants: [] })).toMatch(/^No barcode yet/);
  });
});

describe("tags", () => {
  it("show and no-wholesale, then the recipe's own — deduped in any case, blanks dropped", () => {
    expect(recipeProductTags(["Winter Warmers Test Box", " ", "winter warmers test box", "Pie "]))
      .toEqual(["show", "no-wholesale", "Winter Warmers Test Box", "Pie"]);
  });
  it("a recipe with no tags still gets show and no-wholesale — not the old 'calzones'", () => {
    expect(recipeProductTags([])).toEqual(["show", "no-wholesale"]);
    expect(recipeProductTags(null)).toEqual(["show", "no-wholesale"]);
  });
  it("never sends Meals (the chicken pie went out with it, 30 Oct 2026) or the other menu/wholesale tags", () => {
    expect(recipeProductTags(["meals", "Calzones", "current-special", "Wholesale-G", "Draft", "Winter Warmers Test Box"]))
      .toEqual(["show", "no-wholesale", "Winter Warmers Test Box"]);
    expect(leftOutTags(["Meals", "Winter Warmers Test Box", "draft", "MEALS"]).map(l => l.tag)).toEqual(["Meals", "draft"]);
    expect(leftOutTags(["Meals"])[0].reason).toMatch(/main website/);
  });
});

describe("the one variant", () => {
  const v = (id: string, title: string, price = "17.95") => ({ id, title, price });
  it("keeps the 2 Pack, removes an 8 Pack and anything else", () => {
    const r = planVariants([v("1", "8 Pack Bag"), v("2", "2 Pack"), v("3", "Wonky")]);
    expect(r.keep).toEqual(v("2", "2 Pack"));
    expect(r.remove.map(x => x.title)).toEqual(["8 Pack Bag", "Wonky"]);
    expect(r.problem).toBeNull();
  });
  it("matches '2 Pack' loosely (case, hyphen, spacing)", () => {
    expect(planVariants([v("9", "2-pack")]).keep?.id).toBe("9");
    expect(planVariants([v("9", "2PACK")]).keep?.id).toBe("9");
  });
  it("no 2 Pack → nothing kept, and the reason names what's there", () => {
    const r = planVariants([v("1", "Default Title")]);
    expect(r.keep).toBeNull();
    expect(r.problem).toMatch(/no '2 Pack' variant.*'Default Title'/);
    expect(planVariants([]).problem).toMatch(/no variants/);
  });
  it("the title is the store's", () => expect(PACK_VARIANT_TITLE).toBe("2 Pack"));
});

describe("never made twice", () => {
  it("a linked recipe is never made again — even if the app made it", () => {
    expect(decideListingAction({ createdProductId: "5", createdProductExists: true, mappedProductIds: ["5"] })).toBe("linked");
    expect(decideListingAction({ createdProductId: null, createdProductExists: false, mappedProductIds: ["7"] })).toBe("linked");
  });
  it("made by the app but not linked (run broke part-way) → finish that one", () => {
    expect(decideListingAction({ createdProductId: "5", createdProductExists: true, mappedProductIds: [] })).toBe("update");
  });
  it("nothing, or the app's earlier product has gone → create", () => {
    expect(decideListingAction({ createdProductId: null, createdProductExists: false, mappedProductIds: [] })).toBe("create");
    expect(decideListingAction({ createdProductId: "5", createdProductExists: false, mappedProductIds: [] })).toBe("create");
  });
});

describe("calzones per pack", () => {
  it("'2' for a 2-pack recipe, the recipe's own number otherwise", () => {
    expect(perPackForProduct(2)).toBe("2");
    expect(perPackForProduct("2.0000")).toBe("2");
    expect(perPackForProduct(4)).toBe("4");
    expect(perPackForProduct(null)).toBe("2");
  });
});

describe("what stops the create, and what's worth knowing", () => {
  const ok: ListingCheckInput = {
    action: "create", templateFound: true, templateVariantProblem: null,
    listingDescription: "A warm paragraph.", recipeDescription: "Chicken, tarragon.",
    deckComplete: true, deckMissing: [], nutritionComplete: true, nutritionMissing: [],
    hasPhoto: true, rrp: "17.95", packSize: 2, templateVariantCount: 1,
  };
  it("all ready → nothing to say", () => expect(listingChecks(ok)).toEqual({ warnings: [], blocking: [] }));
  it("refuses without a listing description", () => {
    expect(listingChecks({ ...ok, listingDescription: "  " }).blocking[0]).toMatch(/no Shopify listing description/);
  });
  it("an incomplete deck WARNS but no longer stops the create (Graeme, 30 Oct 2026) — and says the deck is left off", () => {
    const c = listingChecks({ ...ok, deckComplete: false, deckMissing: ["Mustard", "Flour", "Mustard"] });
    expect(c.blocking).toEqual([]);
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toMatch(/ingredient deck isn't complete \(Mustard, Flour\)/);
    expect(c.warnings[0]).toContain(DECK_LEFT_OFF);
    expect(DECK_LEFT_OFF).toBe("Ingredient deck left off — finish the declarations, then use Push to Shopify on the Label tab.");
  });
  it("refuses with no template, or a template without a 2 Pack", () => {
    expect(listingChecks({ ...ok, templateFound: false }).blocking[0]).toMatch(/No template/);
    expect(listingChecks({ ...ok, templateVariantProblem: "no 2 Pack" }).blocking).toContain("no 2 Pack");
  });
  it("warns (doesn't stop) for no photo, no RRP, incomplete nutrition, empty recipe description, odd pack size, extra variants", () => {
    const w = listingChecks({ ...ok, hasPhoto: false, rrp: 0, nutritionComplete: false, nutritionMissing: ["Salt"], recipeDescription: "", packSize: 4, templateVariantCount: 2 });
    expect(w.blocking).toEqual([]);
    expect(w.warnings.join("\n")).toMatch(/No product photo/);
    expect(w.warnings.join("\n")).toMatch(/No RRP/);
    expect(w.warnings.join("\n")).toMatch(/Nutrition is incomplete \(Salt\)/);
    expect(w.warnings.join("\n")).toMatch(/recipe description is empty/);
    expect(w.warnings.join("\n")).toMatch(/packs 4 per pack/);
    expect(w.warnings.join("\n")).toMatch(/2 variants — only the 2 Pack is kept/);
  });
  it("an already-linked recipe has nothing to check", () => {
    expect(listingChecks({ ...ok, action: "linked", listingDescription: "", deckComplete: false })).toEqual({ warnings: [], blocking: [] });
  });
  it("finishing the app's own product doesn't need a template", () => {
    expect(listingChecks({ ...ok, action: "update", templateFound: false }).blocking).toEqual([]);
  });
});

it("the photo line", () => {
  expect(photoLine({ width: 2000, height: 1500 })).toEqual({ willAttach: true, summary: expect.stringContaining("2000 × 1500") });
  expect(photoLine(null).willAttach).toBe(false);
});

describe("the nutrition table on products that already exist (30 Oct 2026)", () => {
  const two: NutritionTarget = { productId: "700", title: "Chicken & Tarragon", status: "DRAFT", adminUrl: "u", hasNutrition: false };
  const core: NutritionTarget = { productId: "800", title: "Chicken & Tarragon 8 Pack", status: "ACTIVE", adminUrl: "u", hasNutrition: true };
  const ok = { nutritionComplete: true, nutritionMissing: [], missingFileScopes: [], missingWriteScopes: [], products: [two] };

  it("goes ahead with complete nutrition, a linked product and both permissions", () => {
    expect(nutritionAddChecks(ok)).toEqual([]);
  });
  it("says what stops it", () => {
    expect(nutritionAddChecks({ ...ok, products: [] })[0]).toMatch(/isn't linked to a Shopify product/);
    expect(nutritionAddChecks({ ...ok, nutritionComplete: false, nutritionMissing: ["salt"] })[0]).toMatch(/nutrition isn't complete \(missing: salt\)/);
    expect(nutritionAddChecks({ ...ok, missingFileScopes: ["write_files"] })[0]).toMatch(/upload files \(missing: write_files\)/);
    expect(nutritionAddChecks({ ...ok, missingWriteScopes: ["write_products"] })[0]).toMatch(/change products/);
  });
  it("ticks only the products without one — an existing table is replaced only by hand", () => {
    expect(defaultNutritionTicks([two, core])).toEqual(["700"]);
  });
  it("keeps to this recipe's own products, once each", () => {
    expect(chooseNutritionTargets([two, core], ["700", "700", "800"])).toEqual({ ids: ["700", "800"], unknown: [] });
    expect(chooseNutritionTargets([two], ["700", "999"])).toEqual({ ids: ["700"], unknown: ["999"] });
  });
});
