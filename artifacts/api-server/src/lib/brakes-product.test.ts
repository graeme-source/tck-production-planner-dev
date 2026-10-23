import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  brakesNumber,
  brakesProductApiUrl,
  brakesProductCode,
  brakesProductFromHtml,
  declarationFromHtml,
  isBrakesUrl,
  parseBrakesPackSize,
  parseBrakesProduct,
  type BrakesProductJson,
} from "./brakes-product";

// Trimmed copies of three real Brakes product pages and the product API
// response each page loads (fetched 23 Oct 2026): a sauce, an oil and a
// cured meat. The HTML keeps the page's ng-state transfer JSON (with
// unrelated navigation JSON ahead of the product, as on the live page) and
// the server-rendered but hidden (d-none) accordion markup.
const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/brakes/${name}`, import.meta.url)), "utf8");
const occ = (code: string) => JSON.parse(fixture(`brakes-${code}.occ.json`)) as BrakesProductJson;
const page = (code: string) => fixture(`brakes-${code}.html`);

describe("Brakes URLs", () => {
  it("recognises Brakes product URLs and pulls the code after /p/", () => {
    const long = new URL("https://www.brake.co.uk/dry-store/foods-of-the-world/cooking-sauces/indian/knorr-professional-patak-s-korma-concentrated-sauce-1-1l/p/85659");
    expect(isBrakesUrl(long)).toBe(true);
    expect(brakesProductCode(long)).toBe("85659");
    expect(brakesProductCode(new URL("https://www.brake.co.uk/p/149839"))).toBe("149839");
    expect(brakesProductCode(new URL("https://www.brake.co.uk/p/149839?x=1"))).toBe("149839");
    expect(isBrakesUrl(new URL("https://www.bidfood.co.uk/p/123"))).toBe(false);
    expect(isBrakesUrl(new URL("https://brake.co.uk.evil.example/p/1"))).toBe(false);
  });

  it("builds the product API URL only from a numeric code", () => {
    expect(brakesProductApiUrl("85659")).toBe("https://www.brake.co.uk/occ/v2/brakes/products/85659?fields=DEFAULT,classifications&lang=en&curr=GBP");
    expect(() => brakesProductApiUrl("85659/../x")).toThrow();
  });
});

describe("Brakes value helpers", () => {
  it("reads '-' as not stated and a printed 0 as 0", () => {
    expect(brakesNumber("-")).toBeNull();
    expect(brakesNumber("")).toBeNull();
    expect(brakesNumber(undefined)).toBeNull();
    expect(brakesNumber("0")).toBe(0);
    expect(brakesNumber("9.7")).toBe(9.7);
    expect(brakesNumber("<0.1")).toBe(0.1);
  });

  it("parses pack sizes into a total in our units", () => {
    expect(parseBrakesPackSize("1 x 1.1ltr")).toEqual({ packSize: 1.1, packUnit: "l" });
    expect(parseBrakesPackSize("1 x 20ltr")).toEqual({ packSize: 20, packUnit: "l" });
    expect(parseBrakesPackSize("1 x 500g")).toEqual({ packSize: 500, packUnit: "g" });
    expect(parseBrakesPackSize("6 x 400g")).toEqual({ packSize: 2400, packUnit: "g" });
    expect(parseBrakesPackSize("2 x 2.5kg")).toEqual({ packSize: 5, packUnit: "kg" });
    expect(parseBrakesPackSize("12 x 33cl")).toEqual({ packSize: 3960, packUnit: "ml" });
    expect(parseBrakesPackSize("1 x 24")).toBeNull();
    expect(parseBrakesPackSize(null)).toBeNull();
  });

  it("keeps the allergen emphasis as UPPERCASE and strips the markup", () => {
    expect(declarationFromHtml("<p>Water, single cream (<strong>milk</strong>) (8%), salt.</p>"))
      .toBe("Water, single cream (MILK) (8%), salt.");
    expect(declarationFromHtml("lactose (<b>Milk</b>), caseinate (<b>MILK</b>) &amp; salt"))
      .toBe("lactose (MILK), caseinate (MILK) & salt");
    expect(declarationFromHtml("-")).toBeNull();
    expect(declarationFromHtml(null)).toBeNull();
  });
});

describe("parseBrakesProduct — Patak's korma concentrated sauce (85659)", () => {
  const p = parseBrakesProduct(occ("85659"));

  it("finds all nine per-100g nutrients", () => {
    expect(p.nutrition).toEqual({
      energyKj: 974, energyKcal: 234, fat: 17, saturates: 9.7, carbohydrate: 18,
      sugars: 14, protein: 2, fibre: 1.8, salt: 1.5,
    });
  });

  it("reads the full declaration with MILK in capitals", () => {
    expect(p.ingredients).toBe(
      "Water, sugar, single cream (MILK) (8%), creamed coconut (8%), double cream (MILK) (5%), rapeseed oil, modified starch, desiccated coconut (2.5%), concentrated tomato puree, spices, ginger puree (1.5%), garlic puree, salt, dried onions, cumin powder, acid (lactic acid), lemon juice concentrate, dried coriander leaf.",
    );
  });

  it("ticks milk only — 'may contain' nuts/mustard go to the may-contain note", () => {
    expect(p.allergens).toEqual(["milk"]);
    expect(p.allergensStated).toBe(true);
    expect(p.mayContain).toBe("Almonds, Cashew Nut, Mustard and Peanuts");
  });

  it("reads name, code, pack and price", () => {
    expect(p.name).toBe("Knorr Professional Patak's Korma Concentrated Sauce 1.1L");
    expect(p.supplierPartNumber).toBe("85659");
    expect(p.packSize).toBe(1.1);
    expect(p.packUnit).toBe("l");
    expect(p.costPerPack).toBe(13.44);
  });
});

describe("parseBrakesProduct — KTC vegetable oil 20L (85753)", () => {
  const p = parseBrakesProduct(occ("85753"));

  it("keeps the label's zeros as 0, not blank", () => {
    expect(p.nutrition).toEqual({
      energyKj: 3696, energyKcal: 899, fat: 99.9, saturates: 14.5, carbohydrate: 0,
      sugars: 0, protein: 0, fibre: 0, salt: 0,
    });
  });

  it("'None of the 14 Food Allergens' is a stated position with no ticks", () => {
    expect(p.allergens).toEqual([]);
    expect(p.allergensStated).toBe(true);
    expect(p.mayContain).toBeNull();
  });

  it("reads the declaration including the anti-foaming agent", () => {
    expect(p.ingredients).toBe("Refined Soyabean Oil, Anti-Foaming Agent: Dimethyl Polysiloxane (E900).");
    expect(p.packSize).toBe(20);
    expect(p.packUnit).toBe("l");
    expect(p.costPerPack).toBe(30.89);
  });
});

describe("parseBrakesProduct — diced chorizo (149839)", () => {
  const p = parseBrakesProduct(occ("149839"));

  it("leaves fibre blank (null) where the page shows '-', everything else filled", () => {
    expect(p.nutrition).toEqual({
      energyKj: 1422, energyKcal: 342, fat: 26.2, saturates: 8.9, carbohydrate: 4,
      sugars: 1.28, protein: 22.7, fibre: null, salt: 2.9,
    });
  });

  it("reads a <b>-emphasised declaration and ticks milk", () => {
    expect(p.ingredients).toContain("lactose (MILK)");
    expect(p.ingredients).toContain("caseinate (MILK)");
    expect(p.ingredients).toContain("preservatives (sodium nitrite, potassium nitrate)");
    expect(p.allergens).toEqual(["milk"]);
    expect(p.packSize).toBe(500);
    expect(p.packUnit).toBe("g");
    expect(p.costPerPack).toBe(6.76);
  });
});

describe("brakesProductFromHtml — the page's own embedded data", () => {
  for (const code of ["85659", "85753", "149839"]) {
    it(`finds product ${code} in the ng-state JSON and parses it the same as the API`, () => {
      const product = brakesProductFromHtml(page(code), code);
      expect(product).not.toBeNull();
      expect(product!.code).toBe(code);
      expect(parseBrakesProduct(product!)).toEqual(parseBrakesProduct(occ(code)));
    });
  }

  it("returns null for a page with no ng-state (e.g. a non-rendered shell)", () => {
    expect(brakesProductFromHtml("<html><body><app-root></app-root></body></html>", "1")).toBeNull();
  });
});
