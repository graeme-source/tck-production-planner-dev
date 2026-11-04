import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "./node-fonts";
import { DEFAULT_RECIPE_LABEL_SETTINGS, buildSnapshot, diffSnapshots, snapshotsMatch } from "./snapshot";
import { labelFormat } from "./formats";
import { layoutDeckLabel, layoutPairNameLabel } from "./deck-label";
import { proofLabel, proofPdf } from "./render";
import { publishBlockers } from "./status";
import { smallWithIngredientsTemplate, TEMPLATE_PRESETS } from "./template";
import { legalMinPt, MIN_X_HEIGHT_MM, xHeightMmAt } from "./legal";

const fonts = loadBundledFonts();
const DECK = "Red Wine Gravy (Water, Red wine (**sulphites**), Red onions, Beef Stock (Water, beef bones, onion, carrot, leek, tomato puree, garlic, lovage, parsley), Salted **Butter** (**Butter** (**MILK**), Salt), **WHEAT** Flour, Demerara Sugar, thyme).";
const MAY = "May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk";
const when = { printDate: "2026-11-04", productionDate: "2026-11-04" };
const STORAGE = "Keep chilled below 5°C.";
const WARMING = "Pour into a microwave-proof container. Warm in the microwave for 30 seconds, or until it reaches your desired temperature.";

const snapshot = (deckText = DECK) => buildSnapshot({
  recipe: { name: "Red Wine Gravy", packSize: "1.0000", shelfLifeDays: 5 },
  deck: { deckText, mayContainStatement: MAY },
  settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "97748478844497" },
  templateId: 9,
  template: smallWithIngredientsTemplate(),
});

