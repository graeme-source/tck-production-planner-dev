import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { loadBundledFonts } from "./node-fonts";
import { encodePng, proofLabel, renderLabel } from "./render";
import { Bitmap, fillContours, fillRect } from "./raster";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS } from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate, type LabelTemplate } from "./template";
import { dotsToMm, mmToDots } from "@workspace/units";
import { encodeEan13, isGuardModule } from "./ean13";
import { legalMinPt } from "./legal";
import { layoutLabel } from "./layout";
import { buildLabelContent } from "./content";
import { labelDates } from "./dates";

const fonts = loadBundledFonts();

const DECK =
  "Fortified **Wheat** Flour (**Wheat** Flour, Calcium Carbonate, Iron, Niacin, Thiamin), Cooked Chicken (22%) (Chicken, Salt), " +
  "Water, Mozzarella Cheese (**Milk**), Chorizo (12%) (Pork, Paprika, Salt, Garlic, Dextrose, Oregano, Antioxidant: Sodium Ascorbate, " +
  "Preservative: Sodium Nitrite), Tomato Passata, Red Onion, Rapeseed Oil, Yeast, Sugar, Salt, Basil, Oregano.";

function snapshot(deck = DECK) {
  return buildSnapshot({
    recipe: { name: "Chicken & Chorizo", packSize: "2.0000", shelfLifeDays: 13 },
    deck: { deckText: deck, mayContainStatement: "May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk" },
    settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "5065018206009" },
    templateId: 1,
    template: normaliseTemplate(DEFAULT_TEMPLATE),
  });
}

describe("bundled fonts", () => {
  it("loads all nine faces and reads Barlow's real x-height (0.506 em → 6.75 pt minimum)", () => {
    const m = fonts.metrics({ width: "normal", weight: 400 });
    expect(m.xHeight).toBeCloseTo(0.506, 3);
    expect(legalMinPt(m.xHeight, false)).toBe(6.75);
    expect(fonts.metrics({ width: "condensed", weight: 400 }).xHeight).toBeCloseTo(0.506, 3);
  });

  it("condensed widths really are narrower", () => {
    const t = "Fortified Wheat Flour (Calcium Carbonate)";
    const n = fonts.advance(t, { width: "normal", weight: 400 }, 100, 0);
    const s = fonts.advance(t, { width: "semi-condensed", weight: 400 }, 100, 0);
    const c = fonts.advance(t, { width: "condensed", weight: 400 }, 100, 0);
    expect(s).toBeLessThan(n);
    expect(c).toBeLessThan(s);
  });

  it("letter spacing adds exactly spacing × size per character", () => {
    const f = { width: "normal" as const, weight: 400 as const };
    expect(fonts.advance("abcd", f, 50, 0.1) - fonts.advance("abcd", f, 50, 0)).toBeCloseTo(4 * 0.1 * 50, 6);
  });

  it("knows the degree sign and en dash, and reports characters it can't draw", () => {
    const f = { width: "normal" as const, weight: 400 as const };
    expect(fonts.missingGlyphs("210°C 18–22", f)).toEqual([]);
    expect(fonts.missingGlyphs("snow ☃", f)).toEqual(["☃"]);
  });
});

