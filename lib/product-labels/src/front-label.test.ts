import { describe, it, expect } from "vitest";
import { loadBundledFonts } from "./node-fonts";
import { cleanFrontText, FRONT_LABEL_PAGE, frontLabelName, layoutFrontLabel } from "./front-label";
import { labelsPdf, renderFrontLabel } from "./render";
import { labelPageSizeMm } from "./pdf";

// #331: front name labels for test flavours, instead of making each by hand.
const fonts = loadBundledFonts();

function inkWithinMargins(name: string, second?: string) {
  const { bitmap } = renderFrontLabel({ name, secondLine: second }, fonts);
  const margin = Math.round((FRONT_LABEL_PAGE.marginMm / 25.4) * FRONT_LABEL_PAGE.dpi) - 1;
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
    if (bitmap.get(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  return { bitmap, inside: minX >= margin && minY >= margin && maxX < bitmap.width - margin && maxY < bitmap.height - margin, maxX, minX };
}

describe("frontLabelName", () => {
  it("uses the label name, falling back to the recipe name", () => {
    expect(frontLabelName("  Big Mexican ", "Mexican Chicken (test)")).toBe("Big Mexican");
    expect(frontLabelName(null, "Mexican Chicken")).toBe("Mexican Chicken");
    expect(frontLabelName("  ", "Mexican Chicken")).toBe("Mexican Chicken");
  });
});

describe("front name label", () => {
  it("is 102 × 25 mm at the printer's 203 dpi", () => {
    const l = layoutFrontLabel(fonts, { name: "Chicken & Tarragon Pie" });
    const size = labelPageSizeMm({ width: l.widthDots, height: l.heightDots } as never, l.dpi);
    expect(size.widthMm).toBeCloseTo(102, 0);
    expect(size.heightMm).toBeCloseTo(25, 0);
  });

  it("puts the name on ONE line, shrinking a long name to fit", () => {
    const short = layoutFrontLabel(fonts, { name: "Margherita" });
    const long = layoutFrontLabel(fonts, { name: "Shredded Beef & Mushroom with Red Wine Gravy" });
    expect(short.runs).toHaveLength(1);
    expect(long.runs).toHaveLength(1);
    expect(long.nameSizeDots).toBeLessThan(short.nameSizeDots);
    expect(inkWithinMargins("Shredded Beef & Mushroom with Red Wine Gravy").inside).toBe(true);
    expect(inkWithinMargins("Margherita").inside).toBe(true);
  });

  it("adds an optional short second line under a smaller name", () => {
    const one = layoutFrontLabel(fonts, { name: "Margherita" });
    const two = layoutFrontLabel(fonts, { name: "Margherita", secondLine: "Test flavour" });
    expect(two.runs).toHaveLength(2);
    expect(two.runs[1].y).toBeGreaterThan(two.runs[0].y);
    expect(two.nameSizeDots).toBeLessThan(one.nameSizeDots);
    expect(inkWithinMargins("Margherita", "Test flavour").inside).toBe(true);
  });

  it("never makes the second line bigger than the name, even for a long name", () => {
    const l = layoutFrontLabel(fonts, { name: "Shredded Beef & Mushroom with Red Wine Gravy", secondLine: "Winter Warmers test box" });
    expect(l.runs[1].sizeDots).toBeLessThanOrEqual(Math.floor(l.runs[0].sizeDots * 0.6));
    expect(inkWithinMargins("Shredded Beef & Mushroom with Red Wine Gravy", "Winter Warmers test box").inside).toBe(true);
  });

  it("cleans the text and caps the second line", () => {
    expect(cleanFrontText({ name: "  Mexican   Chicken ", secondLine: "   " })).toEqual({ name: "Mexican Chicken", second: null });
    expect(cleanFrontText({ name: "x", secondLine: "y".repeat(80) }).second).toHaveLength(40);
  });

  it("prints nothing without a name, and makes a PDF page per label", () => {
    expect(layoutFrontLabel(fonts, { name: "  " }).ok).toBe(false);
    const { bitmap } = renderFrontLabel({ name: "Winter Warmer" }, fonts);
    expect(bitmap.blackCount()).toBeGreaterThan(0);
    const pdf = new TextDecoder().decode(labelsPdf({ bitmap, dpi: FRONT_LABEL_PAGE.dpi, copies: 3 }));
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(3);
  });
});
