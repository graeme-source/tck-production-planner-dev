import { describe, expect, it } from "vitest";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots } from "@workspace/product-labels";
import { DEFAULT_TEMPLATE, normaliseTemplate } from "@workspace/product-labels";
import { carryQuid, planQuid, sentQuid, type QuidState } from "./quid-plan";
import { DEFAULT_QUID_TERMS, matchQuid, type QuidDecision, type QuidLineInput } from "./quid-matcher";
import { buildDeck, type DeckGroup, type DeckItem } from "./ingredient-deck";

const d = (key: string, level: "auto" | "suggest" = "auto", term = "Chicken"): QuidDecision =>
  ({ key, level, term, label: key, isCategory: false, target: { kind: "ingredient", ingredientId: Number(key.split(":")[1]) } });
const st = (quid: boolean, source: QuidState["source"]): QuidState => ({ quid, source });

describe("automatic QUID — what gets written", () => {
  it("ticks what the name names when nobody has decided", () => {
    const p = planQuid(new Map(), [d("i:1")]);
    expect(p.next.get("i:1")).toEqual(st(true, "auto"));
    expect(p.changes).toHaveLength(1);
  });

  it("a person's untick always wins — never re-ticked", () => {
    const p = planQuid(new Map([["i:1", st(false, "manual")]]), [d("i:1")]);
    expect(p.next.get("i:1")).toEqual(st(false, "manual"));
    expect(p.changes).toEqual([]);
  });

  it("a person's tick always wins — never unticked when the name stops naming it", () => {
    const p = planQuid(new Map([["i:1", st(true, "manual")]]), []);
    expect(p.next.get("i:1")).toEqual(st(true, "manual"));
    expect(p.changes).toEqual([]);
  });

  it("only an automatic tick is taken off again (recipe renamed)", () => {
    const current = new Map([["i:1", st(true, "auto")], ["i:2", st(true, "manual")]]);
    const p = planQuid(current, []);
    expect(p.next.get("i:1")).toEqual(st(false, null));
    expect(p.next.get("i:2")).toEqual(st(true, "manual"));
    expect(p.changes.map(c => c.key)).toEqual(["i:1"]);
  });

  it("suggestions are asked, never ticked, and not asked again once answered", () => {
    const fresh = planQuid(new Map(), [d("i:45", "suggest", "BBQ")]);
    expect(fresh.next.get("i:45")).toEqual(st(false, null));
    expect(fresh.suggestions.map(s => s.key)).toEqual(["i:45"]);
    const answeredNo = planQuid(new Map([["i:45", st(false, "manual")]]), [d("i:45", "suggest", "BBQ")]);
    expect(answeredNo.suggestions).toEqual([]);
    const answeredYes = planQuid(new Map([["i:45", st(true, "manual")]]), [d("i:45", "suggest", "BBQ")]);
    expect(answeredYes.suggestions).toEqual([]);
  });

  it("rename end to end: Chicken and Chorizo → Chicken Special unticks the chorizo it had ticked itself", () => {
    const lines: QuidLineInput[] = [
      { kind: "ingredient", id: 191, name: "British Red Tractor Diced Chicken Breast", declaration: "Chicken (100%)", category: "raw_meat" },
      { kind: "ingredient", id: 23, name: "Diced Chorizo", declaration: "Diced Chorizo (Pork, salt)", category: "cooked_meat" },
    ];
    const first = planQuid(new Map(), matchQuid("Chicken and Chorizo", lines, DEFAULT_QUID_TERMS).decisions);
    const renamed = planQuid(first.next, matchQuid("Chicken Special", lines, DEFAULT_QUID_TERMS).decisions);
    expect(renamed.next.get("i:191")).toEqual(st(true, "auto"));
    expect(renamed.next.get("i:23")).toEqual(st(false, null));
  });
});

describe("carrying ticks through a recipe save (lines are deleted and re-inserted)", () => {
  it("keeps the stored tick and its source when the client sends no tick", () => {
    expect(carryQuid(undefined, st(true, "auto"))).toEqual(st(true, "auto"));
    expect(carryQuid(undefined, st(false, "manual"))).toEqual(st(false, "manual"));
    expect(carryQuid(undefined, undefined)).toEqual(st(false, null));
  });
  it("the same tick sent back keeps its source; a different one is a person deciding", () => {
    expect(carryQuid(true, st(true, "auto"))).toEqual(st(true, "auto"));
    expect(carryQuid(false, st(true, "auto"))).toEqual(st(false, "manual"));
    expect(carryQuid(true, st(false, null))).toEqual(st(true, "manual"));
    expect(carryQuid(true, undefined)).toEqual(st(true, "manual"));
    expect(carryQuid(false, undefined)).toEqual(st(false, null));
  });
  it("reads the tick only when one was sent", () => {
    expect(sentQuid({ quid: true })).toBe(true);
    expect(sentQuid({ quid: false })).toBe(false);
    expect(sentQuid({ ingredientId: 3 })).toBeUndefined();
    expect(sentQuid(null)).toBeUndefined();
  });
});

