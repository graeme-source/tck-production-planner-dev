import { describe, expect, it } from "vitest";
import { loadBundledFonts } from "./node-fonts";
import { DEFAULT_RECIPE_LABEL_SETTINGS, buildSnapshot, diffSnapshots, snapshotsMatch } from "./snapshot";
import { labelFormat } from "./formats";
import { layoutDeckLabel } from "./deck-label";
import { proofLabel, proofPdf } from "./render";
import { publishBlockers } from "./status";
import { smallWithIngredientsTemplate, TEMPLATE_PRESETS } from "./template";
import { legalMinPt, MIN_X_HEIGHT_MM, xHeightMmAt } from "./legal";

const fonts = loadBundledFonts();
const DECK = "Red Wine Gravy (Water, Red wine (**sulphites**), Red onions, Beef Stock (Water, beef bones, onion, carrot, leek, tomato puree, garlic, lovage, parsley), Salted **Butter** (**Butter** (**MILK**), Salt), **WHEAT** Flour, Demerara Sugar, thyme).";
const MAY = "May also contain traces of nuts, peanuts, egg, soya, celery, sulphites, mustard, wheat and milk";
const when = { printDate: "2026-11-04", productionDate: "2026-11-04" };

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

  it("is held back by declaration problems, as a back label is", () => {
    const blockers = publishBlockers({ archived: false, fits: true, fitProblems: [], contentProblems: [], deckBlockers: ["Salt has no declaration"], template: smallWithIngredientsTemplate() });
    expect(blockers).toEqual(["Salt has no declaration"]);
  });

  it("refuses a recipe with no ingredients", () => {
    expect(proofLabel(snapshot(""), when, fonts).content.problems.join()).toMatch(/No ingredients/);
  });
});
