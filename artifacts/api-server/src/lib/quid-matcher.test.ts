import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_QUID_TERMS, declarationHead, foldWord, matchQuid, parseQuidKey, quidTargetKey, words, type QuidComponentInput, type QuidLineInput } from "./quid-matcher";

// Fixtures: the real lines of each recipe, read from a copy of live
// (tck_live, 2026-10-10) — names, declarations and categories as stored.
const ing = (id: number, name: string, category: string | null, declaration: string | null = null): QuidLineInput =>
  ({ kind: "ingredient", id, name, declaration, category });
const comp = (ingredientId: number, name: string, category: string | null, declaration: string | null = null): QuidComponentInput =>
  ({ ingredientId, name, declaration, category });
const sub = (id: number, name: string, components: QuidComponentInput[] = []): QuidLineInput =>
  ({ kind: "subRecipe", id, name, declaration: null, category: null, components });

const MOZZ_DECL = "Mozzarella (Pasteurised Bovine MILK, Salt, Lactic Starter Culture, Microbial Rennet)";
const mozzarella = ing(47, "Mozzarella", "cheese", MOZZ_DECL);
const fiorDiLatte = ing(7, "Fior Di Latte", "base", MOZZ_DECL);
const chickenBreast = ing(191, "British Red Tractor Diced Chicken Breast", "raw_meat", "Chicken (100%)");
const dicedChorizo = ing(23, "Diced Chorizo", "cooked_meat", "Diced Chorizo (Pork (122g per 110g of finished product), lactose, salt)");
const pork = ing(22, "Pork", "raw_meat", "Pork");
const stickyBbq = ing(45, "Sticky BBQ", "sauce", "Water, Sugar, Tomato Paste, Glucose-Fructose Syrup, Modified Maize Starch");
const honeyChipotle = ing(211, "Honey Chipotle BBQ Sauce", "sauce", "Tomato Puree, Sugar, White Grape Vinegar, Honey (8%), Onion");
const beefMince = ing(306, "Beef Mince", "raw_meat", "Beef mince");
const pepperoni = ing(300, "Classic Sliced Pepperoni", "cooked_meat", "Pork (162g of pork per 100g of pepperoni), salt, paprika powder");
const redChillis = ing(72, "Red Chillis", "vegetable", "red chilli pepper");
const oregano = ing(43, "Oregano", "herb", "Oregano");
const blackPepper = ing(215, "Cracked Black Pepper", "seasoning", "Black Pepper");
const streakyBacon = ing(208, "Streaky Bacon", "other", "Streaky bacon");
const chickenSeasoning = ing(205, "Chicken Seasoning Mix", "seasoning", null);