describe("measure = draw", () => {
  it("a run's ink stays inside the width the layout measured for it", () => {
    const f = { width: "normal" as const, weight: 700 as const };
    const text = "WHEAT MILK Allergens";
    const size = 40;
    const bm = new Bitmap(800, 80);
    const shaped = fonts.shapeText(text, f, size, 0);
    for (const g of shaped.glyphs) fillContours(bm, flattenOf(g.glyph, 10 + g.x, 60, size));
    let minX = Infinity, maxX = -Infinity;
    for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) if (bm.get(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    expect(minX).toBeGreaterThanOrEqual(10);
    expect(maxX).toBeLessThanOrEqual(10 + fonts.advance(text, f, size, 0) + 1);
    // and the measured width is the advance the drawing used
    expect(shaped.advance).toBe(fonts.advance(text, f, size, 0));
  });
});

function flattenOf(glyph: Parameters<typeof fonts.glyphPath>[0], x: number, y: number, size: number) {
  // local import to keep the helper close to its use
  return flattenPathLocal(fonts.glyphPath(glyph, x, y, size));
}
import { flattenPath } from "./raster";
const flattenPathLocal = (cmds: unknown) => flattenPath(cmds as Parameters<typeof flattenPath>[0]);

describe("raster + PNG", () => {
  it("fills rectangles on whole dots", () => {
    const bm = new Bitmap(10, 4);
    fillRect(bm, 3, 0, 3, 4);
    expect(bm.blackCount()).toBe(12);
    expect(bm.get(2, 0)).toBe(0);
    expect(bm.get(3, 0)).toBe(1);
    expect(bm.get(6, 0)).toBe(0);
  });
  it("writes a valid 1-bit PNG", () => {
    const bm = new Bitmap(13, 3);
    fillRect(bm, 0, 0, 1, 1);
    const png = encodePng(bm);
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer);
    expect(dv.getUint32(16)).toBe(13);
    expect(dv.getUint32(20)).toBe(3);
    // IDAT inflates to (1 filter byte + 2 bytes) × 3 rows; first pixel black (bit 0)
    const idatLen = dv.getUint32(33);
    const raw = inflateSync(png.slice(41, 41 + idatLen));
    expect(raw.length).toBe(9);
    expect(raw[1] & 0x80).toBe(0);
    expect(raw[1] & 0x40).toBe(0x40);
  });
});

