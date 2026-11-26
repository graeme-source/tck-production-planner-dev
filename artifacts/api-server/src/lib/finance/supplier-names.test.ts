import { describe, it, expect } from "vitest";
import { supplierNameChoices } from "./supplier-names";

describe("supplierNameChoices", () => {
  it("one name per supplier, its commonest spelling, busiest first", () => {
    expect(supplierNameChoices([
      { name: "Klaviyo Inc", count: 9 }, { name: "Klaviyo, Inc.", count: 2 }, { name: "KLAVIYO", count: 1 },
      { name: "Vonage", count: 13 }, { name: " ", count: 4 },
    ])).toEqual([{ name: "Vonage", count: 13 }, { name: "Klaviyo Inc", count: 12 }]);
  });
});
