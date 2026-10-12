import { describe, expect, it } from "vitest";
import { declarationIssues, declarationNeedsWrapper, labelNameFor, planDeclarationWraps, wrapDeclaration } from "./declaration";

describe("labelNameFor — the ingredient's name as a label reads it", () => {
  it("drops pack-size, supplier and prep notes in trailing brackets", () => {
    expect(labelNameFor("Burger Sauce (2.1kg catering)")).toBe("Burger Sauce");
    expect(labelNameFor("Hoisin Sauce (Blue Dragon)")).toBe("Hoisin Sauce");
    expect(labelNameFor("Gherkin (drained weight)")).toBe("Gherkin");
    expect(labelNameFor("Thing (285ml) (old)")).toBe("Thing");
  });
  it("keeps a bracket in the middle of a name, and tidies spacing", () => {
    expect(labelNameFor("Haechandle Gochujang (Hot Pepper Paste) Medium Hot")).toBe("Haechandle Gochujang (Hot Pepper Paste) Medium Hot");
    expect(labelNameFor("  Salted   Butter ")).toBe("Salted Butter");
  });
  it("never guesses at spelling", () => {
    expect(labelNameFor("Beef Bouillion")).toBe("Beef Bouillion");
  });
  it("falls back to the name when it is only a bracket", () => {
    expect(labelNameFor("(test)")).toBe("(test)");
  });
});

describe("wrapDeclaration — what gets stored when an ingredient is saved", () => {
  it("wraps a bare component list under the name (regression: Salted Butter on Garlic Cheese, 12 Oct)", () => {
    expect(wrapDeclaration("Salted Butter", " Butter (Milk), Salt")).toEqual({ declaration: "Salted Butter (Butter (Milk), Salt)", wrapped: true });
  });
  it("drops trailing full stops and spaces inside the brackets", () => {
    expect(wrapDeclaration("Panko Breadcrumbs", "Wheat Flour, Yeast, Salt. ").declaration).toBe("Panko Breadcrumbs (Wheat Flour, Yeast, Salt)");
    expect(wrapDeclaration("Vanilla Extract", "WATER, MONOPROPYLENE GLYCOL, NATURAL VANILLA EXTRACT..").declaration)
      .toBe("Vanilla Extract (WATER, MONOPROPYLENE GLYCOL, NATURAL VANILLA EXTRACT)");
  });
  it("uses the tidied name — no pack size on the label", () => {
    expect(wrapDeclaration("Burger Sauce (2.1kg catering)", "Rapeseed Oil, Tomato Puree, EGG Yolk").declaration)
      .toBe("Burger Sauce (Rapeseed Oil, Tomato Puree, EGG Yolk)");
  });
  it("leaves an already-wrapped declaration alone (even with a trailing full stop)", () => {
    expect(wrapDeclaration("Pepperoni", "Pepperoni (Pork, Spices, Salt)")).toEqual({ declaration: "Pepperoni (Pork, Spices, Salt)", wrapped: false });
    expect(wrapDeclaration("Mozzarella", "Mozzarella (MILK, Salt).").wrapped).toBe(false);
  });
  it("leaves a single ingredient alone", () => {
    expect(wrapDeclaration("Basil", "Basil")).toEqual({ declaration: "Basil", wrapped: false });
    expect(wrapDeclaration("Chicken", "Chicken (100%)")).toEqual({ declaration: "Chicken (100%)", wrapped: false });
  });
  it("stores an empty declaration as null", () => {
    expect(wrapDeclaration("Basil", "  ")).toEqual({ declaration: null, wrapped: false });
    expect(wrapDeclaration("Basil", null)).toEqual({ declaration: null, wrapped: false });
  });
  it("the result never needs wrapping again", () => {
    const w = wrapDeclaration("Black Olive Slices", "Black Olives (Olives, Colour Stabiliser: Ferrous Gluconate), Water, Salt.");
    expect(w.declaration).toBe("Black Olive Slices (Black Olives (Olives, Colour Stabiliser: Ferrous Gluconate), Water, Salt)");
    expect(declarationNeedsWrapper(w.declaration!)).toBe(false);
  });
});

describe("planDeclarationWraps — the one-off tidy for existing data", () => {
  it("lists only the declarations that change", () => {
    const plan = planDeclarationWraps([
      { id: 1, name: "Salted Butter", labelDeclaration: "Butter (MILK), Salt" },
      { id: 2, name: "Basil", labelDeclaration: "Basil" },
      { id: 3, name: "Grated Cheddar", labelDeclaration: null },
      { id: 4, name: "Pepperoni", labelDeclaration: "Pepperoni (Pork, Salt)" },
    ]);
    expect(plan).toEqual([{ id: 1, name: "Salted Butter", before: "Butter (MILK), Salt", after: "Salted Butter (Butter (MILK), Salt)" }]);
  });
});

describe("declarationIssues — each check line knows which ingredient to open", () => {
  it("names each ingredient once, missing first, with its id", () => {
    const issues = declarationIssues([
      { ingredientId: 65, name: "Salted Butter", labelDeclaration: "Butter (MILK), Salt" },
      { ingredientId: 9, name: "Grated Mature White Cheddar Cheese", labelDeclaration: null },
      { ingredientId: 9, name: "Grated Mature White Cheddar Cheese", labelDeclaration: null },
      { ingredientId: 3, name: "Salt", labelDeclaration: "Salt" },
      { ingredientId: 4, name: "Blank", labelDeclaration: "  " },
    ]);
    expect(issues).toEqual([
      { kind: "missing", ingredientId: 9, name: "Grated Mature White Cheddar Cheese" },
      { kind: "missing", ingredientId: 4, name: "Blank" },
      { kind: "unwrapped", ingredientId: 65, name: "Salted Butter" },
    ]);
  });
  it("is empty when every declaration is fine", () => {
    expect(declarationIssues([{ ingredientId: 1, name: "Salt", labelDeclaration: "Salt" }])).toEqual([]);
  });
});
