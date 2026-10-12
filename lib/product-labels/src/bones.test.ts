import { describe, it, expect } from "vitest";
import { findBoneRisk, resolveBonesWarning } from "./bones";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, snapshotKey } from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate } from "./template";

const CHICKEN_DECK =
  "Fortified **Wheat** Flour (**Wheat** Flour, Calcium Carbonate), Cooked Chicken Thigh (22%) (Chicken, Salt), Water, Mozzarella Cheese (**Milk**).";
// A sub-recipe compound: the chicken is only inside the brackets.
const SUB_RECIPE_DECK = "Calzone Dough (Flour, Water), Pie Filling (Onion, chicken stock (Water, Salt), Cream (**Milk**)), Salt.";
const VEG_DECK = "Calzone Dough (00 Flour (**Wheat**), Water), Chickpeas (12%), Mozzarella (**Milk**), Garlic Butter (Butter (**Milk**)).";

describe("finding bone-risk words in a deck", () => {
  it("finds the word, any case, and names the ingredient it is in", () => {
    expect(findBoneRisk(CHICKEN_DECK, ["chicken"])).toEqual({ word: "chicken", ingredient: "Cooked Chicken Thigh" });
    expect(findBoneRisk(CHICKEN_DECK, ["CHICKEN"])?.ingredient).toBe("Cooked Chicken Thigh");
  });

  it("looks inside sub-recipes (the whole flattened deck)", () => {
    expect(findBoneRisk(SUB_RECIPE_DECK, ["chicken"])).toEqual({ word: "chicken", ingredient: "chicken stock" });
  });

  it("whole words only: chicken is not chickpea", () => {
    expect(findBoneRisk(VEG_DECK, ["chicken"])).toBeNull();
    expect(findBoneRisk("Chickens (100%)", ["chicken"])).toBeNull();
  });

  it("ignores the **bold** markup and blank words; any listed word counts", () => {
    expect(findBoneRisk("**Chicken** Egg Noodles", ["chicken"])?.ingredient).toBe("Chicken Egg Noodles");
    expect(findBoneRisk(VEG_DECK, ["  ", "lamb", "garlic butter"])).toEqual({ word: "garlic butter", ingredient: "Garlic Butter" });
  });

  it("an empty word list never matches", () => {
    expect(findBoneRisk(CHICKEN_DECK, [])).toBeNull();
  });

  it("words with regex characters are taken literally", () => {
    expect(findBoneRisk("Salt, Pepper", ["s.lt"])).toBeNull();
  });
});

describe("resolving the bones warning", () => {
  it("Automatic follows the ingredients", () => {
    expect(resolveBonesWarning(null, CHICKEN_DECK, ["chicken"])).toMatchObject({ on: true, mode: "auto" });
    expect(resolveBonesWarning(null, VEG_DECK, ["chicken"])).toMatchObject({ on: false, mode: "auto", auto: null });
    expect(resolveBonesWarning(null, CHICKEN_DECK, []).on).toBe(false);
  });

  it("a manual choice wins, and Automatic's finding is still reported", () => {
    expect(resolveBonesWarning(false, CHICKEN_DECK, ["chicken"])).toMatchObject({ on: false, mode: "off", auto: { word: "chicken" } });
    expect(resolveBonesWarning(true, VEG_DECK, ["chicken"])).toMatchObject({ on: true, mode: "on", auto: null });
  });
});

describe("the snapshot stores what prints", () => {
  const make = (deckText: string, warningOn: boolean | null = DEFAULT_RECIPE_LABEL_SETTINGS.warningOn, words?: string[]) =>
    buildSnapshot({
      recipe: { name: "Test", packSize: "2", shelfLifeDays: 13 },
      deck: { deckText, mayContainStatement: null },
      settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, warningOn },
      templateId: 1,
      template: normaliseTemplate({ ...DEFAULT_TEMPLATE, ...(words ? { boneRiskWords: words } : {}) }),
    });

  it("new recipes default to Automatic", () => {
    expect(DEFAULT_RECIPE_LABEL_SETTINGS.warningOn).toBeNull();
    expect(make(CHICKEN_DECK).warningOn).toBe(true);
    expect(make(VEG_DECK).warningOn).toBe(false);
  });

  it("a deck change that flips Automatic shows as the Bones warning change", () => {
    const changes = diffSnapshots(make(CHICKEN_DECK), make(VEG_DECK));
    expect(changes.find(c => c.key === "warningOn")).toMatchObject({ label: "Bones warning", before: "On", after: "Off" });
  });

  it("editing the word list only flags labels whose result changes", () => {
    // Adding "lamb" doesn't change a chicken label: same printed snapshot.
    expect(snapshotKey(make(CHICKEN_DECK, null, ["chicken", "lamb"]))).toBe(snapshotKey(make(CHICKEN_DECK, null, ["chicken"])));
    // Removing "chicken" does.
    expect(make(CHICKEN_DECK, null, []).warningOn).toBe(false);
  });

  it("a published snapshot from before stays as it printed (a plain boolean)", () => {
    const old = { ...make(VEG_DECK), warningOn: true };
    expect(diffSnapshots(old, make(VEG_DECK)).find(c => c.key === "warningOn")).toMatchObject({ before: "On", after: "Off" });
  });
});

describe("template word list", () => {
  it("defaults to chicken; older templates get the default", () => {
    expect(DEFAULT_TEMPLATE.boneRiskWords).toEqual(["chicken"]);
    expect(normaliseTemplate({}).boneRiskWords).toEqual(["chicken"]);
  });

  it("is tidied: trimmed, blanks and repeats dropped; an empty list stays empty", () => {
    expect(normaliseTemplate({ boneRiskWords: [" Chicken ", "chicken", "", 7, "turkey  breast"] }).boneRiskWords).toEqual(["Chicken", "turkey breast"]);
    expect(normaliseTemplate({ boneRiskWords: [] }).boneRiskWords).toEqual([]);
    expect(normaliseTemplate({ boneRiskWords: "chicken" }).boneRiskWords).toEqual(["chicken"]);
  });
});
