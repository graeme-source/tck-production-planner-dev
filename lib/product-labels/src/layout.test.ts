import { describe, it, expect } from "vitest";
import type { LabelContent } from "./content";
import { enforceLegalMinimums, layoutLabel, type Face, type TextMeasurer } from "./layout";
import { DEFAULT_TEMPLATE, normaliseTemplate, type LabelTemplate } from "./template";
import { parseBold } from "./text";

// A predictable "font": every character is 0.5 em wide (bold 0.55), Semi
// Condensed 85% of that, Condensed 70%. x-height 0.5 em → legal minimum 7 pt.
const WIDTH_FACTOR = { normal: 1, "semi-condensed": 0.85, condensed: 0.7 } as const;
const advance = (text: string, f: Face, size: number, ls: number) =>
  [...text].length * ((f.weight === 700 ? 0.55 : 0.5) * WIDTH_FACTOR[f.width] + ls) * size;
const fake: TextMeasurer = {
  advance,
  metrics: () => ({ ascender: 0.8, descender: 0.2, xHeight: 0.5, capHeight: 0.7 }),
  missingGlyphs: () => [],
  ink: (text, f, size, ls) => (text.trim() ? { left: 0, right: advance(text, f, size, ls), top: 0.75 * size, bottom: 0.2 * size } : { left: 0, right: 0, top: 0, bottom: 0 }),
};

function content(deck: string): LabelContent {
  return {
    title: [parseBold("TEST - 2 PACK")],
    subtitle: [],
    steps: [[parseBold("One.")], [parseBold("Two.")], [parseBold("Three.")]],
    storageHeading: [],
    ingredientsHeading: [],
    storage: [parseBold("Keep cold.")],
    dates: [parseBold("USE BY: 01/01/27")],
    storageBanner: null,
    netQuantity: [],
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
    // The first deck length that needs a smaller size went to the field's
    // narrowest width (Semi Condensed by default) first.
    let n = 50;
    let l = layoutLabel(template(), content(words(n)), fake);
    while (field(l, "ingredients").sizePt === DEFAULT_TEMPLATE.fields.ingredients.maxPt && n < 1000) {
      n += 10;
      l = layoutLabel(template(), content(words(n)), fake);
    }
    const f = field(l, "ingredients");
    expect(l.fits).toBe(true);
    expect(f.width).toBe("semi-condensed");
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
    expect(f.width).toBe("semi-condensed"); // the narrowest it's allowed
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
    const t = template(x => { x.fields.ingredients.narrowest = "normal"; });
    const l = layoutLabel(t, content(words(150)), fake);
    expect(field(l, "ingredients").width).toBe("normal");
  });

  it("body text never goes Condensed when its narrowest is Semi Condensed — it gets smaller instead", () => {
    // Every deck length from short to far too long: no body field is ever
    // drawn condensed (Graeme, 2026-10-12: condensed was hard to read).
    for (let n = 10; n <= 800; n += 30) {
      const l = layoutLabel(template(), content(words(n)), fake);
      for (const k of ["steps", "storage", "dates", "ingredients", "allergenInfo", "address"]) {
        const f = l.fields.find(x => x.key === k);
        if (f) expect(f.width, `${k} with ${n} words`).not.toBe("condensed");
        if (f) expect(f.runs.every(r => r.white || r.face.width !== "condensed"), `${k} runs`).toBe(true);
      }
    }
  });

  it("a field allowed down to Condensed still goes Condensed before smaller", () => {
    const t = template(x => { x.fields.ingredients.narrowest = "condensed"; });
    let n = 50;
    let l = layoutLabel(t, content(words(n)), fake);
    while (field(l, "ingredients").sizePt === t.fields.ingredients.maxPt && n < 1000) {
      n += 10;
      l = layoutLabel(t, content(words(n)), fake);
    }
    expect(field(l, "ingredients").width).toBe("condensed");
  });

  it("the title may still go Condensed by default", () => {
    const c = content("x");
    c.title = [parseBold("A VERY LONG RECIPE NAME THAT NEEDS SQUEEZING HARD - 2 PACK")];
    const t = template(x => { x.fields.title.minPt = x.fields.title.maxPt; });
    expect(field(layoutLabel(t, c, fake), "title").width).toBe("condensed");
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

  it("saving a template raises a minimum set below the legal line", () => {
    const t = template(x => { x.fields.address.minPt = 5; x.fields.address.maxPt = 5; x.fields.title.minPt = 9; });
    const { template: fixed, raised } = enforceLegalMinimums(t, fake);
    expect(raised).toContain("address");
    expect(raised).not.toContain("title");
    expect(fixed.fields.address.minPt).toBe(7);
    expect(fixed.fields.address.maxPt).toBe(7);
    expect(fixed.fields.title.minPt).toBe(9);
  });

  it("the steps all use one size", () => {
    const c = content("x");
    c.steps = [[parseBold(words(40))], [parseBold("Short.")], [parseBold("Short.")]];
    const steps = field(layoutLabel(template(), c, fake), "steps");
    const sizes = new Set(steps.runs.filter(r => !r.white).map(r => r.sizeDots));
    expect(sizes.size).toBe(1);
  });
});