const plain = (s: string) => s.replace(/\*\*/g, "");
const item = (ingredientId: number, name: string, quantityG: number, labelDeclaration: string | null = null, isQuid = false): DeckItem =>
  ({ ingredientId, name, quantityG, labelDeclaration, allergens: [], isQuid });

describe("percentages follow the weights", () => {
  const dough: DeckGroup = { subRecipeId: 1, name: "Calzone Dough", labelDeclaration: null, totalQuantityG: 115, isQuid: false, ingredients: [item(32, "Flour", 70, "Flour"), item(95, "Water", 45, "Water")] };

  it("changing a QUID ingredient's weight changes its percentage on the deck", () => {
    const before = buildDeck([item(191, "Chicken Breast", 60, "Chicken", true), item(47, "Mozzarella", 75, "Mozzarella")], [dough]);
    const after = buildDeck([item(191, "Chicken Breast", 80, "Chicken", true), item(47, "Mozzarella", 75, "Mozzarella")], [dough]);
    expect(before.deckText).toContain("Chicken (24%)"); // 60 / 250
    expect(after.deckText).toContain("Chicken (29.6%)"); // 80 / 270
  });

  it("a declaration carrying only its meat content takes the QUID instead (regression: 'Chicken (17.6%) (100%)')", () => {
    const { deckText } = buildDeck([item(191, "Chicken Breast", 60, "Chicken (100%)", true), item(47, "Mozzarella", 75, "Mozzarella")], [dough]);
    expect(deckText).toContain("Chicken (24%)");
    expect(deckText).not.toContain("(100%)");
  });

  it("an ingredient QUID inside a compound shows its share of the WHOLE product", () => {
    const mac: DeckGroup = { subRecipeId: 48, name: "Macaroni Cheese", labelDeclaration: null, totalQuantityG: 300, isQuid: false, ingredients: [item(101, "Macaroni", 100, "Macaroni (Durum WHEAT Semolina)", true), item(100, "Milk", 200, "Whole Milk")] };
    const { deckText } = buildDeck([item(22, "Pork", 100, "Pork")], [mac]);
    // 100 g of 400 g = 25%, not 33.3% of the compound.
    expect(plain(deckText)).toBe("Macaroni Cheese (Whole Milk, Macaroni (25%) (Durum WHEAT Semolina)), Pork.");
  });

  it("a QUID sub-recipe stays bracketed under its name even when it's small", () => {
    const butter: DeckGroup = { subRecipeId: 43, name: "Garlic Butter", labelDeclaration: null, totalQuantityG: 8, isQuid: true, ingredients: [item(65, "Butter", 6, "Butter (Milk)"), item(216, "Garlic Powder", 2, "Garlic powder")] };
    const { deckText } = buildDeck([item(47, "Mozzarella", 92, "Mozzarella")], [butter]);
    expect(plain(deckText)).toBe("Mozzarella, Garlic Butter (8%) (Butter (Milk), Garlic powder).");
    // Not QUID → broken up into the main list as before.
    expect(plain(buildDeck([item(47, "Mozzarella", 92, "Mozzarella")], [{ ...butter, isQuid: false }]).deckText)).toBe("Mozzarella, Butter (Milk), Garlic powder.");
  });

  it("an ingredient QUID inside a small (broken-up) sub-recipe keeps its tick", () => {
    const confit: DeckGroup = { subRecipeId: 44, name: "Garlic Confit", labelDeclaration: null, totalQuantityG: 20, isQuid: false, ingredients: [item(63, "Garlic", 15, "Garlic", true), item(25, "Olive Oil", 5, "Olive Oil")] };
    expect(buildDeck([item(47, "Mozzarella", 80, "Mozzarella")], [confit]).deckText).toBe("Mozzarella, Garlic (15%), Olive Oil.");
  });
});

describe("pack labels notice a QUID change", () => {
  it("a new percentage in the deck is an 'Ingredients' change → Label update needed", () => {
    const snap = (deckText: string) => buildSnapshot({
      recipe: { name: "Chicken and Chorizo", packSize: "2", shelfLifeDays: 13 },
      deck: { deckText, mayContainStatement: null },
      settings: DEFAULT_RECIPE_LABEL_SETTINGS,
      templateId: 1,
      template: normaliseTemplate(DEFAULT_TEMPLATE),
    });
    const live = snap(buildDeck([item(191, "Chicken", 60, "Chicken")], []).deckText);
    const now = snap(buildDeck([item(191, "Chicken", 60, "Chicken", true)], []).deckText);
    expect(diffSnapshots(live, now).map(c => c.label)).toEqual(["Ingredients"]);
  });
});
