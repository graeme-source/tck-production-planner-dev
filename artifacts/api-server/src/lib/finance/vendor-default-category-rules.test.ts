import { describe, it, expect } from "vitest";
import { vendorDefaultFor } from "./vendor-default-category-rules";

const vendors = [
  { vendorId: 1, name: "No Fli", defaultCategoryId: 3 },
  { vendorId: 2, name: "Vonage", defaultCategoryId: 3 },
  { vendorId: 3, name: "Express Foodservice", defaultCategoryId: 1 },
];

describe("vendorDefaultFor", () => {
  it("finds the supplier by name, loosely", () => {
    expect(vendorDefaultFor("Vonage Ltd", vendors)?.vendorId).toBe(2);
    expect(vendorDefaultFor("NO FLI LIMITED", vendors)?.vendorId).toBe(1);
    expect(vendorDefaultFor("Vonage Business UK", vendors)?.vendorId).toBe(2);
  });
  it("never on a common word, and nothing for an unknown supplier", () => {
    expect(vendorDefaultFor("Ducting Express Services Ltd", vendors)).toBeNull();
    expect(vendorDefaultFor("Klaviyo Inc", vendors)).toBeNull();
    expect(vendorDefaultFor(null, vendors)).toBeNull();
  });
});
