import { describe, it, expect } from "vitest";
import { findBoneRisk } from "./bones";
import { DEFAULT_TEMPLATE, friedChickenTemplate, normaliseTemplate, TEMPLATE_PRESETS } from "./template";

describe("template presets", () => {
  it("have unique keys and names; the standard one is the default template", () => {
    expect(new Set(TEMPLATE_PRESETS.map(p => p.key)).size).toBe(TEMPLATE_PRESETS.length);
    expect(new Set(TEMPLATE_PRESETS.map(p => p.name.toLowerCase())).size).toBe(TEMPLATE_PRESETS.length);
    expect(TEMPLATE_PRESETS.find(p => p.key === "standard")!.build()).toEqual(normaliseTemplate(DEFAULT_TEMPLATE));
  });

  it("each builds a template that survives saving unchanged (normaliseTemplate round trip)", () => {
    for (const p of TEMPLATE_PRESETS) {
      const t = p.build();
      expect(normaliseTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    }
  });
});

describe("fried chicken template (provisional)", () => {
  const t = friedChickenTemplate();
  it("has no wooden-tray step — one placeholder step until the instructions are agreed", () => {
    expect(t.text.steps).toEqual(["Cooking instructions to be confirmed."]);
    expect(t.text.steps.join(" ").toLowerCase()).not.toContain("tray");
  });
  it("lets the ingredients go down to Condensed; everything else as the standard", () => {
    expect(t.fields.ingredients.narrowest).toBe("condensed");
    expect(t.fields.storage).toEqual(DEFAULT_TEMPLATE.fields.storage);
    expect(t.page).toEqual(normaliseTemplate(DEFAULT_TEMPLATE).page);
  });
  it("titles by name only, and its bones words catch chicken", () => {
    expect(t.text.title).toBe("{name}");
    expect(findBoneRisk("Buttermilk Fried Chicken Strip (Chicken Breast)", t.boneRiskWords)).not.toBeNull();
  });
  it("building it never changes the standard template", () => {
    friedChickenTemplate();
    expect(DEFAULT_TEMPLATE.text.steps).toHaveLength(2);
    expect(DEFAULT_TEMPLATE.fields.ingredients.narrowest).toBe("semi-condensed");
  });
});
