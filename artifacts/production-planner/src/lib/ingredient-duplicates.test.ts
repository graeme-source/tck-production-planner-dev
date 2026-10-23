import { describe, it, expect } from "vitest";
import { findLikelyDuplicates, duplicateWarning, normaliseIngredientName, sharedNameIds, sharedNameDetail } from "./ingredient-duplicates";

describe("sharedNameIds / sharedNameDetail", () => {
  const options = [
    { id: 319, name: "White Wine Vinegar", supplierName: "Brakes" },
    { id: 323, name: "white wine vinegar ", supplierName: null },
    { id: 320, name: "Kikkoman Soy Sauce", supplierName: "Bidfood" },
    { id: 321, name: "Soy Sauce", supplierName: "Bidfood" },
  ];
  it("flags only ingredients whose names match another", () => {
    expect([...sharedNameIds(options)].sort()).toEqual([319, 323]);
  });
  it("gives supplier and id for a shared name, nothing otherwise", () => {
    const shared = sharedNameIds(options);
    expect(sharedNameDetail(options[0], shared)).toBe("Brakes · #319");
    expect(sharedNameDetail(options[1], shared)).toBe("No supplier · #323");
    expect(sharedNameDetail(options[2], shared)).toBeNull();
  });
  it("ignores blank names", () => {
    expect(sharedNameIds([{ id: 1, name: "" }, { id: 2, name: "" }]).size).toBe(0);
  });
});

// #326: a second "Mixed Herbs" was added beside the first.
const existing = [
  { id: 44, name: "Mixed Herbs", supplierPartNumber: "70946" },
  { id: 12, name: "Oregano", supplierPartNumber: null },
  { id: 13, name: "Salt & Pepper Mix", supplierPartNumber: "SP-1" },
];

describe("findLikelyDuplicates", () => {
  it("catches the same name in different case, spacing or plural", () => {
    expect(findLikelyDuplicates({ name: "mixed herb" }, existing).map(m => m.id)).toEqual([44]);
    expect(findLikelyDuplicates({ name: "  Mixed  Herbs " }, existing).map(m => m.id)).toEqual([44]);
    expect(findLikelyDuplicates({ name: "Herbs, Mixed" }, existing).map(m => m.id)).toEqual([44]);
  });
  it("catches a one-letter typo on a longer name", () => {
    expect(findLikelyDuplicates({ name: "Mixed Hrbs" }, existing).map(m => m.id)).toEqual([44]);
  });
  it("treats & and 'and' the same", () => {
    expect(findLikelyDuplicates({ name: "Salt and Pepper Mix" }, existing).map(m => m.id)).toEqual([13]);
  });
  it("catches the same supplier code whatever the name", () => {
    const m = findLikelyDuplicates({ name: "Herb blend", supplierPartNumber: " 70946 " }, existing);
    expect(m).toEqual([{ id: 44, name: "Mixed Herbs", reason: "code" }]);
  });
  it("leaves genuinely different ingredients alone", () => {
    expect(findLikelyDuplicates({ name: "Basil" }, existing)).toEqual([]);
    expect(findLikelyDuplicates({ name: "Mixed Peppers" }, existing)).toEqual([]);
    expect(findLikelyDuplicates({ name: "" }, existing)).toEqual([]);
  });
  it("ignores the record being edited", () => {
    expect(findLikelyDuplicates({ name: "Mixed Herbs" }, existing, 44)).toEqual([]);
  });
});

describe("duplicateWarning", () => {
  it("says which one already exists", () => {
    expect(duplicateWarning([{ id: 44, name: "Mixed Herbs", reason: "name" }]))
      .toBe("Mixed Herbs already exists, did you mean that one?");
    expect(duplicateWarning([])).toBeNull();
  });
  it("normalises word order", () => {
    expect(normaliseIngredientName("Herbs Mixed")).toBe(normaliseIngredientName("mixed herbs"));
  });
});
