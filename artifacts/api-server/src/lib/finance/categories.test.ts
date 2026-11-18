import { describe, it, expect } from "vitest";
import { cleanCategoryName, parseCategoryId } from "./categories";

describe("parseCategoryId", () => {
  it("reads a form field or a number", () => {
    expect(parseCategoryId("3")).toBe(3);
    expect(parseCategoryId(7)).toBe(7);
  });
  it("is null for nothing chosen or rubbish", () => {
    for (const v of ["", " ", "0", "-2", "1.5", "abc", null, undefined]) expect(parseCategoryId(v)).toBeNull();
  });
});

describe("cleanCategoryName — named exactly as in QuickBooks", () => {
  const existing = [{ id: 1, name: "Food Purchases  TCK Delivered" }, { id: 2, name: "Dues and Subscriptions" }];
  it("keeps QuickBooks' own spacing inside the name, trimming only the ends", () => {
    expect(cleanCategoryName("  Food Purchases  TCK Delivered ", [], undefined)).toEqual({ name: "Food Purchases  TCK Delivered" });
  });
  it("refuses a blank name or one that's already there, whatever its case", () => {
    expect(cleanCategoryName("  ", existing)).toEqual({ error: "Give the category a name" });
    expect(cleanCategoryName("dues and subscriptions", existing)).toEqual({ error: '"Dues and Subscriptions" is already a category' });
  });
  it("lets a category keep its own name when renamed", () => {
    expect(cleanCategoryName("Dues and Subscriptions", existing, 2)).toEqual({ name: "Dues and Subscriptions" });
  });
});
