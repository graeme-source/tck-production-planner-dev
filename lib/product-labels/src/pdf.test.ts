import { describe, it, expect } from "vitest";
import { labelPageSizeMm, labelsPdf } from "./pdf";
import { Bitmap, fillRect } from "./raster";
import { initialPrintCount, printRefusal } from "./status";
import { buildPrintRecord } from "./print-record";
import { labelDates } from "./dates";

const latin1 = (b: Uint8Array) => Array.from(b, c => String.fromCharCode(c)).join("");

describe("back-labels PDF", () => {
  const bm = new Bitmap(1119, 751); // 140 × 94 mm at 203 dpi
  fillRect(bm, 10, 10, 100, 50);
  const pdf = labelsPdf({ bitmap: bm, dpi: 203, copies: 3, title: "Chicken and Chorizo — back labels" });
  const s = latin1(pdf);

  it("has one page per label", () => {
    expect(s.match(/\/Type \/Page /g)).toHaveLength(3);
    expect(s).toContain("/Count 3");
  });
  it("each page is the label to the nearest printer dot: 1119 × 751 dots at 203 dpi = 140.01 × 93.97 mm", () => {
    const boxes = s.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)!;
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toBe("/MediaBox [0 0 396.8866 266.3645]");
    const size = labelPageSizeMm(bm, 203);
    expect(Math.abs(size.widthMm - 140)).toBeLessThan(0.05);
    expect(Math.abs(size.heightMm - 94)).toBeLessThan(0.05);
    // one image pixel = one printer dot: page points × dpi / 72 = bitmap size, exactly
    // and never a hair MORE than the bitmap (that made a reader draw 1120 dots and resample)
    for (const [pt, dots] of [[396.8866, 1119], [266.3645, 751]] as const) {
      expect((pt * 203) / 72).toBeLessThanOrEqual(dots);
      expect((pt * 203) / 72).toBeGreaterThan(dots - 0.01);
    }
  });
  it("keeps the title plain ASCII", () => {
    expect(s).toContain("/Title (Chicken and Chorizo - back labels)");
  });
  it("embeds the 1-bit bitmap once, at its own size, filling the page", () => {
    expect(s.match(/\/Subtype \/Image/g)).toHaveLength(1);
    expect(s).toContain("/Width 1119 /Height 751 /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0]");
    expect(s).toContain("q 396.8866 0 0 266.3645 0 0 cm /Im0 Do Q");
    // packed rows: ceil(1119/8) × 751 bytes
    expect(s).toContain(`/Length ${Math.ceil(1119 / 8) * 751}`);
  });
  it("has a valid cross-reference table", () => {
    const xrefAt = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
    expect(entries).toHaveLength(5 + 3);
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });
  it("refuses zero labels", () => {
    expect(() => labelsPdf({ bitmap: bm, dpi: 203, copies: 0 })).toThrow();
  });
});

describe("what may be printed", () => {
  it("only a live label that still matches the recipe and fits", () => {
    expect(printRefusal({ hasLive: false, matchesLive: false, fits: true })).toBe("no-live");
    expect(printRefusal({ hasLive: true, matchesLive: false, fits: true })).toBe("update-needed");
    expect(printRefusal({ hasLive: true, matchesLive: true, fits: false })).toBe("doesnt-fit");
    expect(printRefusal({ hasLive: true, matchesLive: true, fits: true })).toBeNull();
  });
});

describe("print record", () => {
  it("keeps who, which live version, how many, the dates and the batch", () => {
    const dates = labelDates({ printDate: "2026-10-12", productionDate: "2026-10-09", chilled: { amount: 13, unit: "days" }, frozen: { amount: 6, unit: "months" }, batchBasis: "production-day" });
    const r = buildPrintRecord({
      recipe: { id: 2, name: "Chicken and Chorizo" },
      live: { id: 7, versionNo: 3, snapshotHash: "abc" },
      count: 118, dates, plan: { planId: 191, planItemId: 5569 }, format: "pdf", user: { id: 1, name: "Graeme" },
    });
    expect(r).toEqual({
      recipeId: 2, recipeName: "Chicken and Chorizo", labelVersionId: 7, versionNo: 3, snapshotHash: "abc", count: 118,
      printDate: "2026-10-12", productionDate: "2026-10-09", batchCode: "26282",
      chilledUseBy: "2026-10-25", frozenUseBy: "2027-04-12",
      planId: 191, planItemId: 5569, format: "pdf", printedById: 1, printedByName: "Graeme",
    });
  });
  it("refuses a zero count", () => {
    const dates = labelDates({ printDate: "2026-10-12", productionDate: "2026-10-12", chilled: null, frozen: null, batchBasis: "production-day" });
    expect(() => buildPrintRecord({ recipe: { id: 1, name: "x" }, live: { id: 1, versionNo: 1, snapshotHash: "h" }, count: 0, dates, plan: { planId: null, planItemId: null }, format: "pdf", user: { id: null, name: null } })).toThrow();
  });
});

describe("label count to start from", () => {
  it("is the item's net 2-packs, whole, never negative, capped", () => {
    expect(initialPrintCount(118)).toBe(118);
    expect(initialPrintCount(-3)).toBe(0);
    expect(initialPrintCount(undefined)).toBe(0);
    expect(initialPrintCount(900)).toBe(500);
  });
});
