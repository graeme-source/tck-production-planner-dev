/**
 * The ingredients label (Graeme, 2026-11-04, red wine gravy): 102 × 25 mm, on
 * its own beside the small label, because the deck won't fit with the name,
 * dates and barcode. Two labels go in each pack (formats.ts, pair-102x25):
 * the small label (small-label.ts) and this one.
 *
 * The heading, the deck with allergens in bold, the may-contain statement and
 * the allergen note. Pure layout, measured through TextMeasurer; render.ts
 * draws it. It only ever shrinks as far as the legal minimum type size: if
 * it still won't fit, `fits` is false and the label can't go live.
 *
 * The pair's first label is here too (layoutPairNameLabel): the small label's
 * name, USE BY, BATCH and barcode, with storage and warming instructions
 * under their own headings, a bigger barcode, and tighter margins to fit them
 * (Graeme, 2026-11-04).
 */
import { mmToDots } from "@workspace/units";
import type { Face, PlacedRun, TextMeasurer } from "./layout";
import { FRONT_LABEL_PAGE, fitLine } from "./front-label";
import { legalMinPt } from "./legal";
import { smallLabelBarcodeModules, type SmallLabelBarcode, type SmallLabelInput, type SmallLabelLayout } from "./small-label";
import { mayContainParagraph, parseBold, type Paragraph } from "./text";
import type { WidthVariant } from "./template";

export interface DeckLabelInput {
  /** With **bold** allergens. */
  deckText: string;
  mayContain?: string | null;
  /** "Allergens are shown in **Bold**." */
  allergenNote?: string | null;
  /** The pack's largest surface is under 80 cm²: 0.9 mm x-height, not 1.2. */
  smallPack: boolean;
}

export interface DeckLabelLayout {
  widthDots: number;
  heightDots: number;
  dpi: number;
  runs: PlacedRun[];
  sizePt: number;
  width: WidthVariant;
  lines: number;
  /** False = it doesn't fit at the legal minimum size. */
  fits: boolean;
}

/** The same room for a label sitting off on the roll as the small label. */
const SIDE_INSET_MM = 7;
const WIDTHS: WidthVariant[] = ["normal", "semi-condensed", "condensed"];
/** Tidy, not filling every pixel (Graeme, 2026-10-27). */
const LARGEST_PT = 9;
const LINE_HEIGHT = 1.1;
const ptToDots = (pt: number) => (pt / 72) * FRONT_LABEL_PAGE.dpi;

type Piece = { text: string; bold: boolean };

/** Word wrap with bold runs, measured by advance. */
function wrapPieces(m: TextMeasurer, paras: Paragraph[], width: WidthVariant, size: number, boxW: number) {
  const face = (bold: boolean): Face => ({ width, weight: bold ? 700 : 500 });
  const advance = (p: Piece) => m.advance(p.text, face(p.bold), size, 0);
  const space = m.advance(" ", face(false), size, 0);
  const lines: Array<Array<{ piece: Piece; x: number }>> = [];
  let tooWide = false;
  for (const para of paras) {
    const words: Piece[][] = [[]];
    for (const run of para) {
      run.text.split(/(\s+)/).forEach((part) => {
        if (/^\s+$/.test(part)) words.push([]);
        else if (part) words[words.length - 1]!.push({ text: part, bold: run.bold });
      });
    }
    let line: Array<{ piece: Piece; x: number }> = [];
    let x = 0;
    for (const word of words.filter((w) => w.length > 0)) {
      const w = word.reduce((t, p) => t + advance(p), 0);
      if (w > boxW) tooWide = true;
      let start = line.length ? x + space : 0;
      if (line.length && start + w > boxW) { lines.push(line); line = []; start = 0; }
      let cx = start;
      for (const piece of word) { line.push({ piece, x: cx }); cx += advance(piece); }
      x = cx;
    }
    if (line.length) lines.push(line);
  }
  return { lines, tooWide };
}

