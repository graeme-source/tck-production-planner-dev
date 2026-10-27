import { describe, it, expect } from "vitest";
import { categoryDefaultTemplate, resolveTemplateChoice, type TemplateCategoryDefaults } from "./template-choice";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS, snapshotKey } from "./snapshot";
import { DEFAULT_TEMPLATE, macaroniCheeseTemplate, normaliseTemplate, TEMPLATE_PRESETS } from "./template";

const templates: TemplateCategoryDefaults[] = [
  { id: 1, name: "Standard calzone label", defaultForCategories: [] },
  { id: 2, name: "Fried chicken", defaultForCategories: [] },
  { id: 3, name: "Macaroni cheese", defaultForCategories: ["Macaroni Cheese"] },
];

describe("which template a recipe uses (regression: a new mac cheese got the calzone label)", () => {
  it("a recipe in a template's default category, with none picked, gets that template", () => {
    expect(resolveTemplateChoice(null, "Macaroni Cheese", templates)).toEqual({ id: 3, reason: "category" });
    expect(resolveTemplateChoice(undefined, "  macaroni   cheese ", templates)).toEqual({ id: 3, reason: "category" });
  });
  it("a picked template always wins, even the standard one", () => {
    expect(resolveTemplateChoice(2, "Macaroni Cheese", templates)).toEqual({ id: 2, reason: "chosen" });
    expect(resolveTemplateChoice(1, "Macaroni Cheese", templates)).toEqual({ id: 1, reason: "chosen" });
  });
  it("other categories, and none, keep the standard template", () => {
    expect(resolveTemplateChoice(null, "Calzones", templates)).toEqual({ id: null, reason: "standard" });
    expect(resolveTemplateChoice(null, null, templates)).toEqual({ id: null, reason: "standard" });
    expect(resolveTemplateChoice(null, "", templates)).toEqual({ id: null, reason: "standard" });
  });
  it("a picked id that no longer exists falls back to the category default", () => {
    expect(resolveTemplateChoice(99, "Macaroni Cheese", templates)).toEqual({ id: 3, reason: "category" });
  });
  it("two templates claiming one category: the lowest id wins", () => {
    const t = [...templates, { id: 4, name: "Mac v2", defaultForCategories: ["macaroni cheese"] }].reverse();
    expect(categoryDefaultTemplate("Macaroni Cheese", t)!.id).toBe(3);
  });
});

describe("defaultForCategories on the template", () => {
  it("is empty on the standard template and older templates, cleaned when read", () => {
    expect(normaliseTemplate({}).defaultForCategories).toEqual([]);
    expect(normaliseTemplate(DEFAULT_TEMPLATE).defaultForCategories).toEqual([]);
    expect(normaliseTemplate({ defaultForCategories: [" Desserts ", "desserts", "", 4] }).defaultForCategories).toEqual(["Desserts"]);
  });
  it("the Macaroni cheese preset claims the Macaroni Cheese category; the standard one claims none", () => {
    expect(macaroniCheeseTemplate().defaultForCategories).toEqual(["Macaroni Cheese"]);
    expect(TEMPLATE_PRESETS.find(p => p.key === "standard")!.build().defaultForCategories).toEqual([]);
  });
  it("changing it never flags a live label (it doesn't change what prints)", () => {
    const snap = (defaultForCategories: string[]) => buildSnapshot({
      recipe: { name: "X", packSize: "2", shelfLifeDays: 8 },
      deck: { deckText: "Water", mayContainStatement: null },
      settings: DEFAULT_RECIPE_LABEL_SETTINGS,
      templateId: 3,
      template: { ...macaroniCheeseTemplate(), defaultForCategories },
    });
    expect(snapshotKey(snap([]))).toBe(snapshotKey(snap(["Macaroni Cheese"])));
    // A label published before the setting existed still matches.
    const { defaultForCategories: _d, ...old } = macaroniCheeseTemplate();
    expect(snapshotKey({ ...snap([]), template: old as never })).toBe(snapshotKey(snap(["Macaroni Cheese"])));
  });
});
