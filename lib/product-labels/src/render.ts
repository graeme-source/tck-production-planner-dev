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
import { layoutFrontLabel, type FrontLabelInput, type FrontLabelLayout } from "./front-label";
import { Bitmap, fillCircle, fillContours, fillRect, flattenPath, type PathCmd } from "./raster";
import type { LabelSnapshot } from "./snapshot";
import { snowflakeContours } from "./snowflake";
import { normaliseTemplate } from "./template";

export { LabelFontSet, FONT_FILES } from "./fonts";
export { Bitmap } from "./raster";
export { encodePng, pngDataUrl } from "./png";
export { labelsPdf } from "./pdf";

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
  const rule = layout.divider;
  if (rule) fillRect(bm, rule.x, rule.y, rule.w, rule.h, 1);
  // The storage band: black, then its white words and snowflakes.
  if (layout.banner) {
    const { rect, flakes } = layout.banner;
    fillRect(bm, rect.x, rect.y, rect.w, rect.h, 1);
    for (const f of flakes) fillContours(bm, snowflakeContours(f.cx, f.cy, f.r), 0);
  }
  for (const run of layout.extraRuns ?? []) drawRun(bm, fonts, run);
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

/**
 * Stamp a test label: the text (default "TEST — NOT FOR SALE") in big bold
 * capitals along the label's diagonal, XOR-drawn so it reads over text and
 * blank space alike. Used for a test print of a proof that isn't live — it
 * must never pass for a real label. Draws into the given bitmap (a copy is
 * the caller's choice).
 */
export function stampTest(bm: Bitmap, fonts: LabelFontSet, text = "TEST — NOT FOR SALE"): void {
  const face = { width: "normal" as const, weight: 700 as const };
  const angle = -Math.atan2(bm.height, bm.width); // bottom-left → top-right
  const diag = Math.hypot(bm.width, bm.height);
  const unit = fonts.advance(text, face, 1, 0.02);
  const size = (diag * 0.82) / unit;
  const shaped = fonts.shapeText(text, face, size, 0.02);
  const ink = fonts.ink(text, face, size, 0.02);
  // Lay the text out horizontally centred on the origin, then rotate it about
  // the label's centre.
  const ox = -shaped.advance / 2;
  const oy = (ink.top - ink.bottom) / 2;
  const cx = bm.width / 2, cy = bm.height / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rot = (x: number, y: number): [number, number] => [cx + x * cos - y * sin, cy + x * sin + y * cos];
  const contours: Array<Array<[number, number]>> = [];
  for (const g of shaped.glyphs) {
    const cmds = fonts.glyphPath(g.glyph, ox + g.x, oy, size) as unknown as PathCmd[];
    for (const c of flattenPath(cmds)) contours.push(c.map(([x, y]) => rot(x, y)));
  }
  fillContours(bm, contours, "xor");
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

/** The front name label (#331) at printer resolution, plus its PNG proof.
 *  Same fonts and rasteriser as the back label; prints through labelsPdf. */
export function renderFrontLabel(input: FrontLabelInput, fonts: LabelFontSet): { bitmap: Bitmap; png: string; layout: FrontLabelLayout } {
  const layout = layoutFrontLabel(fonts, input);
  const bitmap = new Bitmap(layout.widthDots, layout.heightDots);
  for (const run of layout.runs) drawRun(bitmap, fonts, run);
  return { bitmap, png: pngDataUrl(bitmap), layout };
}