/** As big as it will go, up to LARGEST_PT, never under the legal minimum. */
export function layoutDeckLabel(m: TextMeasurer, input: DeckLabelInput): DeckLabelLayout {
  const p = FRONT_LABEL_PAGE;
  const widthDots = Math.round(mmToDots(p.widthMm, p.dpi));
  const heightDots = Math.round(mmToDots(p.heightMm, p.dpi));
  const margin = Math.round(mmToDots(p.marginMm, p.dpi));
  const side = Math.round(mmToDots(SIDE_INSET_MM, p.dpi));
  const innerW = widthDots - side * 2;
  const innerH = heightDots - margin * 2;
  const tail = [
    ...(input.mayContain?.trim() ? mayContainParagraph(input.mayContain, true) : []),
    ...(input.allergenNote?.trim() ? [{ text: " ", bold: false }, ...parseBold(input.allergenNote.trim())] : []),
  ];
  const paras: Paragraph[] = [
    [{ text: "INGREDIENTS: ", bold: true }, ...parseBold(input.deckText.trim())],
    ...(tail.length ? [tail] : []),
  ];
  const place = (width: WidthVariant, sizePt: number) => {
    const size = ptToDots(sizePt);
    const { lines, tooWide } = wrapPieces(m, paras, width, size, innerW);
    const metrics = m.metrics({ width, weight: 500 });
    const pitch = size * LINE_HEIGHT;
    const asc = metrics.ascender * size * 0.8;
    const height = asc + pitch * (lines.length - 1) + metrics.descender * size;
    return { size, lines, pitch, asc, height, ok: !tooWide && height <= innerH };
  };
  const build = (width: WidthVariant, sizePt: number, q: ReturnType<typeof place>, fits: boolean): DeckLabelLayout => {
    const top = margin + Math.max(0, (innerH - q.height) / 2);
    const runs: PlacedRun[] = q.lines.flatMap((line, i) => line.map(({ piece, x }) => ({
      x: side + x, y: Math.round(top + q.asc + i * q.pitch), text: piece.text,
      face: { width, weight: piece.bold ? 700 as const : 500 as const }, sizeDots: q.size, letterSpacingEm: 0,
    })));
    return { widthDots, heightDots, dpi: p.dpi, runs, sizePt, width, lines: q.lines.length, fits };
  };
  const legal = (width: WidthVariant) => legalMinPt(Math.min(m.metrics({ width, weight: 500 }).xHeight, m.metrics({ width, weight: 700 }).xHeight), input.smallPack);
  const steps: Array<{ width: WidthVariant; sizePt: number }> = [];
  for (let pt = LARGEST_PT; pt >= 3; pt -= 0.25) for (const width of WIDTHS) if (pt >= legal(width)) steps.push({ width, sizePt: pt });
  for (const s of steps) {
    const q = place(s.width, s.sizePt);
    if (q.ok) return build(s.width, s.sizePt, q, true);
  }
  const last = steps[steps.length - 1]!;
  return build(last.width, last.sizePt, place(last.width, last.sizePt), false);
}

/** 3 dots = 0.375 mm modules, about full size for an EAN-13. */
const PAIR_MODULE_DOTS = 3;
const PAIR_BARCODE_MAX_SHARE = 0.5;
const PAIR_BAR_MAX_MM = 15;
const PAIR_BLOCK_GAP_MM = 0.7;
const PAIR_SIDE_MM = 4;
const PAIR_TOP_MM = 1.5;
/** Largest sizes; every line steps down together to the legal minimum. */
const PAIR_PT = { name: 10.5, dates: 8.5, note: 7.75 } as const;

/** The pair's first label: a bigger barcode on the right; the name, dates and
 *  instructions on the left, all at the legal size or above. */
