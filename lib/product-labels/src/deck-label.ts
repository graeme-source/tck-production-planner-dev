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
 */
import { mmToDots } from "@workspace/units";
import type { Face, PlacedRun, TextMeasurer } from "./layout";
import { FRONT_LABEL_PAGE } from "./front-label";
import { legalMinPt } from "./legal";
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
