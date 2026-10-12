import { describe, it, expect } from "vitest";
import {
  capCooking, cookingOverCap, cookingProfile, DEFAULT_COOKING_TIERS, normaliseCookingTiers, subRecipeMix, suggestCooking,
  type CookingProfile, type CookingTiersConfig, type SubRecipeMakeup,
} from "./cooking-tiers";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, effectiveCookingMode, resolveCooking, snapshotKey, type RecipeLabelSettings } from "./snapshot";
import { buildLabelContent } from "./content";
import { DEFAULT_TEMPLATE, normaliseTemplate, type CookingValues, type LabelTemplate } from "./template";
import { halveRange } from "./cooking";

const cfg = (o: Partial<CookingTiersConfig> = {}): CookingTiersConfig => ({ ...normaliseCookingTiers(DEFAULT_COOKING_TIERS), on: true, ...o });
const profile = (totalG: number, meatG: number, doughG = 115): CookingProfile => ({
  totalG, meatG, doughG, fillingG: totalG - doughG, vegG: 0, cheeseG: 0,
});
const tier = (p: CookingProfile, c = cfg()) => suggestCooking(p, c)?.tierName;

describe("tier selection", () => {
  it("anchors: Garlic Cheese (235 g, no meat) → Light; Chicken & Chorizo (338 g, 75 g meat) → Heavy", () => {
    expect(tier(profile(235, 0))).toBe("Light");
    expect(tier(profile(338, 75))).toBe("Heavy");
  });

  it("Graeme's in-betweens: Chorizo Chilli (280 g, 40 g meat) and Balsamic veg (318 g, no meat) → Medium", () => {
    expect(tier(profile(280, 40))).toBe("Medium");
    expect(tier(profile(318, 0))).toBe("Medium");
  });

  it("weight boundaries are 'up to and including'", () => {
    expect(tier(profile(260, 0))).toBe("Light");
    expect(tier(profile(261, 0))).toBe("Medium");
    expect(tier(profile(330, 0))).toBe("Medium");
    expect(tier(profile(331, 0))).toBe("Heavy");
  });

  it("meat boundaries are 'up to and including'", () => {
    expect(tier(profile(250, 20))).toBe("Light");
    expect(tier(profile(250, 21))).toBe("Medium");
    expect(tier(profile(300, 45))).toBe("Medium");
    expect(tier(profile(300, 46))).toBe("Heavy");
  });

  it("a recipe that fits no tier goes in the last one, and says so", () => {
    const c = cfg({ tiers: cfg().tiers.map(t => ({ ...t, maxWeightG: 300 })) });
    const s = suggestCooking(profile(400, 0), c)!;
    expect(s.tierName).toBe("Heavy");
    expect(s.reason).toContain("heavier than every other tier");
  });

  it("the reason names the tier, the weight and the meat", () => {
    expect(suggestCooking(profile(280, 40), cfg())!.reason).toBe("Medium — 280 g per calzone, 40 g meat (24% of the filling): within up to 330 g per calzone and up to 45 g meat");
  });

  it("no dough (not a calzone) or no tiers → no suggestion", () => {
    expect(suggestCooking(profile(400, 200, 0), cfg())).toBeNull();
    expect(suggestCooking(profile(300, 0), cfg({ tiers: [] }))).toBeNull();
  });
});

describe("the default tier times", () => {
  const t = (name: string) => cfg().tiers.find(x => x.name === name)!.cooking;
  it("Light = Garlic Cheese's hand-set times; Heavy = the standard 18–22 / 16–19", () => {
    expect(t("Light")).toMatchObject({ ovenMinMinutes: 14, ovenMaxMinutes: 16, airFryerTempC: 165, airFryerMinMinutes: 12, airFryerMaxMinutes: 15 });
    expect(t("Heavy")).toMatchObject({ ovenMinMinutes: 18, ovenMaxMinutes: 22, airFryerMinMinutes: 16, airFryerMaxMinutes: 19 });
    expect(t("Medium")).toMatchObject({ ovenMinMinutes: 16, ovenMaxMinutes: 19, airFryerMinMinutes: 14, airFryerMaxMinutes: 17 });
  });
  it("print as these halves either side of TURN OVER", () => {
    expect(halveRange(14, 16)).toEqual({ first: 8, second: [6, 8] });
    expect(halveRange(12, 15)).toEqual({ first: 7, second: [5, 8] });
    expect(halveRange(16, 19)).toEqual({ first: 9, second: [7, 10] });
    expect(halveRange(14, 17)).toEqual({ first: 8, second: [6, 9] });
  });
});

