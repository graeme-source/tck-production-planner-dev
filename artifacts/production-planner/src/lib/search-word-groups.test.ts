import { describe, it, expect } from "vitest";
import { groupBySearchWord, orderForSupplierSearch, searchWords, singularise } from "./search-word-groups";

const group = (names: string[]) =>
  groupBySearchWord(names, n => n).map(g => ({ word: g.searchWord, items: g.items }));

describe("singularise", () => {
  it("handles simple plurals", () => {
    expect(singularise("onions")).toBe("onion");
    expect(singularise("tomatoes")).toBe("tomato");
    expect(singularise("berries")).toBe("berry");
    expect(singularise("peaches")).toBe("peach");
    expect(singularise("chillis")).toBe("chilli");
    expect(singularise("cress")).toBe("cress");
    expect(singularise("asparagus")).toBe("asparagus");
  });
});

describe("searchWords", () => {
  it("drops sizes, units, brackets, punctuation, colours and filler", () => {
    expect(searchWords("Fresh British Red Onions 5kg x10 (case)")).toEqual(["onion"]);
    expect(searchWords("Carrots (Diced)")).toEqual(["carrot"]);
    expect(searchWords("Loose White Mushrooms, 2.5 kg")).toEqual(["mushroom"]);
    expect(searchWords("Mix")).toEqual([]);
  });
});

describe("groupBySearchWord", () => {
  it("puts red, white and spring onions together; garlic stays alone", () => {
    const out = group(["Red Onions", "Garlic", "Diced white onions", "Basil", "Spring Onions"]);
    expect(out).toEqual([
      { word: null, items: ["Basil"] },
      { word: null, items: ["Garlic"] },
      { word: "onion", items: ["Diced white onions", "Red Onions", "Spring Onions"] },
    ]);
  });

  it("groups cherry and plum tomatoes", () => {
    const out = group(["Plum Tomatoes", "Courgettes", "Cherry Tomatoes"]);
    expect(out).toEqual([
      { word: null, items: ["Courgettes"] },
      { word: "tomato", items: ["Cherry Tomatoes", "Plum Tomatoes"] },
    ]);
  });

  it("never groups on weak words like colours, mix or sizes", () => {
    const out = group(["Red Peppers 5kg", "Red Chillis 5kg", "Salad Mix", "Herb Mix"]);
    expect(out.every(g => g.word == null)).toBe(true);
  });

  it("joins the word shared with the most items, preferring the noun", () => {
    // "Onion Powder" shares "onion" with two others and nothing with "powder".
    const out = group(["Onion Powder", "Red Onions", "Spring Onions", "Garlic Powder"]);
    // powder (2) vs onion (3) → Onion Powder goes with the onions;
    // Garlic Powder's partner left, so it's a lone item again.
    expect(out).toEqual([
      { word: null, items: ["Garlic Powder"] },
      { word: "onion", items: ["Onion Powder", "Red Onions", "Spring Onions"] },
    ]);
  });

  it("only looks at the one card — a word shared with another supplier's items doesn't matter", () => {
    // Each card is grouped on its own; a lone "Red Onions" on this card has
    // no partner even if another supplier also sells onions.
    const cardA = group(["Red Onions", "Garlic"]);
    expect(cardA.every(g => g.word == null)).toBe(true);
    expect(cardA.map(g => g.items[0])).toEqual(["Garlic", "Red Onions"]);
  });

  it("keeps lone items alphabetical among the groups and keeps every item exactly once", () => {
    const names = ["Mushrooms", "Chestnut Mushrooms", "Baby Spinach", "Tomatoes", "Pomodori Peeled Plum Tomatoes", "Zest"];
    const out = group(names);
    expect(out.map(g => g.word ?? g.items[0])).toEqual(["Baby Spinach", "mushroom", "tomato", "Zest"]);
    expect(out.flatMap(g => g.items).sort()).toEqual([...names].sort());
  });

  it("a realistic produce card", () => {
    const out = group([
      "Baby Spinach", "Broccoli (prepared)", "Carrots (Diced)", "Carrots (Grated)", "Chestnut Mushrooms",
      "Diced white onions", "Green Peppers", "Jalapenos (Drained weight)", "Mushrooms", "Onion Powder",
      "Peeled Shallots", "Pomodori Peeled Plum Tomatoes", "Red Chillis", "Red Onions", "Red peppers",
      "Roasted Red Peppers", "Spring Onions", "Tomatoes",
    ]);
    expect(out.filter(g => g.word).map(g => [g.word, g.items.length])).toEqual([
      ["carrot", 2], ["mushroom", 2], ["onion", 4], ["pepper", 3], ["tomato", 2],
    ]);
  });

  it("returns nothing for an empty card", () => {
    expect(group([])).toEqual([]);
  });
});

describe("orderForSupplierSearch", () => {
  it("labels the first row of each group and leaves kept-in-place rows at the end, in order", () => {
    const rows = [
      { name: "Red Onions", added: false },
      { name: "Basil", added: false },
      { name: "Zucchini", added: true },
      { name: "Diced white onions", added: false },
      { name: "Apples", added: true },
    ];
    const out = orderForSupplierSearch(rows, r => r.name, r => r.added);
    expect(out.map(r => [r.item.name, r.searchWord])).toEqual([
      ["Basil", null],
      ["Diced white onions", "onion"],
      ["Red Onions", null],
      ["Zucchini", null],
      ["Apples", null],
    ]);
  });
});