export function layoutPairNameLabel(m: TextMeasurer, input: SmallLabelInput & { smallPack?: boolean }): SmallLabelLayout {
  const p = FRONT_LABEL_PAGE;
  const mm = (v: number) => Math.round(mmToDots(v, p.dpi));
  const widthDots = mm(p.widthMm);
  const heightDots = mm(p.heightMm);
  const margin = mm(PAIR_TOP_MM);
  const side = mm(PAIR_SIDE_MM);
  const innerW = widthDots - side * 2;
  const innerH = heightDots - margin * 2;
  const name = input.name.replace(/\s+/g, " ").trim().toUpperCase();
  const runs: PlacedRun[] = [];
  if (!name) return { widthDots, heightDots, dpi: p.dpi, runs, barcode: null, barcodeProblem: null, ok: false };

  let barcode: SmallLabelBarcode | null = null;
  let barcodeProblem: string | null = null;
  let leftW = innerW;
  const code = input.barcode?.replace(/\s+/g, "");
  if (code) {
    const enc = smallLabelBarcodeModules(code);
    if ("problem" in enc) barcodeProblem = enc.problem;
    else {
      const maxW = Math.floor(innerW * PAIR_BARCODE_MAX_SHARE);
      const moduleDots = Math.max(1, Math.min(PAIR_MODULE_DOTS, Math.floor(maxW / enc.modules.length)));
      const w = enc.modules.length * moduleDots;
      const x = widthDots - side - w;
      const digitsH = mm(2.6);
      const barGap = mm(0.6);
      const barsH = Math.min(innerH - digitsH - barGap, mm(PAIR_BAR_MAX_MM));
      const top = margin + Math.round((innerH - (barsH + barGap + digitsH)) / 2);
      const bottom = top + barsH;
      barcode = { kind: enc.kind, modules: enc.modules, x, top, bottom, moduleDots };
      const fit = fitLine(m, code, 500, w - moduleDots * 16, digitsH, digitsH + 6);
      runs.push({ x: Math.round(x + (w - fit.inkW) / 2 - fit.inkLeft), y: bottom + barGap + fit.inkTop, text: code, face: fit.face, sizeDots: fit.size, letterSpacingEm: 0 });
      leftW = x - side - mm(1);
    }
  }

  const dates: Paragraph = [
    { text: `USE BY: ${input.useBy}`, bold: true },
    ...(input.batch?.trim() ? [{ text: `   BATCH: ${input.batch.trim()}`, bold: false }] : []),
  ];
  const instruction = (heading: string, text?: string | null): Paragraph[] => {
    const words = text?.replace(/\s+/g, " ").trim();
    return words ? [[{ text: `${heading} `, bold: true }, ...parseBold(words)]] : [];
  };
  const notes = [...instruction("STORAGE:", input.storage), ...instruction("TO WARM:", input.warming)];
  const blocks = (pts: { name: number; dates: number; note: number }) => [
    { paras: [[{ text: name, bold: true }]] as Paragraph[], pt: pts.name, align: "condensed" as WidthVariant },
    { paras: [dates], pt: pts.dates, align: "semi-condensed" as WidthVariant },
    ...(notes.length ? [{ paras: notes, pt: pts.note, align: "condensed" as WidthVariant }] : []),
  ];
  const legal = (width: WidthVariant) => legalMinPt(Math.min(m.metrics({ width, weight: 500 }).xHeight, m.metrics({ width, weight: 700 }).xHeight), !!input.smallPack);
  const gap = mm(PAIR_BLOCK_GAP_MM);
  const measure = (down: number) => {
    const pts = { name: PAIR_PT.name - down, dates: PAIR_PT.dates - down, note: PAIR_PT.note - down };
    const placed = blocks(pts).map((b) => {
      const pt = Math.max(b.pt, legal(b.align));
      const size = ptToDots(pt);
      const { lines, tooWide } = wrapPieces(m, b.paras, b.align, size, leftW);
      const metrics = m.metrics({ width: b.align, weight: 500 });
      const pitch = size * LINE_HEIGHT;
      const asc = metrics.ascender * size * 0.8;
      return { width: b.align, size, lines, pitch, asc, tooWide, h: asc + pitch * (lines.length - 1) + metrics.descender * size };
    });
    return { placed, height: placed.reduce((t, b) => t + b.h, 0) + gap * (placed.length - 1) };
  };
  let chosen = measure(0);
  let fits = false;
  for (let down = 0; down <= 8; down += 0.25) {
    chosen = measure(down);
    if (chosen.height <= innerH && chosen.placed.every((b) => !b.tooWide)) { fits = true; break; }
  }
  let top = margin + Math.max(0, (innerH - chosen.height) / 2);
  for (const b of chosen.placed) {
    b.lines.forEach((line, i) => {
      for (const { piece, x } of line) {
        runs.push({
          x: side + x, y: Math.round(top + b.asc + i * b.pitch), text: piece.text,
          face: { width: b.width, weight: piece.bold ? 700 : 500 }, sizeDots: b.size, letterSpacingEm: 0,
        });
      }
    });
    top += b.h + gap;
  }
  return { widthDots, heightDots, dpi: p.dpi, runs, barcode, barcodeProblem, ok: fits };
}
