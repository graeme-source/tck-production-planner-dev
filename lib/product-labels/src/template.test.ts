import { describe, it, expect } from "vitest";
import { allowedWidths, DEFAULT_TEMPLATE, dividerDots, normaliseTemplate } from "./template";

const stored = (fields: Record<string, unknown>, page: Record<string, unknown> = {}) =>
  normaliseTemplate({ ...DEFAULT_TEMPLATE, page: { ...DEFAULT_TEMPLATE.page, ...page }, fields: { ...DEFAULT_TEMPLATE.fields, ...fields } });

describe("narrowest width (replaces allowNarrower)", () => {
  it("an old template's allowNarrower: true reads as 'down to Condensed' — what it did", () => {
    const t = stored({ ingredients: { width: "normal", allowNarrower: true, minPt: 6.75, maxPt: 10 } });
    expect(t.fields.ingredients.narrowest).toBe("condensed");
    expect(allowedWidths(t.fields.ingredients)).toEqual(["normal", "semi-condensed", "condensed"]);
  });

  it("allowNarrower: false reads as 'never narrower than the preferred width'", () => {
    const t = stored({ storage: { width: "semi-condensed", allowNarrower: false } });
    expect(t.fields.storage.narrowest).toBe("semi-condensed");
    expect(allowedWidths(t.fields.storage)).toEqual(["semi-condensed"]);
  });

  it("a saved narrowest wins over a leftover allowNarrower", () => {
    const t = stored({ dates: { width: "normal", narrowest: "semi-condensed", allowNarrower: true } });
    expect(t.fields.dates.narrowest).toBe("semi-condensed");
  });

  it("neither saved: the new default (body text Semi Condensed, title Condensed)", () => {
    const t = normaliseTemplate({ fields: { ingredients: { width: "normal" }, title: {} } });
    expect(t.fields.ingredients.narrowest).toBe("semi-condensed");
    expect(t.fields.title.narrowest).toBe("condensed");
    expect(t.fields.headings.narrowest).toBe("normal");
  });

  it("a narrowest wider than the preferred width is raised to the preferred width", () => {
    const t = stored({ address: { width: "condensed", narrowest: "normal" } });
    expect(t.fields.address.narrowest).toBe("condensed");
    expect(allowedWidths(t.fields.address)).toEqual(["condensed"]);
  });

  it("nonsense is ignored", () => {
    const t = stored({ address: { width: "normal", narrowest: "ultra-thin" } });
    expect(t.fields.address.narrowest).toBe(DEFAULT_TEMPLATE.fields.address.narrowest);
  });

  it("the normalised template has no allowNarrower left in it", () => {
    const t = stored({ ingredients: { allowNarrower: true } });
    expect("allowNarrower" in t.fields.ingredients).toBe(false);
  });
});

describe("step-number circle size", () => {
  it("defaults to auto (as tall as the step text); older templates get auto too", () => {
    expect(normaliseTemplate({}).page.stepCircleAuto).toBe(true);
    const { stepCircleAuto: _a, ...oldPage } = DEFAULT_TEMPLATE.page;
    const t = normaliseTemplate({ ...DEFAULT_TEMPLATE, page: { ...oldPage, stepCircleMm: 5.5 } });
    expect(t.page.stepCircleAuto).toBe(true);
    expect(t.page.stepCircleMm).toBe(5.5); // kept for when auto is switched off
  });
  it("can be switched to a fixed size", () => {
    expect(normaliseTemplate({ page: { stepCircleAuto: false } }).page.stepCircleAuto).toBe(false);
  });
});

describe("divider rule settings", () => {
  it("defaults on, 0.25 mm — two dots at 203 dpi", () => {
    const t = normaliseTemplate({});
    expect(t.page.dividerOn).toBe(true);
    expect(t.page.dividerMm).toBe(0.25);
    expect(dividerDots(t.page)).toBe(2);
  });

  it("an older stored template (no divider keys) gets the defaults", () => {
    const { dividerOn: _o, dividerMm: _m, ...oldPage } = DEFAULT_TEMPLATE.page;
    const t = normaliseTemplate({ ...DEFAULT_TEMPLATE, page: oldPage });
    expect(t.page.dividerOn).toBe(true);
    expect(t.page.dividerMm).toBe(0.25);
  });

  it("can be switched off, and its thickness is clamped", () => {
    expect(normaliseTemplate({ page: { dividerOn: false } }).page.dividerOn).toBe(false);
    expect(normaliseTemplate({ page: { dividerMm: 0 } }).page.dividerMm).toBe(0.05);
    expect(normaliseTemplate({ page: { dividerMm: 9 } }).page.dividerMm).toBe(2);
  });

  it("thickness is whole printer dots, never under one", () => {
    expect(dividerDots({ dividerMm: 0.05, dpi: 203 })).toBe(1);
    expect(dividerDots({ dividerMm: 0.25, dpi: 300 })).toBe(3);
    expect(dividerDots({ dividerMm: 0.5, dpi: 203 })).toBe(4);
  });
});

describe("readability defaults (2026-10-12)", () => {
  it("body text a touch smaller with more space between blocks", () => {
    const f = DEFAULT_TEMPLATE.fields;
    expect(f.steps.maxPt).toBeLessThanOrEqual(10.5);
    for (const k of ["storage", "ingredients", "allergenInfo", "headings"] as const) expect(f[k].maxPt).toBeLessThanOrEqual(9);
    expect(f.dates.maxPt).toBeLessThanOrEqual(10);
    expect(DEFAULT_TEMPLATE.page.bandGapMm).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_TEMPLATE.page.fieldGapMm).toBeGreaterThanOrEqual(3);
  });
});
