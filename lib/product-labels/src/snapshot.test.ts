import { describe, it, expect } from "vitest";
import {
  areasForChange, buildSnapshot, canonicalJson, DEFAULT_RECIPE_LABEL_SETTINGS, diffSnapshots, formatPackSize, snapshotKey, snapshotsMatch,
  type RecipeLabelSettings,
} from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate, type LabelTemplate } from "./template";

const tpl = (): LabelTemplate => normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
const make = (o: { deck?: string; name?: string; settings?: Partial<RecipeLabelSettings>; template?: LabelTemplate; shelf?: number | null } = {}) =>
  buildSnapshot({
    recipe: { name: o.name ?? "Chicken and Chorizo", packSize: "2.0000", shelfLifeDays: o.shelf === undefined ? 13 : o.shelf },
    deck: { deckText: o.deck ?? "Chicken (40%), **Wheat** Flour", mayContainStatement: "May also contain traces of nuts" },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206009", ...o.settings },
    templateId: 1,
    template: o.template ?? tpl(),
  });

describe("canonicalJson", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe("snapshot change detection", () => {
  it("identical inputs match", () => {
    expect(snapshotsMatch(make(), make())).toBe(true);
    expect(diffSnapshots(make(), make())).toEqual([]);
  });

  it("a deck change (e.g. a weight that re-orders the ingredients) is listed", () => {
    const live = make();
    const now = make({ deck: "**Wheat** Flour, Chicken (35%)" });
    expect(snapshotsMatch(live, now)).toBe(false);
    const d = diffSnapshots(live, now);
    expect(d.map(c => c.key)).toEqual(["deckText"]);
    expect(d[0].label).toBe("Ingredients");
  });

  it("reverting the change clears the flag by itself", () => {
    const live = make();
    const changed = make({ deck: "Chicken (50%), **Wheat** Flour" });
    expect(snapshotsMatch(live, changed)).toBe(false);
    const reverted = make({ deck: "Chicken (40%), **Wheat** Flour" });
    expect(snapshotsMatch(live, reverted)).toBe(true);
    expect(snapshotKey(live)).toBe(snapshotKey(reverted));
  });

  it("lists cooking, barcode and use-by changes field by field", () => {
    const now = make({ settings: { cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenMaxMinutes: 25 }, barcode: "4006381333931", chilled: { amount: 10, unit: "days" } } });
    const keys = diffSnapshots(make(), now).map(c => c.key);
    expect(keys).toEqual(["cooking.ovenMaxMinutes", "chilled", "barcode"]);
  });

  it("template wording and typography changes flag the label", () => {
    const t = tpl();
    t.text.address = "Somewhere else";
    t.fields.ingredients.maxPt = 12;
    const keys = diffSnapshots(make(), make({ template: t })).map(c => c.key);
    expect(keys).toEqual(["template.text.address", "template.fields.ingredients"]);
  });

  it("a template cooking default this recipe overrides doesn't flag it", () => {
    const t = tpl();
    t.cooking.ovenTempC = 200;
    const own = { cooking: { ...DEFAULT_RECIPE_LABEL_SETTINGS.cooking, ovenTempC: 210 } };
    expect(snapshotsMatch(make({ settings: own }), make({ settings: own, template: t }))).toBe(true);
    // …but one it inherits does, and says what printed value changed
    const d = diffSnapshots(make(), make({ template: t }));
    expect(d.map(c => c.key)).toEqual(["cooking.ovenTempC"]);
    expect(d[0]).toMatchObject({ before: "210", after: "200" });
  });

  it("renaming the recipe doesn't touch a label with its own name", () => {
    const own = { labelName: "Chicken & Chorizo" };
    expect(snapshotsMatch(make({ settings: own }), make({ settings: own, name: "Chicken & Chorizo v2" }))).toBe(true);
    expect(snapshotsMatch(make(), make({ name: "Chicken & Chorizo v2" }))).toBe(false);
  });

  it("switching the air fryer off blanks its values", () => {
    const s = make({ settings: { airFryerOn: false } });
    expect(s.cooking.airFryerTempC).toBeNull();
    expect(s.cooking.ovenTempC).toBe(210);
  });

  it("chilled use-by: recipe shelf life, else the 13-day standard; frozen to the template", () => {
    const s = make();
    expect(s.chilled).toEqual({ amount: 13, unit: "days" });
    expect(s.frozen).toEqual({ amount: 6, unit: "months" });
    expect(make({ settings: { frozenOn: false } }).frozen).toBeNull();
    // No shelf life on the recipe → the template's standard 13 days.
    expect(make({ shelf: null }).chilled).toEqual({ amount: 13, unit: "days" });
  });
});

describe("areasForChange", () => {
  it("points each change at the part of the label it shows up in", () => {
    expect(areasForChange("deckText")).toEqual(["ingredients"]);
    expect(areasForChange("cooking.airFryerTempC")).toEqual(["steps"]);
    expect(areasForChange("template.text.step2")).toEqual(["steps"]);
    expect(areasForChange("template.fields.address")).toEqual(["address"]);
    expect(areasForChange("barcode")).toEqual(["barcode"]);
    expect(areasForChange("template.page")).toEqual(["all"]);
  });
});

describe("formatPackSize", () => {
  it("drops trailing zeros", () => {
    expect(formatPackSize("2.0000")).toBe("2");
    expect(formatPackSize("1.5000")).toBe("1.5");
  });
});