const garlicGranules = comp(38, "Garlic Granules", "seasoning", "Garlic Granules");
const salt = comp(3, "Salt", "spice", "Salt");
const dough = sub(1, "Calzone Dough", [comp(32, "Blue Pizzeria Flour Type 00", "dough", "00 Flour (Wheat, Calcium Carbonate, Iron, Niacin, Thiamin)"), comp(80, "Yeast", "dough", "Yeast"), comp(95, "Tap Water", "other", "Water"), comp(25, "Olive Oil", "other", "Olive Oil"), salt]);
const tomatoBase = sub(2, "Tomato Base", [comp(37, "Tomato Puree (paste)", "sauce", "Tomato paste"), comp(26, "Passata (Rodolfi)", "sauce", "Tomatoes"), comp(95, "Tap Water", "other", "Water"), comp(39, "Ground black pepper", "spice", "Black Pepper"), comp(27, "Demerara Sugar", "other", "Demerara Sugar"), garlicGranules, comp(41, "Paprika", "spice", "Paprika"), salt]);
const piriPiri = sub(65, "Piri Piri Seasoning", [comp(262, "Cayenne Pepper", "seasoning", "Cayenne Pepper"), garlicGranules, comp(48, "Crushed Chillies", "spice", "Crushed chillis"), salt]);
const porkRub = sub(42, "Pork Rub", [comp(220, "Smoked Paprika", "seasoning", "Smoked Paprika"), comp(27, "Demerara Sugar", "other", "Demerara Sugar"), salt]);
const garlicButter = sub(43, "Garlic Butter", [comp(216, "Garlic Powder", "seasoning", "Garlic powder"), comp(64, "Dried Parsley", "herb", "Dried Parsley"), comp(65, "Salted Butter", "other", "Butter (Milk), Salt"), comp(25, "Olive Oil", "other", "Olive Oil")]);
const garlicConfit = sub(44, "Garlic Confit", [garlicGranules, comp(19, "Rosemary", "herb", "Rosemary"), comp(62, "Dried Thyme", "herb", "Dried Thyme"), comp(63, "Garlic Cloves fresh peeled", "vegetable", "Garlic"), comp(25, "Olive Oil", "other", "Olive Oil"), salt]);
const cheddar = comp(198, "Extra Matture Cheddar", "cheese", "Cheddar (Milk)");
const macCheese = sub(48, "Macaroni Cheese", [comp(65, "Salted Butter", "other", "Butter (Milk), Salt"), comp(100, "Whole Milk", "dairy", "Whole Milk"), comp(101, "Macaroni", "pasta", "Macaroni (Durum WHEAT Semolina)"), comp(95, "Tap Water", "other", "Water"), cheddar, comp(102, "Double Cream", null, "Double Cream (Milk)"), garlicGranules, salt]);
const breadcrumb = sub(50, "Breadcrumb Topping", [comp(64, "Dried Parsley", "herb", "Dried Parsley"), cheddar, comp(103, "Panko Breadcrumbs", "other", "Wheat Flour, Yeast, Salt.")]);
const phillyBeef = sub(68, "Slow-cooked Philly Beef", [comp(37, "Tomato Puree (paste)", "sauce", "Tomato paste"), comp(310, "Diced Beef", "raw_meat", "Beef"), comp(311, "Diced white onions", "vegetable", "onions"), comp(312, "Premium Natural Beef Stock", "other", "Water, beef bones, onion, carrot, leek"), comp(216, "Garlic Powder", "seasoning", "Garlic powder")]);
const nachoCheese = sub(59, "Nacho Cheese Block v4", [comp(209, "Grated Monterey Jack Cheese", "cheese", "Monterey Jack Cheese (98%)(Milk), Anti-caking Agent (Potato Starch)"), cheddar, comp(100, "Whole Milk", "dairy", "Whole Milk")]);
const donTomatoBase = sub(51, "Don Tomato Base", [comp(37, "Tomato Puree (paste)", "sauce", "Tomato paste"), comp(213, "Chilli Jam", "sauce", "Sugar, Red Chilli (22%), White Wine Vinegar")]);
const carnizoneMix = sub(45, "Carnizone Base Mix", [comp(128, "Smoked paprika (old)", "spice", "Smoked Paprika"), garlicGranules, comp(42, "Mild Chilli Powder", "spice", "Paprika, Chilli Powder (20%)")]);
const pieFilling = sub(70, "Chicken, Leek & Tarragon Pie Filling", [comp(400, "Fresh Tarragon", "vegetable", "Tarragon"), comp(290, "Skinless and Boneless Chicken Thighs", "raw_meat", "Chicken Thigh"), comp(100, "Whole Milk", "dairy", "Whole Milk"), comp(401, "Leeks - Sliced Prepared", "vegetable", "Leek"), comp(311, "Diced white onions", "vegetable", "onions"), comp(208, "Streaky Bacon", "other", "Streaky bacon"), comp(402, "Plain Flour", "other", "WHEAT Flour")]);