describe("the default template with a real deck", () => {
  it("lays out, fits and renders at 203 dpi on Graeme's 140 × 94 mm stock", () => {
    const proof = proofLabel(snapshot(), { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
    expect(proof.layout.problems).toEqual([]);
    expect(proof.layout.fits).toBe(true);
    expect(proof.content.problems).toEqual([]);
    expect(proof.bitmap.width).toBe(1119); // 140 mm at 203 dpi
    expect(proof.bitmap.height).toBe(751); // 94 mm
    expect(proof.bitmap.blackCount()).toBeGreaterThan(5000);
    expect(proof.png.startsWith("data:image/png;base64,")).toBe(true);
    for (const f of proof.layout.fields) expect(f.sizePt).toBeGreaterThanOrEqual(f.legalMinPt);
  });

  it("an impossibly long deck is DOESN'T FIT with every word still placed", () => {
    const long = Array.from({ length: 120 }, () => DECK).join(" ");
    const s = snapshot(long);
    const dates = labelDates({ printDate: "2026-10-10", productionDate: "2026-10-10", chilled: s.chilled, frozen: s.frozen, batchBasis: s.template.batchBasis });
    const layout = layoutLabel(s.template, buildLabelContent(s, dates), fonts);
    expect(layout.fits).toBe(false);
    const ing = layout.fields.find(f => f.key === "ingredients")!;
    // Every character of the deck is placed, in order (the heading is its own block).
    const placed = ing.runs.map(r => r.text).join("");
    const expected = long.replace(/\*\*/g, "").replace(/\s+/g, "");
    expect(placed).toBe(expected);
    // Renders anyway: the print-size bitmap, and a taller one showing the overflow.
    expect(renderLabel(layout, fonts).height).toBe(751);
    expect(renderLabel(layout, fonts, true).height).toBeGreaterThan(751);
    const proof = proofLabel(s, { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
    expect(proof.overflowPng).not.toBeNull();
  });
});

describe("nothing prints inside the margin", () => {
  // Graeme: ink near the edge gets cut off on his rounded labels. Every black
  // dot of a label that fits must sit inside the margin — short and long
  // decks, 203 and 300 dpi, a wider margin.
  const cases: Array<[string, (t: LabelTemplate) => void, string]> = [
    ["default 4.5 mm, real deck", () => {}, DECK],
    ["default, a long deck squeezed to fit", () => {}, `${DECK} ${DECK}`],
    ["300 dpi", t => { t.page.dpi = 300; }, DECK],
    ["6 mm margin", t => { t.page.marginMm = 6; }, DECK],
  ];
  for (const [name, tweak, deck] of cases) {
    it(name, () => {
      const t = normaliseTemplate(DEFAULT_TEMPLATE);
      tweak(t);
      const s = { ...snapshot(deck), template: t };
      const proof = proofLabel(s, { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
      expect(proof.layout.fits).toBe(true);
      const m = mmToDots(t.page.marginMm, t.page.dpi);
      const bm = proof.bitmap;
      let stray = 0;
      for (let y = 0; y < bm.height; y++) for (let x = 0; x < bm.width; x++) {
        if (!bm.get(x, y)) continue;
        const cx = x + 0.5, cy = y + 0.5;
        if (cx < m || cx > bm.width - m || cy < m || cy > bm.height - m) stray++;
      }
      expect(stray).toBe(0);
    });
  }
});

describe("barcode as printed", () => {
  const proof = proofLabel(snapshot(), { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
  const b = proof.layout.barcode;
  const bm = proof.bitmap;

  it("defaults to 151% → whole 4-dot modules, ~18.5 mm bars (wider, shorter)", () => {
    expect(b.module.ok).toBe(true);
    if (!b.module.ok) return;
    expect(b.module.moduleDots).toBe(4);
    expect(dotsToMm(b.barsBottom - b.barsTop, 203)).toBeCloseTo(18.5, 0);
  });

  it("bars are exact whole-dot modules, quiet zones clear, no digits over the bars", () => {
    if (!b.module.ok) throw new Error("no barcode");
    const md = b.module.moduleDots;
    const bars = encodeEan13("5065018206009");
    for (let y = b.barsTop; y < b.barsBottom; y++) {
      // 11 modules clear before, the 95 modules, 7 clear after.
      for (let x = b.x - 11 * md; x < b.x + (95 + 7) * md; x++) {
        const mod = Math.floor((x - b.x) / md);
        const want = x >= b.x && mod < 95 && bars[mod] ? 1 : 0;
        if (bm.get(x, y) !== want) throw new Error(`dot ${x},${y} is ${bm.get(x, y)}, expected ${want}`);
      }
    }
  });

  it("only the guard bars extend below; the digits sit underneath", () => {
    if (!b.module.ok) throw new Error("no barcode");
    const md = b.module.moduleDots;
    const bars = encodeEan13("5065018206009");
    // Below the bars, the guard columns are exactly the guard pattern (the
    // digits sit between the guards, never touching them)…
    for (let y = b.barsBottom; y < b.guardBottom; y++) {
      for (let x = b.x; x < b.x + 95 * md; x++) {
        const mod = Math.floor((x - b.x) / md);
        if (isGuardModule(mod) && bm.get(x, y) !== (bars[mod] ? 1 : 0)) throw new Error(`guard column wrong at ${x},${y} (module ${mod})`);
      }
    }
    // …and nothing at all is drawn between the end of the bars and the top
    // of the digits except the guard extensions.
    const firstDigitTop = Math.min(...b.digitRuns.map(r => r.y - fonts.ink(r.text, r.face, r.sizeDots, 0).top));
    for (let y = b.barsBottom; y < Math.floor(firstDigitTop) - 1; y++) {
      for (let x = b.x - 11 * md; x < b.x + 102 * md; x++) {
        const mod = Math.floor((x - b.x) / md);
        const guardInk = x >= b.x && mod < 95 && isGuardModule(mod) && bars[mod] && y < b.guardBottom;
        if (bm.get(x, y) && !guardInk) throw new Error(`stray ink at ${x},${y}`);
      }
    }
    expect(b.digitRuns).toHaveLength(13);
    for (const r of b.digitRuns) {
      const ink = fonts.ink(r.text, r.face, r.sizeDots, 0);
      expect(r.y - ink.top).toBeGreaterThan(b.barsBottom);
    }
  });
});

describe("the drawn arrow (Barlow's Latin set has none)", () => {
  const f = { width: "normal" as const, weight: 400 as const };
  it("isn't reported missing, and has a width and ink like a real glyph", () => {
    expect(fonts.missingGlyphs("9–11 min ➜ TURN OVER → 9–11", f)).toEqual([]);
    const adv = fonts.advance("➜", f, 100, 0);
    expect(adv).toBeGreaterThan(50);
    const ink = fonts.ink("➜", f, 100, 0);
    expect(ink.left).toBeGreaterThanOrEqual(0);
    expect(ink.right).toBeLessThanOrEqual(adv);
    expect(ink.top).toBeGreaterThan(0);
  });
  it("is drawn — and measured and drawn at the same place", () => {
    const bm = new Bitmap(200, 120);
    const shaped = fonts.shapeText("a➜b", f, 100, 0);
    for (const g of shaped.glyphs) fillContours(bm, flattenPathLocal(fonts.glyphPath(g.glyph, 10 + g.x, 100, 100)));
    // ink exists between where "a" ends and "b" starts
    const arrow = shaped.glyphs[1];
    let black = 0;
    for (let y = 0; y < 120; y++) for (let x = Math.ceil(10 + arrow.x); x < 10 + shaped.glyphs[2].x; x++) black += bm.get(x, y);
    expect(black).toBeGreaterThan(200);
  });
});

describe("steps: any number, widths worked out automatically", () => {
  const when = { printDate: "2026-10-10", productionDate: "2026-10-10" };
  const withSteps = (steps: string[]) => {
    const t = normaliseTemplate({ ...DEFAULT_TEMPLATE, text: { ...DEFAULT_TEMPLATE.text, steps } });
    return proofLabel({ ...snapshot(), template: t }, when, fonts);
  };
  it("default: two numbered steps, the cooking step wider, the first gets the rest", () => {
    const p = proofLabel(snapshot(), when, fonts);
    const steps = p.layout.fields.find(f => f.key === "steps")!;
    expect(steps.boxes).toHaveLength(2);
    expect(p.layout.circles).toHaveLength(2);
    expect(steps.runs.filter(r => r.white).map(r => r.text)).toEqual(["1", "2"]);
    expect(steps.boxes[1].w).toBeGreaterThan(steps.boxes[0].w);
    // The row is used edge to edge (inside the margins).
    const last = steps.boxes[steps.boxes.length - 1];
    expect(last.x + last.w).toBeCloseTo(p.layout.widthDots - mmToDots(DEFAULT_TEMPLATE.page.marginMm, 203), 0);
    expect(steps.sizePt).toBeGreaterThan(10); // bigger than when there were three
  });
  it("a third step added back still lays out, numbered 1–3; a blank one closes up", () => {
    const three = withSteps([...DEFAULT_TEMPLATE.text.steps, "Enjoy."]);
    expect(three.layout.circles).toHaveLength(3);
    expect(three.layout.fits).toBe(true);
    const gap = withSteps([DEFAULT_TEMPLATE.text.steps[0], "", DEFAULT_TEMPLATE.text.steps[1]]);
    const runs = gap.layout.fields.find(f => f.key === "steps")!.runs.filter(r => r.white).map(r => r.text);
    expect(runs).toEqual(["1", "2"]);
  });
  it("a label published under the old step1/step2/step3 template still renders (as it was, 3 steps)", () => {
    const { steps: _s, ...rest } = DEFAULT_TEMPLATE.text;
    const legacyTemplate = { ...DEFAULT_TEMPLATE, text: { ...rest, step1: "A.", step2: DEFAULT_TEMPLATE.text.steps[1], step3: "Check they're piping hot throughout before serving." } };
    const p = proofLabel({ ...snapshot(), template: legacyTemplate as unknown as LabelTemplate }, when, fonts);
    expect(p.layout.circles).toHaveLength(3);
  });
  it("no steps at all draws no circles", () => {
    expect(withSteps([]).layout.circles).toHaveLength(0);
  });
});

describe("the cooking step on the default label", () => {
  it("prints as exactly two lines, one per appliance, in its wider box", () => {
    const proof = proofLabel(snapshot(), { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
    const steps = proof.layout.fields.find(f => f.key === "steps")!;
    const box2 = steps.boxes[1];
    expect(box2.w).toBeGreaterThan(steps.boxes[0].w);
    const runs2 = steps.runs.filter(r => !r.white && r.x >= box2.x && r.x < box2.x + box2.w);
    expect(new Set(runs2.map(r => Math.round(r.y))).size).toBe(2);
    expect(steps.sizePt).toBeGreaterThanOrEqual(steps.legalMinPt);
  });
});

describe("section headings", () => {
  const when = { printDate: "2026-10-10", productionDate: "2026-10-10" };
  const headingRuns = (p: ReturnType<typeof proofLabel>) => p.layout.fields.find(f => f.key === "headings")!;

  it("STORAGE INSTRUCTIONS: and THE INGREDIENTS: look exactly the same", () => {
    const h = headingRuns(proofLabel(snapshot(), when, fonts));
    expect(h.boxes).toHaveLength(2);
    expect(h.runs.map(r => r.text).join(" ")).toBe("STORAGE INSTRUCTIONS: THE INGREDIENTS:");
    const styles = new Set(h.runs.map(r => `${r.face.width}/${r.face.weight}/${r.sizeDots}`));
    expect(styles.size).toBe(1);
    expect(h.runs[0].face.weight).toBe(700);
    expect(h.sizePt).toBe(DEFAULT_TEMPLATE.fields.headings.maxPt);
  });

  it("stay at their fixed size however far the deck shrinks", () => {
    const short = proofLabel(snapshot(), when, fonts);
    const squeezed = proofLabel(snapshot(`${DECK} ${DECK}`), when, fonts);
    const ing = (p: typeof short) => p.layout.fields.find(f => f.key === "ingredients")!;
    expect(squeezed.layout.fits).toBe(true);
    expect(ing(squeezed).sizePt).toBeLessThan(ing(short).sizePt); // the deck shrank…
    const a = headingRuns(short), b = headingRuns(squeezed);
    expect(b.sizePt).toBe(a.sizePt); // …the headings didn't
    expect(b.runs.map(r => [r.face.width, r.sizeDots, Math.round(r.y)])).toEqual(a.runs.map(r => [r.face.width, r.sizeDots, Math.round(r.y)]));
  });

  it("their height is reserved: the text underneath starts below them", () => {
    const p = proofLabel(snapshot(), when, fonts);
    const h = headingRuns(p);
    const ingBox = p.layout.fields.find(f => f.key === "ingredients")!.boxes[0];
    const storageBox = p.layout.fields.find(f => f.key === "storage")!.boxes[0];
    expect(storageBox.y).toBeGreaterThanOrEqual(h.boxes[0].y + h.boxes[0].h);
    expect(ingBox.y).toBeGreaterThanOrEqual(h.boxes[1].y + h.boxes[1].h);
  });
});

describe("title", () => {
  it("is centred across the top", () => {
    const proof = proofLabel(snapshot(), { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
    const title = proof.layout.fields.find(f => f.key === "title")!;
    const box = title.boxes[0];
    let minX = Infinity, maxX = -Infinity;
    for (let y = Math.floor(box.y); y < box.y + box.h; y++) for (let x = 0; x < proof.bitmap.width; x++) {
      if (proof.bitmap.get(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    const leftGap = minX - box.x;
    const rightGap = box.x + box.w - (maxX + 1);
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(4); // within a couple of dots
    expect(leftGap).toBeGreaterThan(50);
  });
});