describe("hard cap: never more than 22 min oven / 19 min air fryer", () => {
  it("normalising clamps a tier set above the cap", () => {
    const c = normaliseCookingTiers({ ...DEFAULT_COOKING_TIERS, tiers: [{ key: "x", name: "X", cooking: { ovenMinMinutes: 24, ovenMaxMinutes: 28, airFryerMinMinutes: 18, airFryerMaxMinutes: 25 } }] });
    expect(c.tiers[0].cooking).toMatchObject({ ovenMinMinutes: 22, ovenMaxMinutes: 22, airFryerMinMinutes: 18, airFryerMaxMinutes: 19 });
  });
  it("capCooking leaves values under the cap alone", () => {
    const v: CookingValues = { ovenTempC: 200, fanTempC: 180, ovenMinMinutes: 18, ovenMaxMinutes: 22, airFryerTempC: 170, airFryerMinMinutes: 16, airFryerMaxMinutes: 19 };
    expect(capCooking(v, DEFAULT_COOKING_TIERS)).toEqual(v);
  });
  it("a suggested time falling back to an over-cap template value is capped", () => {
    const t = tpl({ on: true });
    t.cooking = { ...t.cooking, ovenMaxMinutes: 30 };
    t.cookingTiers.tiers = t.cookingTiers.tiers.map(x => ({ ...x, cooking: { ...x.cooking, ovenMaxMinutes: null } }));
    expect(resolveCooking(t, settings(), t.cookingTiers.tiers[2].cooking).ovenMaxMinutes).toBe(22);
  });
  it("a manual time over the cap blocks publishing", () => {
    const s = snap({ settings: { cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenMaxMinutes: 25, airFryerMaxMinutes: 20 } } });
    const problems = buildLabelContent(s, { printDate: "2026-10-12", productionDate: "2026-10-12", chilledUseBy: "2026-10-25", frozenUseBy: null, batchCode: "1" }).problems;
    expect(problems.some(p => p.includes("longest cook we print is 22"))).toBe(true);
    expect(problems.some(p => p.includes("longest we print is 19"))).toBe(true);
    expect(cookingOverCap(s.cooking, undefined)).toEqual([]);
  });
});

describe("normalising (back-compat)", () => {
  it("a stored template with no tiers gets the defaults, switched OFF", () => {
    const { cookingTiers: _drop, ...old } = JSON.parse(JSON.stringify(DEFAULT_TEMPLATE));
    const t = normaliseTemplate(old);
    expect(t.cookingTiers.on).toBe(false);
    expect(t.cookingTiers.tiers.map(x => x.name)).toEqual(["Light", "Medium", "Heavy"]);
    expect(t.cookingTiers.maxOvenMinutes).toBe(22);
  });
  it("nonsense is cleaned up", () => {
    const c = normaliseCookingTiers({ on: "yes", tiers: [{ name: "", maxWeightG: "abc", cooking: { ovenMinMinutes: -5 } }], categories: { meat: ["raw_meat", 4, "raw_meat"] } });
    expect(c.on).toBe(false);
    expect(c.tiers[0]).toMatchObject({ name: "Tier 1", maxWeightG: null, cooking: { ovenMinMinutes: 0 } });
    expect(c.categories.meat).toEqual(["raw_meat"]);
    expect(c.categories.dough).toEqual(["dough"]);
  });
});

// ── Resolving what prints ─────────────────────────────────────────────────

function tpl(tiers: Partial<CookingTiersConfig> = {}): LabelTemplate {
  const t = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  t.cooking = { ovenTempC: 200, fanTempC: 180, ovenMinMinutes: 18, ovenMaxMinutes: 22, airFryerTempC: 170, airFryerMinMinutes: 16, airFryerMaxMinutes: 19 };
  t.cookingTiers = { ...t.cookingTiers, ...tiers };
  return t;
}
const settings = (o: Partial<RecipeLabelSettings> = {}): RecipeLabelSettings => ({ ...DEFAULT_RECIPE_LABEL_SETTINGS, cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking }, ...o });
const light = () => cfg().tiers[0].cooking;
const garlicCheeseManual: CookingValues = { ovenTempC: 200, fanTempC: 180, ovenMinMinutes: 14, ovenMaxMinutes: 16, airFryerTempC: 165, airFryerMinMinutes: 12, airFryerMaxMinutes: 15 };
function snap(o: { settings?: Partial<RecipeLabelSettings>; template?: LabelTemplate; suggestion?: CookingValues | null } = {}) {
  return buildSnapshot({
    recipe: { name: "Test", packSize: "2", shelfLifeDays: 13 },
    deck: { deckText: "**Wheat** Flour", mayContainStatement: null },
    settings: settings({ barcode: "5065018206009", ...o.settings }),
    templateId: 1,
    template: o.template ?? tpl(),
    cookingSuggestion: o.suggestion,
  });
}

