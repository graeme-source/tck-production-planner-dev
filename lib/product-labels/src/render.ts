/**
 * Label renderer: layout → 1-bit bitmap at printer resolution. The proof on
 * screen is this bitmap as a PNG; Stage 2 sends the SAME bitmap to the
 * printer (TSPL BITMAP / ZPL ^GF from Bitmap.packedRows()). One renderer,
 * one set of font files, one layout — what you see is what prints.
 *
 * Entry point "@workspace/product-labels/render" (needs opentype.js); the
 * plain "@workspace/product-labels" entry is the pure model the browser uses.
 */
import { buildLabelContent, type LabelContent } from "./content";
import { labelDates, type LabelDates } from "./dates";
import { encodeEan13, isGuardModule } from "./ean13";
import { LabelFontSet } from "./fonts";
import { layoutLabel, type LabelLayout, type PlacedRun } from "./layout";
import { pngDataUrl } from "./png";
import { Bitmap, fillCircle, fillContours, fillRect, flattenPath, type PathCmd } from "./raster";
import type { LabelSnapshot } from "./snapshot";
import { normaliseTemplate } from "./template";

export { LabelFontSet, FONT_FILES } from "./fonts";
export { Bitmap } from "./raster";
export { encodePng, pngDataUrl } from "./png";

function drawRun(bm: Bitmap, fonts: LabelFontSet, run: PlacedRun): void {
  const shaped = fonts.shapeText(run.text, run.face, run.sizeDots, run.letterSpacingEm);
  for (const g of shaped.glyphs) {
    const cmds = fonts.glyphPath(g.glyph, run.x + g.x, run.y, run.sizeDots) as unknown as PathCmd[];
    fillContours(bm, flattenPath(cmds), run.white ? 0 : 1);
  }
}

/** How tall the drawing really is — more than the label when text overflows. */
export function inkHeight(layout: LabelLayout, fonts: LabelFontSet): number {
  let bottom = layout.heightDots;
  for (const f of layout.fields) for (const r of f.runs) {
    bottom = Math.max(bottom, Math.ceil(r.y + fonts.metrics(r.face).descender * r.sizeDots) + 2);
  }
  return bottom;
}

/** The label at printer resolution. `showOverflow` makes the canvas tall
 *  enough to show text that runs off the bottom (the DOESN'T FIT proof) —
 *  never used for printing. */
export function renderLabel(layout: LabelLayout, fonts: LabelFontSet, showOverflow = false): Bitmap {
  const bm = new Bitmap(layout.widthDots, showOverflow ? inkHeight(layout, fonts) : layout.heightDots);
  for (const c of layout.circles) fillCircle(bm, c.cx, c.cy, c.r, 1);
  for (const f of layout.fields) {
    for (const run of f.runs) if (!run.white) drawRun(bm, fonts, run);
  }
  // White numbers after their circles.
  for (const f of layout.fields) for (const run of f.runs) if (run.white) drawRun(bm, fonts, run);

  const b = layout.barcode;
  if (b.digits && b.module.ok) {
    const md = b.module.moduleDots;
    encodeEan13(b.digits).forEach((bar, i) => {
      if (!bar) return;
      const bottom = isGuardModule(i) ? b.guardBottom : b.barsBottom;
      // Whole dots: x and width are integers, so every module is exactly md dots.
      fillRect(bm, b.x + i * md, b.barsTop, md, bottom - b.barsTop, 1);
    });
    for (const run of b.digitRuns) drawRun(bm, fonts, run);
  }
  return bm;
}

export interface LabelProof {
  content: LabelContent;
  dates: LabelDates;
  layout: LabelLayout;
  /** Exactly what prints. */
  bitmap: Bitmap;
  png: string;
  /** When it doesn't fit: the same drawing on a taller canvas, so the words
   *  that run off the label can be seen (the label edge is at layout.heightDots). */
  overflowPng: string | null;
}

/** Content + layout only (no bitmap) — the fit check for the Labels list. */
export function checkLabel(rawSnapshot: LabelSnapshot, when: { printDate: string; productionDate: string }, fonts: LabelFontSet): Omit<LabelProof, "bitmap" | "png" | "overflowPng"> {
  // A snapshot published by an older version stores the template as it was
  // then (e.g. step1/step2/step3); read it through the normaliser so it
  // still renders.
  const snapshot = { ...rawSnapshot, template: normaliseTemplate(rawSnapshot.template) };
  const dates = labelDates({
    printDate: when.printDate,
    productionDate: when.productionDate,
    chilled: snapshot.chilled,
    frozen: snapshot.frozen,
    batchBasis: snapshot.template.batchBasis,
  });
  const content = buildLabelContent(snapshot, dates);
  const layout = layoutLabel(snapshot.template, content, fonts);
  return { content, dates, layout };
}

/** Snapshot + print/production dates → everything the proof page and (later)
 *  the printer need. */
export function proofLabel(snapshot: LabelSnapshot, when: { printDate: string; productionDate: string }, fonts: LabelFontSet): LabelProof {
  const checked = checkLabel(snapshot, when, fonts);
  const bitmap = renderLabel(checked.layout, fonts);
  const overflow = inkHeight(checked.layout, fonts) > checked.layout.heightDots ? renderLabel(checked.layout, fonts, true) : null;
  return { ...checked, bitmap, png: pngDataUrl(bitmap), overflowPng: overflow ? pngDataUrl(overflow) : null };
}