describe("small label with ingredients (two 102 × 25 mm labels)", () => {
  it("is a preset with its own fixed size", () => {
    expect(TEMPLATE_PRESETS.some((p) => p.key === "small-with-ingredients")).toBe(true);
    const f = labelFormat(smallWithIngredientsTemplate());
    expect([f.key, f.widthMm, f.heightMm, f.printsDeck, f.backLabel]).toEqual(["pair-102x25", 102, 25, true, false]);
  });

  it("fits the gravy's real ingredients and may-contain at the full legal size, inside the label", () => {
    const l = layoutDeckLabel(fonts, { deckText: DECK, mayContain: MAY, allergenNote: "Allergens are shown in **Bold**.", smallPack: false });
    expect(l.fits).toBe(true);
    const xh = Math.min(fonts.metrics({ width: l.width, weight: 500 }).xHeight, fonts.metrics({ width: l.width, weight: 700 }).xHeight);
    expect(l.sizePt).toBeGreaterThanOrEqual(legalMinPt(xh, false));
    expect(xHeightMmAt(l.sizePt, xh)).toBeGreaterThanOrEqual(MIN_X_HEIGHT_MM);
    for (const r of l.runs) {
      const ink = fonts.ink(r.text, r.face, r.sizeDots, 0);
      expect(r.x + ink.left).toBeGreaterThanOrEqual(0);
      expect(r.x + ink.right).toBeLessThanOrEqual(l.widthDots);
      expect(r.y - ink.top).toBeGreaterThanOrEqual(0);
      expect(r.y + ink.bottom).toBeLessThanOrEqual(l.heightDots);
    }
    const text = l.runs.map((r) => r.text).join(" ");
    expect(text).toContain("INGREDIENTS:");
    expect(text).toContain("traces");
  });

  it("shows allergens in bold and nothing else that isn't", () => {
    const l = layoutDeckLabel(fonts, { deckText: "Water, **MILK**", smallPack: false });
    expect(l.runs.filter((r) => r.face.weight === 700).map((r) => r.text)).toEqual(["INGREDIENTS:", "**MILK**".replaceAll("*", "")]);
  });

  it("never goes under the legal size to fit: too long a deck can't go live", () => {
    const proof = proofLabel(snapshot(Array(6).fill(DECK).join(", ")), when, fonts);
    expect(proof.layout.fits).toBe(false);
    expect(proof.layout.problems[0]?.message).toMatch(/don't fit/);
  });

  it("prints both labels for every pack, and the first is the normal small label", () => {
    const proof = proofLabel(snapshot(), when, fonts);
    expect(proof.layout.fits).toBe(true);
    expect(proof.pages).toHaveLength(2);
    expect(proof.small?.layout.barcode?.moduleDots).toBe(2);
    expect(new TextDecoder("latin1").decode(proofPdf(proof, 203, 3, "Gravy"))).toContain("/Count 6");
    expect(proof.bitmap.width).toBe(proof.layout.widthDots);
    expect(proof.layout.heightDots).toBeGreaterThan(proof.bitmap.height * 2);
  });

  it("needs the label updating when the ingredients change", () => {
    const a = snapshot();
    const b = snapshot(DECK.replace("thyme", "rosemary"));
    expect(snapshotsMatch(a, b)).toBe(false);
    expect(diffSnapshots(a, b).map((c) => c.key)).toContain("deckText");
  });

  it("fits the gravy's long name, instructions and a bigger barcode at the legal size", () => {
    const l = layoutPairNameLabel(fonts, { name: "6 hour red wine gravy reduction - 200ml", useBy: "11/11/26", batch: "26308", barcode: "5065018206535", storage: STORAGE, warming: WARMING });
    expect(l.ok).toBe(true);
    expect(l.barcode).toMatchObject({ kind: "ean13", moduleDots: 3 });
    const b = l.barcode!;
    expect(b.x + b.modules.length * b.moduleDots).toBeLessThanOrEqual(l.widthDots);
    const left = l.runs.filter((r) => r.x < b.x);
    for (const r of left) {
      const ink = fonts.ink(r.text, r.face, r.sizeDots, 0);
      expect(r.x + ink.right, r.text).toBeLessThanOrEqual(b.x);
      expect(r.y - ink.top, r.text).toBeGreaterThanOrEqual(0);
      expect(r.y + ink.bottom, r.text).toBeLessThanOrEqual(l.heightDots);
      const pt = (r.sizeDots / 203) * 72;
      expect(pt, r.text).toBeGreaterThanOrEqual(legalMinPt(Math.min(fonts.metrics({ width: r.face.width, weight: 500 }).xHeight, fonts.metrics({ width: r.face.width, weight: 700 }).xHeight), false) - 0.001);
    }
    const text = l.runs.map((r) => r.text).join(" ");
    for (const words of ["STORAGE:", "TO WARM:", "microwave-proof"]) expect(text).toContain(words);
    expect(l.runs.filter((r) => r.face.weight === 700).map((r) => r.text)).toEqual(expect.arrayContaining(["STORAGE:", "TO", "WARM:"]));
  });

  it("refuses instructions too long to fit rather than shrinking them", () => {
    const l = layoutPairNameLabel(fonts, { name: "Red Wine Gravy", useBy: "11/11/26", batch: "26308", barcode: "5065018206535", storage: STORAGE, warming: WARMING.repeat(4) });
    expect(l.ok).toBe(false);
  });

  it("flags the label for updating when the instructions change, and leaves other labels alone", () => {
    const a = snapshot();
    const t = smallWithIngredientsTemplate();
    t.text.packWarming = WARMING;
    const b = buildSnapshot({
      recipe: { name: "Red Wine Gravy", packSize: "1.0000", shelfLifeDays: 5 },
      deck: { deckText: DECK, mayContainStatement: MAY },
      settings: { ...DEFAULT_RECIPE_LABEL_SETTINGS, barcode: "97748478844497" },
      templateId: 9, template: t,
    });
    expect(snapshotsMatch(a, b)).toBe(false);
    expect(diffSnapshots(a, b).map((c) => c.key)).toContain("template.text.packWarming");
  });

  it("is held back by declaration problems, as a back label is", () => {
    const blockers = publishBlockers({ archived: false, fits: true, fitProblems: [], contentProblems: [], deckBlockers: ["Salt has no declaration"], template: smallWithIngredientsTemplate() });
    expect(blockers).toEqual(["Salt has no declaration"]);
  });

  it("refuses a recipe with no ingredients", () => {
    expect(proofLabel(snapshot(""), when, fonts).content.problems.join()).toMatch(/No ingredients/);
  });
});
