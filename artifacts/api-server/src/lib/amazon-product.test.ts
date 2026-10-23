import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  amazonAsin,
  amazonNutrition,
  isAmazonBlocked,
  isAmazonUrl,
  parseAmazonProduct,
  parseAmazonQuantity,
} from "./amazon-product";

// Trimmed copies of two real amazon.co.uk grocery pages (fetched 23 Oct 2026):
// the Nielsen-Massey vanilla extract Graeme scraped (ingredients only, no
// nutrition table) and a ketchup WITH a per-100g nutrition table and a
// bold-emphasised allergen. Scripts and styles stripped; the widgets the
// reader uses are kept as served, including the collapsed expanders.
const page = (asin: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/amazon/amazon-${asin}.html`, import.meta.url)), "utf8");

describe("Amazon URLs", () => {
  it("recognises Amazon hosts and reads the ASIN", () => {
    const u = new URL("https://www.amazon.co.uk/dp/B0FX9Q7BFM");
    expect(isAmazonUrl(u)).toBe(true);
    expect(amazonAsin(u)).toBe("B0FX9Q7BFM");
    expect(amazonAsin(new URL("https://www.amazon.co.uk/Heinz-Tomato-Ketchup/dp/B07CS54584/ref=sr_1_1?k=x"))).toBe("B07CS54584");
    expect(amazonAsin(new URL("https://www.amazon.co.uk/gp/product/B07CS54584"))).toBe("B07CS54584");
    expect(isAmazonUrl(new URL("https://www.brake.co.uk/p/1"))).toBe(false);
    expect(isAmazonUrl(new URL("https://amazon.co.uk.evil.example/dp/B0FX9Q7BFM"))).toBe(false);
  });
});

describe("parseAmazonProduct — Nielsen-Massey vanilla extract (B0FX9Q7BFM)", () => {
  const p = parseAmazonProduct(page("B0FX9Q7BFM"));

  it("finds the ingredients hidden in the collapsed widget", () => {
    expect(p.ingredients).toBe("Water, Alcohol (35%), Sugar, Vanilla Bean Extractives.");
  });

  it("reads title, brand, volume, price and ASIN", () => {
    expect(p.name).toBe("Nielsen-Massey Madagascar Bourbon Vanilla Extract | 118ml");
    expect(p.brand).toBe("Nielsen-Massey");
    expect(p.packSize).toBe(118);
    expect(p.packUnit).toBe("ml");
    expect(p.costPerPack).toBe(9);
    expect(p.supplierPartNumber).toBe("B0FX9Q7BFM");
  });

  it("no nutrition table on the page → every nutrient stays blank (null), never 0", () => {
    expect(Object.values(p.nutrition).every(v => v === null)).toBe(true);
  });

  it("no allergen row → allergens not stated", () => {
    expect(p.allergens).toEqual([]);
    expect(p.allergensStated).toBe(false);
  });

  it("falls back to 'Important information → Ingredients:' when the widget is missing", () => {
    const html = page("B0FX9Q7BFM").replace(/id="nic-ingredients-content"/, 'id="something-else"');
    expect(parseAmazonProduct(html).ingredients).toBe("Water, Alcohol (35%), Sugar, Vanilla Bean Extractives.");
  });
});

describe("parseAmazonProduct — Heinz ketchup zero (B07CS54584), with a nutrition table", () => {
  const p = parseAmazonProduct(page("B07CS54584"));

  it("reads the per-100g table; 0 stays 0, nutrients not listed stay null", () => {
    expect(p.nutrition).toEqual({
      energyKj: 191, energyKcal: null, fat: 0.1, saturates: 0, carbohydrate: 5.7,
      sugars: 4.6, protein: 1.6, fibre: null, salt: 0.06,
    });
  });

  it("keeps the bold allergen in CAPITALS and ticks it from the allergen row", () => {
    expect(p.ingredients).toBe(
      "Tomatoes (200g per 100g Tomato Ketchup), Spirit Vinegar, Lemon Juice from Concentrate, Potassium Chloride, Acid (Malic Acid), Citrus Fibre, Spice and Herb Extracts (contain CELERY), Sweetener (Sucralose)",
    );
    expect(p.allergens).toEqual(["celery"]);
    expect(p.allergensStated).toBe(true);
  });

  it("reads brand, weight and price", () => {
    expect(p.brand).toBe("HEINZ");
    expect(p.packSize).toBe(425);
    expect(p.packUnit).toBe("g");
    expect(p.costPerPack).toBe(3);
  });
});

describe("amazonNutrition label variants", () => {
  const table = (header: string, rows: [string, string][]) => `
    <div id="nutritionalInfoAndIngredients_feature_div">
      <table id="nic-eu-nutrition-facts-typical-values"><tr><td>Typical values</td><td>${header}</td></tr></table>
      <table id="nic-eu-nutrition-facts-table"><tr><td colSpan="2"><table id="nic-eu-nutrition-facts-nutrients">
        ${rows.map(([l, v]) => `<tr><td><span>${l}</span></td><td><span>${v}</span></td></tr>`).join("")}
      </table></td></tr></table>
    </div>`;

  it("reads kJ and kcal from one energy cell, fibre/fiber, and converts sodium to salt", () => {
    const n = amazonNutrition(table("Per 100ml", [
      ["Energy", "1046kJ / 250kcal"], ["Fat", "12g"], ["of which saturates", "3.4g"],
      ["Carbohydrate", "30g"], ["of which sugars", "2g"], ["Fiber", "0g"], ["Protein", "5.5g"], ["Sodium", "0.4g"],
    ]));
    expect(n).toEqual({ energyKj: 1046, energyKcal: 250, fat: 12, saturates: 3.4, carbohydrate: 30, sugars: 2, protein: 5.5, fibre: 0, salt: 1 });
  });

  it("ignores a per-serving-only table", () => {
    const n = amazonNutrition(table("Per serving (15g)", [["Energy", "100kJ"], ["Fat", "1g"]]));
    expect(Object.values(n).every(v => v === null)).toBe(true);
  });
});

describe("parseAmazonQuantity", () => {
  it("reads Amazon's spelled-out units", () => {
    expect(parseAmazonQuantity("118 Millilitres")).toEqual({ packSize: 118, packUnit: "ml" });
    expect(parseAmazonQuantity("425 Grams")).toEqual({ packSize: 425, packUnit: "g" });
    expect(parseAmazonQuantity("1.5 Kilograms")).toEqual({ packSize: 1.5, packUnit: "kg" });
    expect(parseAmazonQuantity("2 Litres")).toEqual({ packSize: 2, packUnit: "l" });
    expect(parseAmazonQuantity("Vanilla Extract | 118ml")).toEqual({ packSize: 118, packUnit: "ml" });
    expect(parseAmazonQuantity("1 count")).toBeNull();
  });
});

describe("isAmazonBlocked", () => {
  it("spots a robot-check page", () => {
    const captcha = `<html><head><title>Amazon.co.uk</title></head><body><h4>Type the characters you see in this image:</h4>
      <form action="/errors/validateCaptcha"><input id="captchacharacters" name="field-keywords"></form></body></html>`;
    expect(isAmazonBlocked(captcha)).toBe(true);
    const p = parseAmazonProduct(captcha);
    expect(p.ingredients).toBeNull();
    expect(p.name).toBeNull();
  });

  it("a real product page is not blocked", () => {
    expect(isAmazonBlocked(page("B0FX9Q7BFM"))).toBe(false);
    expect(isAmazonBlocked(page("B07CS54584"))).toBe(false);
  });
});
