import { describe, it, expect } from "vitest";
import { allowedWidths, DEFAULT_TEMPLATE, normaliseTemplate } from "./template";

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