const RECIPES: Record<string, QuidLineInput[]> = {
  "Margherita": [ing(18, "Fresh Basil", "vegetable", "Basil"), ing(75, "Dried Basil", "herb", "Basil"), fiorDiLatte, dough, tomatoBase],
  "Chicken and Chorizo": [dicedChorizo, ing(34, "Greek Feta Cheese", "cheese", "Greek Feta Cheese (Pasteurised sheep's milk (70% min))"), ing(18, "Fresh Basil", "vegetable", "Basil"), mozzarella, chickenBreast, ing(13, "Red Onions", "vegetable", "Red onions"), ing(12, "Red peppers", "vegetable", "Red peppers"), dough, tomatoBase, piriPiri],
  "BBQ Pulled Pork": [ing(19, "Rosemary", "herb", "Rosemary"), pork, mozzarella, stickyBbq, dough, porkRub],
  "Honey Chipotle BBQ Pulled Pork": [pork, mozzarella, honeyChipotle, dough, porkRub],
  "Chicken & Bacon Pie Calzone": [mozzarella, sub(72, "Chicken & Bacon Pie Filling", [comp(290, "Skinless and Boneless Chicken Thighs", "raw_meat", "Chicken Thigh"), comp(208, "Streaky Bacon", "other", "Streaky bacon"), comp(100, "Whole Milk", "dairy", "Whole Milk"), comp(402, "Plain Flour", "other", "WHEAT Flour")]), dough],
  "Chorizo Chilli & Fior Di Latte": [dicedChorizo, oregano, fiorDiLatte, redChillis, dough, tomatoBase],
  "Pepperoni & Mushroom": [oregano, mozzarella, ing(14, "Button Mushrooms", "vegetable", "Mushrooms"), pepperoni, dough, tomatoBase],
  "Open Fire BBQ Chicken & Garlic Butter": [mozzarella, ing(290, "Skinless and Boneless Chicken Thighs", "raw_meat", "Chicken Thigh"), honeyChipotle, dough, garlicButter, piriPiri],
  "Philly Cheesesteak 2.0": [blackPepper, mozzarella, dough, phillyBeef, nachoCheese],
  "The Don - Double Bacon Cheeseburger Calzone": [blackPepper, beefMince, ing(209, "Grated Monterey Jack Cheese", "cheese", "Monterey Jack Cheese (98%)(Milk), Anti-caking Agent (Potato Starch)"), mozzarella, streakyBacon, ing(206, "Gluten Free Crispy Fried Onions", "vegetable", "Onions 75%, Sunflower Oil, Corn Starch, Salt"), dough, donTomatoBase],
  "Garlic Cheese Calzones (V)": [ing(61, "Grated Mature White Cheddar Cheese", "cheese", null), mozzarella, dough, garlicConfit, garlicButter],
  "Big Nanny's Macaroni Cheese": [macCheese, breadcrumb],
  "Big Nanny's Macaroni Cheese - Honey Chipotle Pulled Pork": [pork, honeyChipotle, macCheese, breadcrumb, porkRub],
  "Pigs & Blankets - Big Nanny's Macaroni Cheese": [ing(189, "Pigs In Blankets", "raw_meat", null), macCheese, breadcrumb],
  "Balsamic Roasted Vegetables": [ing(28, "Balsamic Glaze", "sauce", "Balsamic Glaze (Balsamic Vinegar of Modena (Wine Vinegar, Grape Must))"), mozzarella, ing(16, "Courgettes", "vegetable", "Courgette"), ing(14, "Button Mushrooms", "vegetable", "Mushrooms"), ing(12, "Red peppers", "vegetable", "Red peppers"), ing(13, "Red Onions", "vegetable", "Red onions"), dough, tomatoBase],
  "The Christmas Dinner": [mozzarella, ing(500, "Roast Turkey Breast", "cooked_meat", "Turkey"), ing(501, "Sage & Onion Stuffing", "other", "Stuffing (Breadcrumbs (WHEAT), Onion, Sage)"), ing(502, "Cranberry Sauce", "sauce", "Cranberry Sauce (Cranberries, Sugar)"), ing(503, "Pigs In Blankets", "raw_meat", null), dough],
  "Carnizone": [ing(97, "Honey ", "sauce", "Honey"), oregano, fiorDiLatte, chickenBreast, beefMince, ing(11, "Pepperoni", "cooked_meat", "Pepperoni (Pork, Spices, Salt)"), chickenSeasoning, dough, tomatoBase, carnizoneMix],
  "The Benji": [oregano, mozzarella, pepperoni, ing(36, "Black Olive Slices", "vegetable", "Black Olives (Olives, Colour Stabiliser: Ferrous Gluconate)"), redChillis, dough, tomatoBase],
  "The Godfather": [blackPepper, mozzarella, beefMince, ing(58, "Caramelised Red Onion Chutney", "sauce", "Caramelised Red Onion Chutney (Sliced Red Onions (75%), Demerara Sugar)"), ing(57, "Gherkin (drained weight)", "vegetable", "Gherkin"), dough, tomatoBase, sub(69, "TCK Burger Sauce", [comp(213, "Free Range Egg Yolk Mayonnaise", "sauce", "Mayonnaise (Rapeseed Oil, Water)")])],
};

const run = (name: string) => matchQuid(name, RECIPES[name], DEFAULT_QUID_TERMS);
const auto = (name: string) => run(name).decisions.filter(d => d.level === "auto").map(d => d.key).sort();
const asked = (name: string) => run(name).decisions.filter(d => d.level === "suggest").map(d => d.key).sort();