describe("mode", () => {
  it("not chosen: manual when the recipe has its own values (Garlic Cheese), else suggested", () => {
    expect(effectiveCookingMode(settings({ cooking: garlicCheeseManual }))).toBe("manual");
    expect(effectiveCookingMode(settings())).toBe("suggested");
    expect(effectiveCookingMode(settings({ cookingMode: "suggested", cooking: garlicCheeseManual }))).toBe("suggested");
  });

  it("tiers switched off (every template today): nothing changes — standard values print", () => {
    const t = tpl({ on: false });
    expect(resolveCooking(t, settings(), light())).toEqual(t.cooking);
    expect(snapshotKey(snap({ template: t, suggestion: light() }))).toBe(snapshotKey(snap({ template: t })));
  });

  it("tiers on: a recipe with no values of its own prints its tier's times, blanks from the template", () => {
    const c = resolveCooking(tpl({ on: true }), settings(), light());
    expect(c).toEqual({ ovenTempC: 200, fanTempC: 180, ovenMinMinutes: 14, ovenMaxMinutes: 16, airFryerTempC: 165, airFryerMinMinutes: 12, airFryerMaxMinutes: 15 });
  });

  it("manual wins over suggested", () => {
    const own = { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenMinMinutes: 15, ovenMaxMinutes: 17 };
    const c = resolveCooking(tpl({ on: true }), settings({ cooking: own }), cfg().tiers[2].cooking);
    expect(c).toMatchObject({ ovenMinMinutes: 15, ovenMaxMinutes: 17, airFryerMinMinutes: 16 });
    // Chosen Manual with no values = the template's standard values.
    expect(resolveCooking(tpl({ on: true }), settings({ cookingMode: "manual" }), light()).ovenMinMinutes).toBe(18);
  });

  it("an appliance switched off stays blank in suggested mode", () => {
    const c = resolveCooking(tpl({ on: true }), settings({ airFryerOn: false }), light());
    expect(c.airFryerMinMinutes).toBeNull();
    expect(c.ovenMinMinutes).toBe(14);
  });

  it("the snapshot stores the resolved times; template tiers alone never flag a label", () => {
    const off = snap({ template: tpl({ on: false }), suggestion: light() });
    const on = snap({ template: tpl({ on: true }), suggestion: light() });
    expect(on.cooking.ovenMinMinutes).toBe(14);
    expect(snapshotKey(off)).not.toBe(snapshotKey(on));
    // A heavy recipe's tier = the standard, so switching the tiers on doesn't flag it.
    const heavy = cfg().tiers[2].cooking;
    expect(snapshotKey(snap({ template: tpl({ on: true }), suggestion: heavy }))).toBe(snapshotKey(snap({ template: tpl({ on: false }), suggestion: heavy })));
    // A label published before cookingTiers existed still matches.
    const old = snap({ template: tpl({ on: false }) });
    const { cookingTiers: _t, ...oldTemplate } = old.template;
    expect(snapshotKey({ ...old, template: oldTemplate as LabelTemplate })).toBe(snapshotKey(old));
  });
});

// ── What's in a calzone ───────────────────────────────────────────────────

describe("composition", () => {
  const subs = new Map<number, SubRecipeMakeup>([
    // A dough: 62% dough-category (flour, yeast), the rest water/oil/salt.
    [1, { ingredients: [{ category: "dough", grams: 20015 }, { category: "other", grams: 12295 }, { category: "spice", grams: 450 }], components: [] }],
    // A pie filling with a nested sauce sub-recipe.
    [2, { ingredients: [{ category: "raw_meat", grams: 600 }, { category: "vegetable", grams: 200 }], components: [{ subRecipeId: 3, grams: 200 }] }],
    [3, { ingredients: [{ category: "dairy", grams: 100 }, { category: "other", grams: 100 }], components: [{ subRecipeId: 2, grams: 50 }] }], // cycle back to 2
  ]);

  it("shares through nested sub-recipes, and a cycle stops", () => {
    const mix = subRecipeMix(2, subs);
    expect(mix.raw_meat).toBeCloseTo(0.6, 2);
    expect(mix.vegetable).toBeCloseTo(0.2, 2);
    expect(mix.dairy).toBeCloseTo(0.1, 2);
  });

  it("a mostly-dough component is the dough; the rest is filling by class", () => {
    const p = cookingProfile([
      { grams: 115, mix: subRecipeMix(1, subs) },
      { grams: 100, mix: subRecipeMix(2, subs) },
      { grams: 40, mix: { cheese: 1 } },
      { grams: 5, mix: { "": 1 } },
    ], DEFAULT_COOKING_TIERS.categories);
    expect(p).toEqual({ totalG: 260, doughG: 115, fillingG: 145, meatG: 60, vegG: 20, cheeseG: 50 });
  });

  it("categories are data: moving one changes the class", () => {
    const cats = { ...DEFAULT_COOKING_TIERS.categories, cheese: ["cheese", "dairy", "base"] };
    expect(cookingProfile([{ grams: 80, mix: { base: 1 } }], cats).cheeseG).toBe(80);
    expect(cookingProfile([{ grams: 80, mix: { base: 1 } }], DEFAULT_COOKING_TIERS.categories).cheeseG).toBe(0);
  });
});
