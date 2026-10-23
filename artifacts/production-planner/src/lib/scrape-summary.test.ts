import { describe, it, expect } from "vitest";
import { summariseScrape, type FieldSource } from "./scrape-summary";

const all = (s: FieldSource) => ({
  name: s, brand: s, packSize: s, packUnit: s, costPerPack: s, supplierPartNumber: s, ingredients: s, allergens: s,
  energyKj: s, energyKcal: s, fat: s, saturates: s, carbohydrate: s, sugars: s, protein: s, fibre: s, salt: s,
});

describe("summariseScrape", () => {
  it("full Brakes parse: nutrition 9/9, ingredients, allergens and the NOVA class with markers", () => {
    const s = summariseScrape({ ...all("parsed"), brand: "missing" }, ["milk"], {
      novaClass: 4, markers: ["modified starch"], reasoning: "", confidence: "high", method: "ai",
    });
    expect(s.text).toBe("Found: nutrition 9/9, ingredients, 1 allergen (Milk), UPF: NOVA 4 — modified starch");
    expect(s.missing).toEqual(["Brand"]);
    expect(s.usedAi).toBe(false);
  });

  it("a nutrient the page leaves blank is counted as missing and listed amber", () => {
    const s = summariseScrape({ ...all("parsed"), fibre: "missing" }, ["milk"], null);
    expect(s.text).toContain("nutrition 8/9");
    expect(s.missing).toEqual(["Fibre"]);
    expect(s.text).toContain("UPF: not worked out yet");
  });

  it("'none of the 14' reads as no allergens", () => {
    const s = summariseScrape(all("parsed"), [], { novaClass: 2, markers: [], reasoning: "", confidence: "high", method: "ai" });
    expect(s.text).toBe("Found: nutrition 9/9, ingredients, no allergens, UPF: NOVA 2");
  });

  it("flags AI-sourced fields", () => {
    const s = summariseScrape({ ...all("parsed"), ingredients: "ai" }, [], null);
    expect(s.usedAi).toBe(true);
  });
});
