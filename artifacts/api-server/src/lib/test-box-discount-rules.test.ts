import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_BOX_DISCOUNT, DISCOUNT_ALPHABET, collectionGate, describeSettings, discountCodePrefix, discountGate, discountInput,
  endOfLondonDay, generateDiscountCode, isTestBoxCode, settingsFromPrevious, suggestedEndDate, type ExistingDiscount,
} from "./test-box-discount-rules";

describe("the code", () => {
  it("is CC + launch month + 2-digit year, a hyphen and 6 characters", () => {
    expect(discountCodePrefix("2026-10-16")).toBe("CCOCT26");
    expect(discountCodePrefix("2027-01-04")).toBe("CCJAN27");
    let i = 0;
    const seq = [0, 0.99, 0.5, 0.25, 0.75, 0.1];
    const code = generateDiscountCode("2026-10-16", () => seq[i++]);
    expect(code).toMatch(/^CCOCT26-[A-Z2-9]{6}$/);
    expect(code.slice(8, 9)).toBe(DISCOUNT_ALPHABET[0]);
    expect(isTestBoxCode(code)).toBe(true);
  });

  it("never uses the look-alikes 0, O, 1 or I", () => {
    expect(DISCOUNT_ALPHABET).not.toMatch(/[01OI]/);
    for (let n = 0; n < 200; n++) expect(generateDiscountCode("2026-10-01").slice(8)).not.toMatch(/[01OI]/);
    expect(isTestBoxCode("CCOCT26-0K2P9Q")).toBe(false);
  });

  it("copes with random() returning its upper edge", () => {
    expect(generateDiscountCode("2026-10-01", () => 0.9999999999)).toMatch(/^CCOCT26-9{6}$/);
  });
});

describe("settings copied from the last test-box code", () => {
  const august: ExistingDiscount = {
    title: "CC20-X", percentage: 0.2, collectionTitles: ["August Test Box"],
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    appliesOncePerCustomer: false, usageLimit: null, appliesOnOneTimePurchase: true, appliesOnSubscription: false,
  };
  const wholeStore: ExistingDiscount = { ...august, title: "CC10-Y", percentage: 0.1, collectionTitles: [], appliesOncePerCustomer: true };

  it("takes the newest 20%-off-a-collection code, skipping whole-store codes", () => {
    expect(settingsFromPrevious([wholeStore, august])).toEqual({ ...DEFAULT_TEST_BOX_DISCOUNT, copiedFrom: "August Test Box" });
  });
  it("falls back to the observed defaults", () => {
    expect(settingsFromPrevious([wholeStore])).toBe(DEFAULT_TEST_BOX_DISCOUNT);
  });

  it("builds Shopify's input: 20% off the collection only, everyone, no end unless asked", () => {
    const input = discountInput({ code: "CCOCT26-ABCDEF", collectionGid: "gid://shopify/Collection/9", settings: DEFAULT_TEST_BOX_DISCOUNT, startsAt: "2026-10-02T12:00:00.000Z", endsAt: null });
    expect(input).toMatchObject({
      title: "CCOCT26-ABCDEF", code: "CCOCT26-ABCDEF", endsAt: null, context: { all: "ALL" },
      customerGets: { value: { percentage: 0.2 }, items: { collections: { add: ["gid://shopify/Collection/9"] } }, appliesOnSubscription: false },
    });
  });

  it("describes them in plain English", () => {
    const lines = describeSettings(DEFAULT_TEST_BOX_DISCOUNT, "Properoni Test Box", null);
    expect(lines[0]).toBe("20% off products in the 'Properoni Test Box' collection only");
    expect(lines).toContain("Doesn't combine with other discounts");
    expect(lines.at(-1)).toBe("No end date");
  });
});

describe("dates and gates", () => {
  it("suggested end: the last OPEN delivery's latest close", () => {
    expect(suggestedEndDate([{ status: "open", latestClose: "2026-10-12" }, { status: "open", latestClose: "2026-10-26" }, { status: "closed", latestClose: "2026-11-02" }])).toBe("2026-10-26");
    expect(suggestedEndDate([{ status: "closed", latestClose: "2026-10-12" }])).toBeNull();
  });
  it("end of a London day, summer and winter", () => {
    expect(endOfLondonDay("2026-10-12")).toBe("2026-10-12T22:59:59.000Z"); // BST
    expect(endOfLondonDay("2026-11-12")).toBe("2026-11-12T23:59:59.000Z"); // GMT
  });
  it("the collection waits for decided recipes, each with a product", () => {
    expect(collectionGate({ recipesDecided: false, recipeCount: 3, linkedCount: 3 })).toContain("Decide on recipes");
    expect(collectionGate({ recipesDecided: true, recipeCount: 3, linkedCount: 2 })).toBe("1 recipe still needs its Shopify product.");
    expect(collectionGate({ recipesDecided: true, recipeCount: 3, linkedCount: 1 })).toBe("2 recipes still need their Shopify product.");
    expect(collectionGate({ recipesDecided: true, recipeCount: 3, linkedCount: 3 })).toBeNull();
  });
  it("the discount waits for the collection", () => {
    expect(discountGate({ collectionExists: false, existingCode: null })).toContain("collection first");
    expect(discountGate({ collectionExists: true, existingCode: null })).toBeNull();
  });
});
