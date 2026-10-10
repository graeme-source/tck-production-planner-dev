import { describe, it, expect } from "vitest";
import type { LabelContent } from "./content";
import { layoutLabel, type Face, type TextMeasurer } from "./layout";
import { DEFAULT_TEMPLATE, normaliseTemplate, type LabelTemplate } from "./template";
import { parseBold } from "./text";

// A predictable "font": every character is 0.5 em wide (bold 0.55), Semi
// Condensed 85% of that, Condensed 70%. x-height 0.5 em → legal minimum 7 pt.
const WIDTH_FACTOR = { normal: 1, "semi-condensed": 0.85, condensed: 0.7 } as const;
const fake: TextMeasurer = {
  advance: (text: string, f: Face, size: number, ls: number) =>
    [...text].length * ((f.weight === 700 ? 0.55 : 0.5) * WIDTH_FACTOR[f.width] + ls) * size,
  metrics: () => ({ ascender: 0.8, descender: 0.2, xHeight: 0.5, capHeight: 0.7 }),
  missingGlyphs: () => [],
};

function content(deck: string): LabelContent {
  return {
    title: [parseBold("TEST - 2 PACK")],
    steps: [[parseBold("One.")], [parseBold("Two.")], [parseBold("Three.")]],
    storage: [parseBold("Keep cold.")],
    dates: [parseBold("USE BY: 01/01/27")],
    ingredients: [parseBold(deck)],
    allergenInfo: [],
    address: [],
    barcode: null,
    problems: [],
  };
}

function template(over: (t: LabelTemplate) => void = () => {}): LabelTemplate {
  const t = normaliseTemplate(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  over(t);
  return t;
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 10}`).join(" ");
const field = (l: ReturnType<typeof layoutLabel>, k: string) => l.fields.find(f => f.key === k)!;

describe("layout fitting", () => {
  it("a short deck fits at the maximum size in the preferred width", () => {
    const l = layoutLabel(template(), content(words(10)), fake);
    const f = field(l, "ingredients");
    expect(l.fits).toBe(true);
    expect(f.sizePt).toBe(DEFAULT_TEMPLATE.fields.ingredients.maxPt);
    expect(f.width).toBe("normal");
  });

  it("tries a narrower width BEFORE a smaller size", () => {
    // Find a deck that overflows normal-width at max but fits semi-condensed at max.
    let found = false;
    for (let n = 20; n < 400 && !found; n += 5) {
      const l = layoutLabel(template(), content(words(n)), fake);
      const f = field(l, "ingredients");
      if (f.width !== "normal") {
        expect(f.width).toBe("semi-condensed");
        expect(f.sizePt).toBe(DEFAULT_TEMPLATE.fields.ingredients.maxPt);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("shrinks once the narrowest width at that size doesn't fit", () => {
    const l = layoutLabel(template(), content(words(110)), fake);
    const f = field(l, "ingredients");
    expect(l.fits).toBe(true);
    expect(f.width).toBe("condensed");
    expect(f.sizePt).toBeLessThan(DEFAULT_TEMPLATE.fields.ingredients.maxPt);
    expect(f.sizePt).toBeGreaterThanOrEqual(7);
  });

  it("DOESN'T FIT at the minimum: says which field and by how much, and keeps every word", () => {
    const deck = words(800);
    const l = layoutLabel(template(), content(deck), fake);
    expect(l.fits).toBe(false);
    const p = l.problems.find(x => x.field === "ingredients");
    expect(p).toBeTruthy();
    expect(p!.overflowMm).toBeGreaterThan(0);
    const f = field(l, "ingredients");
    expect(f.sizePt).toBe(7); // legal minimum for x-height 0.5
    expect(f.width).toBe("condensed");
    // never truncated: every deck word is placed somewhere
    const placed = f.runs.map(r => r.text).filter(t => t.startsWith("word"));
    expect(placed).toHaveLength(800);
  });

  it("never goes below the legal x-height minimum, even when the template asks", () => {
    const t = template(x => { x.fields.ingredients.minPt = 4; });
    const l = layoutLabel(t, content(words(800)), fake);
    expect(field(l, "ingredients").sizePt).toBe(7);
    expect(field(l, "ingredients").legalMinPt).toBe(7);
  });

  it("small packs (under 80 cm²) allow the 0.9 mm minimum", () => {
    const t = template(x => { x.page.smallPack = true; x.fields.ingredients.minPt = 4; });
    const l = layoutLabel(t, content(words(800)), fake);
    expect(field(l, "ingredients").sizePt).toBe(5.25);
  });

  it("keeps the preferred width when narrower widths are switched off", () => {
    const t = template(x => { x.fields.ingredients.allowNarrower = false; });
    const l = layoutLabel(t, content(words(150)), fake);
    expect(field(l, "ingredients").width).toBe("normal");
  });

  it("a word too wide for its box is a problem, not a cut", () => {
    const l = layoutLabel(template(), content("Supercalifragilisticexpialidocious".repeat(4)), fake);
    expect(l.fits).toBe(false);
    expect(l.problems.some(p => p.field === "ingredients" && p.message.includes("too wide"))).toBe(true);
  });

  it("stacked fields share the column: a long address squeezes the deck", () => {
    const c = content(words(60));
    const alone = field(layoutLabel(template(), c, fake), "ingredients").sizePt;
    c.address = [parseBold(words(80))];
    const squeezed = layoutLabel(template(), c, fake);
    const ing = field(squeezed, "ingredients");
    expect(ing.width !== "normal" || ing.sizePt < alone).toBe(true);
  });

  it("the steps all use one size", () => {
    const c = content("x");
    c.steps = [[parseBold(words(40))], [parseBold("Short.")], [parseBold("Short.")]];
    const steps = field(layoutLabel(template(), c, fake), "steps");
    const sizes = new Set(steps.runs.filter(r => !r.white).map(r => r.sizeDots));
    expect(sizes.size).toBe(1);
  });
});
