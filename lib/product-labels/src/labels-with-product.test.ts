import { describe, expect, it } from "vitest";
import { backLabelPlan, frontLabelPlan } from "./labels-with-product";
import { ingredientDeclarationGaps, ingredientGapLine, NUTRIENT_KEYS } from "./ingredient-gaps";

describe("back label with a new Shopify product (Graeme, 30 Oct 2026)", () => {
  const ok = { hasLive: false, matchesLive: false, fits: true, blockers: [] as string[] };
  it("fits and no live label yet → published, ticked to start", () => {
    expect(backLabelPlan(ok)).toMatchObject({ canSetUp: true, ticked: true });
  });
  it("a live label exists and the recipe changed → offered, but the tick starts OFF (it updates the live version)", () => {
    const p = backLabelPlan({ ...ok, hasLive: true, liveVersionNo: 3 });
    expect(p).toMatchObject({ canSetUp: true, ticked: false });
    expect(p.reason).toMatch(/version 3/);
    expect(p.reason).toMatch(/Update live version/);
  });
  it("the live label is already this version → nothing to publish", () => {
    expect(backLabelPlan({ ...ok, hasLive: true, matchesLive: true })).toMatchObject({ canSetUp: false, ticked: false, refused: false });
  });
  it("doesn't fit → refused, with the reason and where to fix it", () => {
    const p = backLabelPlan({ ...ok, fits: false, blockers: ["Ingredients don't fit at 6 pt."] });
    expect(p.refused).toBe(true);
    expect(p).toMatchObject({ canSetUp: false, ticked: false });
    expect(p.reason).toMatch(/^Not published — Ingredients don't fit at 6 pt\..*label page/);
    expect(backLabelPlan({ ...ok, fits: false }).reason).toMatch(/doesn't fit/);
  });
  it("whatever the label page would refuse (missing declarations) → refused", () => {
    expect(backLabelPlan({ ...ok, blockers: ["1 ingredient(s) have no label declaration: Mustard."] }).reason).toMatch(/Mustard/);
  });
});

describe("front label with a new Shopify product", () => {
  it("not set up yet → set up, ticked", () => expect(frontLabelPlan({ isDefault: false, canPrint: true })).toMatchObject({ canSetUp: true, ticked: true }));
  it("already set up → off, nothing to do", () => expect(frontLabelPlan({ isDefault: true, canPrint: true })).toMatchObject({ canSetUp: false, ticked: false, refused: false }));
  it("no name to print (won't render) → refused with the reason", () => {
    const p = frontLabelPlan({ isDefault: false, canPrint: false });
    expect(p.refused).toBe(true);
    expect(p).toMatchObject({ canSetUp: false, ticked: false });
    expect(p.reason).toMatch(/no name to print/);
  });
});

describe("missing nutrition and declarations, per ingredient (sub-recipe ingredients included)", () => {
  it("merges the nutrition panel's and the deck's gaps into one line per ingredient", () => {
    const gaps = ingredientDeclarationGaps({
      nutrition: [
        { ingredientId: 1, name: "Mozzarella", missing: ["fat", "salt"] },
        { ingredientId: 2, name: "Tarragon", missing: [...NUTRIENT_KEYS] },
        { ingredientId: 5, name: "Flour", missing: [] },
      ],
      missingDeclarations: [{ ingredientId: 1, name: "Mozzarella" }, { ingredientId: 3, name: "Mustard" }],
      unwrappedDeclarations: ["Chorizo"],
    });
    expect(gaps.map(ingredientGapLine)).toEqual([
      "Mozzarella — nutrition: fat, salt; no label declaration",
      "Tarragon — no nutrition data",
      "Mustard — no label declaration",
      "Chorizo — declaration doesn't name the compound ingredient",
    ]);
    expect(gaps.find(g => g.name === "Mozzarella")).toMatchObject({ ingredientId: 1, nutrition: true, declaration: true });
    expect(gaps.find(g => g.name === "Chorizo")).toMatchObject({ ingredientId: null, nutrition: false, declaration: true });
  });
  it("nothing missing → no lines", () => {
    expect(ingredientDeclarationGaps({ nutrition: [], missingDeclarations: [], unwrappedDeclarations: [] })).toEqual([]);
    expect(ingredientDeclarationGaps({})).toEqual([]);
  });
});
