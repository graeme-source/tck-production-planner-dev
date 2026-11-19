import { describe, it, expect } from "vitest";
import { canTagOwnUpload, cleanCategoryName, noVatChangeForCategory, parseCategoryId } from "./categories";

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

describe("canTagOwnUpload — saying what a just-sent receipt is", () => {
  const now = new Date("2026-11-18T17:00:00Z");
  const sent = (p: Partial<{ uploadedBy: number | null; createdAt: Date; postedAt: Date | null }> = {}) =>
    ({ uploadedBy: 6, createdAt: new Date("2026-11-18T16:55:00Z"), postedAt: null, ...p });
  it("lets the sender tag their own fresh, unposted receipt", () => {
    expect(canTagOwnUpload(sent(), 6, now)).toBe(true);
  });
  it("refuses someone else's, a posted one, or one over a day old", () => {
    expect(canTagOwnUpload(sent(), 7, now)).toBe(false);
    expect(canTagOwnUpload(sent({ postedAt: now }), 6, now)).toBe(false);
    expect(canTagOwnUpload(sent({ createdAt: new Date("2026-11-17T16:00:00Z") }), 6, now)).toBe(false);
    expect(canTagOwnUpload(sent({ uploadedBy: null }), 6, now)).toBe(false);
  });
});

describe("noVatChangeForCategory — choosing the DLA category", () => {
  const dla = { noVatReason: "dla" };
  const food = { noVatReason: null };
  it("marks the transaction No VAT invoice (DLA) when the DLA category is chosen", () => {
    expect(noVatChangeForCategory(null, null, dla)).toEqual({ set: "dla" });
    expect(noVatChangeForCategory(null, food, dla)).toEqual({ set: "dla" });
  });
  it("does nothing if it's already marked DLA", () => {
    expect(noVatChangeForCategory("dla", null, dla)).toBeNull();
  });
  it("takes the DLA marking off when moved from DLA to an ordinary category", () => {
    expect(noVatChangeForCategory("dla", dla, food)).toEqual({ clear: true });
    expect(noVatChangeForCategory("dla", dla, null)).toEqual({ clear: true });
  });
  it("leaves a hand-chosen 'other' reason alone, and ordinary categories alone", () => {
    expect(noVatChangeForCategory("other", dla, food)).toBeNull();
    expect(noVatChangeForCategory(null, food, food)).toBeNull();
    expect(noVatChangeForCategory("other", null, food)).toBeNull();
  });
});
