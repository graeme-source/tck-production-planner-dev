import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { loadBundledFonts } from "./node-fonts";
import { encodePng, proofLabel, renderLabel } from "./render";
import { Bitmap, fillContours, fillRect } from "./raster";
import { buildSnapshot, DEFAULT_RECIPE_LABEL_SETTINGS } from "./snapshot";
import { DEFAULT_TEMPLATE, normaliseTemplate } from "./template";
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
  it("lays out, fits and renders at 203 dpi", () => {
    const proof = proofLabel(snapshot(), { printDate: "2026-10-10", productionDate: "2026-10-10" }, fonts);
    expect(proof.layout.problems).toEqual([]);
    expect(proof.layout.fits).toBe(true);
    expect(proof.content.problems).toEqual([]);
    expect(proof.bitmap.width).toBe(799); // 100 mm at 203 dpi
    expect(proof.bitmap.height).toBe(559);
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
    // Every character of the heading + deck is placed, in order.
    const placed = ing.runs.map(r => r.text).join("");
    const expected = ("THE INGREDIENTS: " + long.replace(/\*\*/g, "")).replace(/\s+/g, "");
    expect(placed).toBe(expected);
    // Renders anyway, so the proof can show the overflow.
    expect(renderLabel(layout, fonts).width).toBe(799);
  });
});
