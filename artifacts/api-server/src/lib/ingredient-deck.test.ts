import { describe, expect, it } from "vitest";
import { buildDeck, cleanDeclaration, type DeckGroup, type DeckItem } from "./ingredient-deck";
import { withQuid } from "./ingredient-deck";

const item = (ingredientId: number, name: string, quantityG: number, labelDeclaration: string | null = null, allergens: string[] = []): DeckItem =>
  ({ ingredientId, name, quantityG, labelDeclaration, allergens });

// A cut-down Godfather: dough is a compound (>= 25%); tomato base and the
// burger sauce are small, so they break up into the main list.
const dough: DeckGroup = {
  subRecipeId: 1, name: "Calzone Dough", labelDeclaration: null, totalQuantityG: 115, isQuid: false,
  ingredients: [item(32, "Flour", 70, "00 Flour (WHEAT)", ["cereals_containing_gluten"]), item(95, "Water", 43, "Water"), item(3, "Salt", 2, "Salt")],
};
const tomatoBase: DeckGroup = {
  subRecipeId: 2, name: "Tomato Base", labelDeclaration: null, totalQuantityG: 36, isQuid: false,
  ingredients: [item(26, "Passata", 33, "Tomatoes"), item(3, "Salt", 1, "Salt"), item(95, "Water", 2, "Water")],
};
const burgerSauce: DeckGroup = {
  subRecipeId: 69, name: "TCK Burger Sauce", labelDeclaration: null, totalQuantityG: 11, isQuid: false,
  ingredients: [
    item(213, "Mayonnaise", 8, "Mayonnaise (Rapeseed Oil, Water, EGG Yolk (3.5%), Salt, Flavouring).", ["eggs"]),
    item(39, "Ground black pepper", 0.07, "Black Pepper"),
    item(3, "Salt", 0.03, "Salt"),
  ],
};
const direct = [
  item(47, "Mozzarella", 60, "Mozzarella (MILK)", ["milk"]),
  item(306, "Beef Mince", 60, "Beef mince"),
  item(215, "Cracked Black Pepper", 0.3, "Black Pepper"),
];

describe("ingredient deck rules (regression: repeated Black Pepper / Salt on The Godfather, 2026-09-29)", () => {
  const { entries, deckText } = buildDeck(direct, [dough, tomatoBase, burgerSauce]);
  const count = (word: string) => entries.filter(e => e.type === "ingredient" && e.declaration === word).length;

  it("names Black Pepper once even though two different ingredients declare it", () => {
    expect(count("Black Pepper")).toBe(1);
    const bp = entries.find(e => e.declaration === "Black Pepper")!;
    expect(bp.percentage).toBeCloseTo(((0.3 + 0.07) / 282) * 100, 1);
  });

  it("names loose Salt and Water once, at their combined weight", () => {
    expect(count("Salt")).toBe(1);
    expect(count("Water")).toBe(1);
  });

  it("keeps the dough bracketed, with its own Salt inside the brackets", () => {
    const d = entries.find(e => e.type === "compound")!;
    expect(d.declaration).toBe("Calzone Dough (00 Flour (**WHEAT**), Water, Salt)");
  });

  it("keeps a wrapped mayonnaise whole, percentage inside its brackets, stray full stop gone", () => {
    expect(deckText).toContain("Mayonnaise (Rapeseed Oil, Water, **EGG** Yolk (3.5%), Salt, Flavouring),");
    expect(deckText).not.toContain("Flavouring).,");
    expect(deckText.endsWith(".")).toBe(true);
  });

  it("orders by weight, heaviest first", () => {
    const pcts = entries.map(e => e.percentage);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    expect(entries[0].type).toBe("compound");
  });

  it("works QUID out on the combined weight", () => {
    const { entries: q } = buildDeck(
      [{ ...item(1, "Beef", 30, "Beef"), isQuid: true }, item(2, "Other", 60, "Other")],
      [{ subRecipeId: 9, name: "Mix", labelDeclaration: null, totalQuantityG: 10, isQuid: false, ingredients: [item(1, "Beef", 10, "Beef")] }],
    );
    expect(q.find(e => e.name === "Beef")!.declaration).toBe("Beef (40%)");
  });

  it("cleans declarations", () => {
    expect(cleanDeclaration("Flavouring. ", "x")).toBe("Flavouring");
    expect(cleanDeclaration("", "Turmeric")).toBe("Turmeric");
  });
});

describe("QUID placement", () => {
  it("goes after the name of a compound ingredient, not after its list", () => {
    expect(withQuid("Diced Chorizo (Pork, salt, paprika)", 4.4)).toBe("Diced Chorizo (4.4%) (Pork, salt, paprika)");
  });
  it("goes on the end of a plain ingredient", () => {
    expect(withQuid("Chicken Breast", 17.6)).toBe("Chicken Breast (17.6%)");
  });
  it("a list that isn't wrapped under a name keeps it on the end", () => {
    expect(withQuid("Water, Salt", 2)).toBe("Water, Salt (2%)");
  });
});