describe("divider rule", () => {
  it("is drawn by default: full inner width, whole dots, between the steps and the columns", () => {
    const t = template();
    const l = layoutLabel(t, content(words(40)), fake);
    const d = l.divider!;
    expect(d).toBeTruthy();
    expect(d.h).toBe(2); // 0.25 mm at 203 dpi
    for (const v of [d.x, d.y, d.w, d.h]) expect(Number.isInteger(v)).toBe(true);
    expect(d.x).toBe(Math.round(l.columns.left.x));
    expect(d.x + d.w).toBe(Math.round(l.columns.right.x + l.columns.right.w));
    // Below every step's ink, above both columns.
    const steps = field(l, "steps");
    expect(d.y).toBeGreaterThanOrEqual(steps.boxes[0].y + steps.usedHeight);
    expect(d.y + d.h).toBeLessThanOrEqual(l.columns.left.y);
  });

  it("sits in the middle of the white space, with room either side", () => {
    const l = layoutLabel(template(), content(words(40)), fake);
    const d = l.divider!;
    const steps = field(l, "steps");
    const above = d.y - (steps.boxes[0].y + Math.max(steps.usedHeight, l.circles[0].r * 2));
    const below = l.columns.left.y - (d.y + d.h);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1.5);
    expect(below).toBeGreaterThan(8); // > 1 mm clear at 203 dpi
  });

  it("is absent when switched off, and the layout is otherwise unchanged", () => {
    const on = layoutLabel(template(), content(words(40)), fake);
    const off = layoutLabel(template(x => { x.page.dividerOn = false; }), content(words(40)), fake);
    expect(off.divider).toBeNull();
    expect(off.columns).toEqual(on.columns);
  });

  it("thickness follows the setting in whole dots, at least one", () => {
    expect(layoutLabel(template(x => { x.page.dividerMm = 0.05; }), content("x"), fake).divider!.h).toBe(1);
    expect(layoutLabel(template(x => { x.page.dividerMm = 0.5; }), content("x"), fake).divider!.h).toBe(4);
  });
});

describe("stacked fields shrink biggest first", () => {
  it("a bigger deck squeezes down to the allergen note's size before the note shrinks", () => {
    const t = template(x => { x.fields.ingredients.maxPt = 11; x.fields.allergenInfo.maxPt = 9; });
    let saw = false;
    for (let n = 20; n <= 400; n += 10) {
      const c = content(words(n));
      c.allergenInfo = [parseBold("Allergens are shown in **Bold**.")];
      const l = layoutLabel(t, c, fake);
      const ing = field(l, "ingredients");
      const note = field(l, "allergenInfo");
      if (ing.sizePt > 9) {
        expect(note.sizePt).toBe(9);
        expect(note.width).toBe("normal"); // untouched until the ceiling reaches it
        if (ing.sizePt < 11) saw = true;
      } else {
        expect(note.sizePt).toBeLessThanOrEqual(ing.sizePt + 1e-9);
      }
    }
    expect(saw).toBe(true);
  });
});
