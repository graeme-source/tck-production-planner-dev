import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { loadBundledFonts } from "./node-fonts";
import { CODE128_PATTERNS, code128Symbols, encodeCode128 } from "./code128";
import { layoutSmallLabel, smallLabelBarcodeModules, SMALL_LABEL_PAGE } from "./small-label";
import { renderSmallLabel } from "./render";

const fonts = loadBundledFonts();

describe("Code 128", () => {
  it("every symbol is 11 modules wide (stop 13) and they're all different", () => {
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((t, d) => t + Number(d), 0), `symbol ${i}`).toBe(i === 106 ? 13 : 11));
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });
  it("encodes Shopify's 14-digit garlic mayo code in set C with the right check", () => {
    // 105 start C, then 97 74 84 78 84 44 97; check = (105 + Σ v·i) mod 103.
    const s = code128Symbols("97748478844497");
    expect(s.slice(0, 8)).toEqual([105, 97, 74, 84, 78, 84, 44, 97]);
    const sum = 105 + [97, 74, 84, 78, 84, 44, 97].reduce((t, v, i) => t + v * (i + 1), 0);
    expect(s[8]).toBe(sum % 103);
    // start + 7 pairs + check = 9 symbols × 11, + stop 13.
    expect(encodeCode128("97748478844497")).toHaveLength(9 * 11 + 13);
  });
  it("uses set B for text and odd-length numbers", () => {
    expect(code128Symbols("ABC")[0]).toBe(104);
    expect(code128Symbols("123")[0]).toBe(104);
  });
});

describe("small product label (102 × 25 mm)", () => {
  it("picks EAN-13 for a valid EAN and Code 128 otherwise", () => {
    expect(smallLabelBarcodeModules("5065018206948")).toMatchObject({ kind: "ean13" });
    expect(smallLabelBarcodeModules("97748478844497")).toMatchObject({ kind: "code128" });
    expect(smallLabelBarcodeModules("5065018206949")).toMatchObject({ kind: "code128" }); // bad check digit
  });
  it("keeps every line and the barcode inside the label", () => {
    const l = layoutSmallLabel(fonts, { name: "TCK Garlic Mayo", useBy: "04/12/26", batch: "26300", barcode: "97748478844497" });
    expect(l.ok).toBe(true);
    expect(l.barcode).not.toBeNull();
    const b = l.barcode!;
    expect(b.x).toBeGreaterThan(0);
    expect(b.x + b.modules.length * b.moduleDots).toBeLessThanOrEqual(l.widthDots);
    expect(b.moduleDots).toBeGreaterThanOrEqual(2); // 0.25 mm+ at 203 dpi — scannable
    for (const r of l.runs) expect(r.x).toBeGreaterThanOrEqual(0);
    expect(l.runs.map(r => r.text)).toEqual(["97748478844497", "TCK GARLIC MAYO", "USE BY: 04/12/26", "BATCH: 26300"]);
  });
  it("text never runs into the barcode, even for a long name", () => {
    const l = layoutSmallLabel(fonts, { name: "Rolo Chocolate Brownie With Extra Caramel", secondLine: "5 pack", useBy: "14/11/26", barcode: "5065018206948" });
    const left = l.runs.filter(r => !/^\d+$/.test(r.text));
    for (const r of left) {
      const ink = fonts.ink(r.text, r.face, r.sizeDots, 0);
      expect(r.x + ink.right, r.text).toBeLessThan(l.barcode!.x);
    }
  });
  it("prints without a barcode when there isn't one", () => {
    const l = layoutSmallLabel(fonts, { name: "Brownie", useBy: "14/11/26" });
    expect(l.barcode).toBeNull();
    expect(l.ok).toBe(true);
  });
  it("renders at the label's size", () => {
    const { bitmap, png } = renderSmallLabel({ name: "TCK Garlic Mayo", useBy: "04/12/26", batch: "26300", barcode: "97748478844497" }, fonts);
    expect(bitmap.width).toBe(Math.round((SMALL_LABEL_PAGE.widthMm / 25.4) * 203));
    if (process.env["SMALL_LABEL_PROOF"]) writeFileSync(process.env["SMALL_LABEL_PROOF"], Buffer.from(png.split(",")[1]!, "base64"));
    const brownie = renderSmallLabel({ name: "Rolo Chocolate Brownie", secondLine: "5 pack", useBy: "10/11/26", barcode: "5065018206948" }, fonts);
    if (process.env["SMALL_LABEL_PROOF_2"]) writeFileSync(process.env["SMALL_LABEL_PROOF_2"], Buffer.from(brownie.png.split(",")[1]!, "base64"));
  });
});