describe("reading words", () => {
  it("folds plurals, apostrophes, accents and &", () => {
    expect(words("Big Nanny's Mushrooms & Chillies")).toEqual(["big", "nanni", "mushroom", "and", "chilli"]);
    expect(words("Red Chillis")).toEqual(words("red chilli"));
    expect(words("Jalapeños")).toEqual(words("jalapeno"));
    expect(foldWord("tomatoes")).toBe(foldWord("tomato"));
    expect(foldWord("berries")).toBe(foldWord("berry"));
  });
  it("takes a declaration's name only when it declares one thing", () => {
    expect(declarationHead(MOZZ_DECL)).toBe("Mozzarella");
    expect(declarationHead("Pork (162g of pork per 100g), salt, paprika")).toBeNull();
    expect(declarationHead("Chicken (100%)")).toBe("Chicken");
  });
  it("keys round-trip", () => {
    for (const t of [{ kind: "ingredient", ingredientId: 4 }, { kind: "subRecipe", subRecipeId: 9 }, { kind: "component", subRecipeId: 9, ingredientId: 4 }] as const) {
      expect(parseQuidKey(quidTargetKey(t))).toEqual(t);
    }
    expect(parseQuidKey("x:1")).toBeNull();
  });
});

describe("automatic QUID on the real recipe names", () => {
  it("Chicken and Chorizo → the chicken breast and the diced chorizo, nothing else", () => {
    expect(auto("Chicken and Chorizo")).toEqual(["i:191", "i:23"].sort());
    expect(asked("Chicken and Chorizo")).toEqual([]);
  });

  it("BBQ Pulled Pork → pork; BBQ is a question about the sauce; the pork rub is never ticked", () => {
    expect(auto("BBQ Pulled Pork")).toEqual(["i:22"]);
    expect(asked("BBQ Pulled Pork")).toEqual(["i:45"]);
  });

  it("Honey Chipotle BBQ Pulled Pork → pork; honey/chipotle/BBQ are questions", () => {
    expect(auto("Honey Chipotle BBQ Pulled Pork")).toEqual(["i:22"]);
    expect(asked("Honey Chipotle BBQ Pulled Pork")).toEqual(["i:211"]);
  });

  it("Chicken & Bacon Pie Calzone → the chicken and bacon INSIDE the pie filling, not the filling", () => {
    expect(auto("Chicken & Bacon Pie Calzone")).toEqual(["c:72:208", "c:72:290"]);
  });

  it("Chorizo Chilli & Fior Di Latte → chorizo, chillies, fior di latte", () => {
    expect(auto("Chorizo Chilli & Fior Di Latte")).toEqual(["i:23", "i:7", "i:72"].sort());
  });

  it("Pepperoni & Mushroom → pepperoni and the mushrooms (plural)", () => {
    expect(auto("Pepperoni & Mushroom")).toEqual(["i:14", "i:300"]);
  });

  it("Open Fire BBQ Chicken & Garlic Butter → chicken and the garlic butter itself; BBQ asked", () => {
    expect(auto("Open Fire BBQ Chicken & Garlic Butter")).toEqual(["i:290", "s:43"]);
    expect(asked("Open Fire BBQ Chicken & Garlic Butter")).toEqual(["i:211"]);
  });

  it("Philly Cheesesteak 2.0 → the beef inside the Philly beef, not the beef stock", () => {
    expect(auto("Philly Cheesesteak 2.0")).toEqual(["c:68:310"]);
    expect(asked("Philly Cheesesteak 2.0")).toEqual([]);
  });

  it("The Don – Double Bacon Cheeseburger → bacon, beef and every cheese", () => {
    expect(auto("The Don - Double Bacon Cheeseburger Calzone")).toEqual(["i:208", "i:209", "i:306", "i:47"].sort());
  });

  it("Garlic Cheese Calzones (V) → the cheeses (category), the garlic inside the confit, the garlic butter", () => {
    expect(auto("Garlic Cheese Calzones (V)")).toEqual(["c:44:63", "i:47", "i:61", "s:43"].sort());
  });

  it("Big Nanny's Macaroni Cheese → the macaroni and every cheddar (inside both sub-recipes)", () => {
    expect(auto("Big Nanny's Macaroni Cheese")).toEqual(["c:48:101", "c:48:198", "c:50:198"].sort());
  });

  it("Big Nanny's Macaroni Cheese – Honey Chipotle Pulled Pork → macaroni, cheese, pork; the sauce asked", () => {
    expect(auto("Big Nanny's Macaroni Cheese - Honey Chipotle Pulled Pork")).toEqual(["c:48:101", "c:48:198", "c:50:198", "i:22"].sort());
    expect(asked("Big Nanny's Macaroni Cheese - Honey Chipotle Pulled Pork")).toEqual(["i:211"]);
  });

  it("Pigs & Blankets – Big Nanny's Macaroni Cheese → the pigs in blankets too", () => {
    expect(auto("Pigs & Blankets - Big Nanny's Macaroni Cheese")).toContain("i:189");
  });

  it("Balsamic Roasted Vegetables → every vegetable (category); balsamic asked", () => {
    expect(auto("Balsamic Roasted Vegetables")).toEqual(["i:12", "i:13", "i:14", "i:16"]);
    expect(asked("Balsamic Roasted Vegetables")).toEqual(["i:28"]);
  });

  it("The Christmas Dinner → nothing: the name names no ingredient", () => {
    expect(run("The Christmas Dinner").decisions).toEqual([]);
  });

  it("made-up names name nothing: Carnizone, The Benji, The Godfather, Margherita", () => {
    for (const n of ["Carnizone", "The Benji", "The Godfather", "Margherita"]) {
      expect(run(n).decisions, n).toEqual([]);
      expect(run(n).unmatched, n).toEqual([]);
    }
  });

  it("a named ingredient with no matching line is reported, not guessed", () => {
    const r = matchQuid("Chicken & Chorizo", [chickenBreast, ing(326, "Hot Paprika Crumble", "cooked_meat", "Pork (147g of pork per 100g), salt, hot paprika"), dough], DEFAULT_QUID_TERMS);
    expect(r.decisions.map(d => d.key)).toEqual(["i:191"]);
    expect(r.unmatched).toEqual(["Chorizo"]);
  });

  it("never ticks dough, a base or a seasoning because a word overlaps", () => {
    const r = matchQuid("Chicken Special", [chickenBreast, chickenSeasoning, dough], DEFAULT_QUID_TERMS);
    expect(r.decisions.map(d => `${d.key}:${d.level}`)).toEqual(["i:191:auto"]);
    // Only a seasoning carries the word → a question, never a tick.
    const only = matchQuid("Fajita Chicken", [chickenBreast, sub(57, "Fajita Base", [])], DEFAULT_QUID_TERMS);
    expect(only.decisions.find(d => d.key === "s:57")?.level).toBe("suggest");
  });

  it("a product that is one sub-recipe is never QUID as a whole (no 'TCK Garlic Mayo (100%)')", () => {
    const mayo = sub(66, "TCK Garlic Mayo", [comp(213, "Free Range Egg Yolk Mayonnaise", "sauce", "Mayonnaise (Rapeseed Oil, Water)"), garlicGranules]);
    const r = matchQuid("TCK Garlic Mayo 200ml", [mayo], DEFAULT_QUID_TERMS);
    expect(r.decisions.map(d => `${d.key}:${d.level}`)).toEqual(["c:66:38:suggest"]);
    const strips = sub(58, "Buttermilk Fried Chicken Strip", [comp(290, "Chicken breast fillet strips", "raw_meat", "Chicken Breast"), comp(100, "Whole Milk", "dairy", "Whole Milk")]);
    expect(matchQuid("Buttermilk Fried Chicken 400g", [strips], DEFAULT_QUID_TERMS).decisions.map(d => `${d.key}:${d.level}`)).toEqual(["c:58:290:auto"]);
  });

  it("a new word not on the list is only ever a question", () => {
    const r = matchQuid("Cinnamon Buns", [sub(61, "Cinnamon Bun Filling", [comp(600, "Ground Cinnamon", "spice", "Cinnamon")])], DEFAULT_QUID_TERMS);
    expect(r.decisions.map(d => `${d.key}:${d.level}`)).toEqual(["c:61:600:suggest"]);
  });

  it("the words list is data: adding a word makes it automatic", () => {
    const lines = [sub(61, "Cinnamon Bun Filling", [comp(600, "Ground Cinnamon", "spice", "Cinnamon")])];
    const r = matchQuid("Cinnamon Buns", lines, [...DEFAULT_QUID_TERMS, { phrase: "cinnamon", mode: "auto" }]);
    expect(r.decisions.map(d => `${d.key}:${d.level}`)).toEqual(["c:61:600:auto"]);
  });
});

describe("the shipped words list", () => {
  it("migration 0165 seeds exactly DEFAULT_QUID_TERMS", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../lib/db/migrations/0165_automatic_quid.sql", import.meta.url)), "utf8");
    const seed = sql.split("-- seed:start")[1].split("-- seed:end")[0];
    const rows = [...seed.matchAll(/^\s*\('((?:[^']|'')*)', '(\w+)'/gm)].map(m => `${m[1]}|${m[2]}`);
    expect(rows).toEqual(DEFAULT_QUID_TERMS.map(t => `${t.phrase}|${t.mode}`));
  });
});
