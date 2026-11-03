/**
 * Kanban card print layout — pure geometry, no rendering (objective C).
 *
 * The card (first built 28 Mar 2026) is an A6 landscape card, 148 x 105 mm,
 * printed on ONE sheet and folded in half: the front on the top half, the
 * back on the bottom half turned upside down. Folded along the middle, with
 * the blank sides inside, both faces read the right way up. Two A6
 * landscape halves stacked = one A5 portrait sheet (148 x 210 mm).
 *
 * The old popup printed the two faces as two separate A6 pages and left the
 * size to the browser and printer, so every desktop printed it differently
 * (and the team fell back to screenshots). Everything here is in PDF points
 * (1 pt = 1/72 inch) so the PDF is the exact physical size.
 *
 * Two sheet options:
 *   a5 — the A5 sheet itself (A5 paper in the tray, print at Actual size).
 *   a4 — the same A5 card centred on A4 with crop marks, for a printer that
 *        only has A4 in: print at Actual size, trim on the marks, fold.
 */

export const PT_PER_MM = 72 / 25.4;

export const mm = (v: number): number => v * PT_PER_MM;

/** ISO 216 portrait sizes in points (width x height), rounded to 0.01 pt. */
export const PAPER_PT = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  A6: { width: 297.64, height: 419.53 },
} as const;

export type PaperName = keyof typeof PAPER_PT;
export type Orientation = "portrait" | "landscape";

export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Line { x1: number; y1: number; x2: number; y2: number }

export function pageSize(paper: PaperName, orientation: Orientation = "portrait"): Size {
  const p = PAPER_PT[paper];
  return orientation === "landscape" ? { width: p.height, height: p.width } : { width: p.width, height: p.height };
}

export type KanbanSheet = "a5" | "a4";

export const KANBAN_SHEETS: readonly KanbanSheet[] = ["a5", "a4"];

/** Unprinted border inside each face: desktop printers can't print the last
 *  ~4 mm of the sheet, so colour stops short of the edge evenly instead of
 *  being clipped unevenly by whichever printer it goes through. */
export const FACE_BLEED_INSET_MM = 4;
/** Text and QR stay this far inside each face's coloured area. */
export const FACE_CONTENT_PADDING_MM = 5;

export interface KanbanSheetLayout {
  sheet: KanbanSheet;
  page: Size;
  /** The A5 card area on the page (the whole page for a5). */
  card: Rect;
  /** Each face is A6 landscape. Front = top half, upright. */
  front: Rect;
  /** Back = bottom half, drawn rotated 180° so it reads correctly once folded. */
  back: Rect;
  backRotationDeg: 180;
  /** Coloured area of each face (inset from the sheet edges, not the fold). */
  frontFill: Rect;
  backFill: Rect;
  /** The faint dashed fold line across the middle of the card. */
  fold: Line;
  /** Corner trim marks, outside the card area (a4 only). */
  cropMarks: Line[];
}

const round = (v: number): number => Math.round(v * 100) / 100;

function cropMarksFor(card: Rect, gap: number, length: number): Line[] {
  const xs = [card.x, card.x + card.width];
  const ys = [card.y, card.y + card.height];
  const marks: Line[] = [];
  for (const x of xs) {
    for (const y of ys) {
      const dx = x === card.x ? -1 : 1;
      const dy = y === card.y ? -1 : 1;
      // Horizontal mark beside the corner, vertical mark above/below it.
      marks.push({ x1: round(x + dx * gap), y1: round(y), x2: round(x + dx * (gap + length)), y2: round(y) });
      marks.push({ x1: round(x), y1: round(y + dy * gap), x2: round(x), y2: round(y + dy * (gap + length)) });
    }
  }
  return marks;
}

export function kanbanSheetLayout(sheet: KanbanSheet): KanbanSheetLayout {
  const a5 = pageSize("A5", "portrait");
  const page = sheet === "a4" ? pageSize("A4", "portrait") : a5;
  const card: Rect = {
    x: round((page.width - a5.width) / 2),
    y: round((page.height - a5.height) / 2),
    width: a5.width,
    height: a5.height,
  };
  const faceHeight = round(card.height / 2);
  const front: Rect = { x: card.x, y: card.y, width: card.width, height: faceHeight };
  const back: Rect = { x: card.x, y: round(card.y + faceHeight), width: card.width, height: faceHeight };
  const inset = mm(FACE_BLEED_INSET_MM);
  // Inset on the three outer edges; flush at the fold so the colour meets it.
  const frontFill: Rect = { x: round(front.x + inset), y: round(front.y + inset), width: round(front.width - 2 * inset), height: round(front.height - inset) };
  const backFill: Rect = { x: round(back.x + inset), y: back.y, width: round(back.width - 2 * inset), height: round(back.height - inset) };
  const foldY = back.y;
  return {
    sheet,
    page,
    card,
    front,
    back,
    backRotationDeg: 180,
    frontFill,
    backFill,
    fold: { x1: card.x, y1: foldY, x2: round(card.x + card.width), y2: foldY },
    cropMarks: sheet === "a4" ? cropMarksFor(card, mm(2), mm(8)) : [],
  };
}

/**
 * One SVG path drawing every dark module of a QR code as a unit square, so
 * the code is vector in the PDF (crisp at any print resolution, no image to
 * fail to load). viewBox is "0 0 size size" plus the quiet zone.
 */
export function qrModulesPath(size: number, isDark: (row: number, col: number) => boolean, quiet = 0): string {
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!isDark(r, c)) { c++; continue; }
      // Merge horizontal runs into one rectangle — keeps the PDF small.
      let run = 1;
      while (c + run < size && isDark(r, c + run)) run++;
      parts.push(`M${c + quiet} ${r + quiet}h${run}v1h-${run}z`);
      c += run;
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Front-face type (#353). Printed on A5 the old sizes (6.5 pt labels, 10.5 pt
// values) read as small and hard to see from arm's length, and the bottom of
// the face was empty. Everything is now ~1.6x bigger and the four fields
// spread to fill the face. Long names and long values shrink (and wrap to
// at most two lines) so nothing can run off the face — sizes are worked out
// here from the real Helvetica glyph widths, not guessed per character count.
// ---------------------------------------------------------------------------

/** Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126, from the
 *  standard AFM metrics react-pdf itself uses. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** Anything outside ASCII (accents, dashes, £) — a deliberately wide guess. */
const WIDE_GLYPH = 778;
/** Fit to 96% of the measured width so rounding in the renderer never tips
 *  a line over. */
const FIT_SAFETY = 0.96;

/** Width in points of `text` set in Helvetica-Bold at `sizePt`. */
export function boldTextWidthPt(text: string, sizePt: number): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code >= 32 && code <= 126 ? HELVETICA_BOLD_WIDTHS[code - 32] : WIDE_GLYPH;
  }
  return (units / 1000) * sizePt;
}

/** Lines `text` takes when word-wrapped into `widthPt` (a word longer than
 *  the line is broken across lines, as the renderer does). */
export function wrappedLineCount(text: string, sizePt: number, widthPt: number): number {
  const width = widthPt * FIT_SAFETY;
  const space = boldTextWidthPt(" ", sizePt);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = boldTextWidthPt(word, sizePt);
    if (w > width) {
      // Overlong word: starts a fresh line and spills over whole lines.
      if (used > 0) lines++;
      const spill = Math.ceil(w / width);
      lines += spill - 1;
      used = w - (spill - 1) * width;
      continue;
    }
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else { lines++; used = w; }
  }
  return lines;
}

/** Largest size (0.5 pt steps, maxPt down to minPt) at which `text` fits
 *  `widthPt` in at most `maxLines` lines; minPt when nothing fits. */
export function fitFontSize(text: string, opts: { maxPt: number; minPt: number; widthPt: number; maxLines: number }): number {
  for (let size = opts.maxPt; size >= opts.minPt; size -= 0.5) {
    if (wrappedLineCount(text, size, opts.widthPt) <= opts.maxLines) return size;
  }
  return opts.minPt;
}

/** Break points the PDF may use inside a word (react-pdf hyphenation
 *  callback). Ordinary words are kept whole — no "Whole-sale" — but a word
 *  too long for a line (a long code, no spaces) is offered a break every
 *  few letters so it wraps instead of running off the card. */
export function kanbanWordPieces(word: string): string[] {
  const LONG = 14;
  const PIECE = 4;
  if (word.length <= LONG) return [word];
  const pieces: string[] = [];
  for (let i = 0; i < word.length; i += PIECE) pieces.push(word.slice(i, i + PIECE));
  return pieces;
}

/** Front-face type sizes in points. Line heights are set explicitly in the
 *  PDF so the height maths below matches what is drawn. */
export const KANBAN_FRONT_TYPE = {
  nameMaxPt: 26,
  /** A name keeps to one line down to this size… */
  nameOneLineMinPt: 18,
  /** …then wraps to two lines, no bigger than this (so a two-line heading
   *  doesn't eat the room the fields need). */
  nameTwoLineMaxPt: 20,
  nameMinPt: 14,
  nameMaxLines: 2,
  nameLineHeight: 1.1,
  subtitlePt: 8,
  labelPt: 9.5,
  valueMaxPt: 17,
  /** Values shrink to here before the name gives way. */
  valueComfortPt: 14,
  valueMinPt: 10,
  valueMaxLines: 2,
  valueLineHeight: 1.15,
  partPt: 12,
  footerPt: 9,
  qrLabelPt: 9,
  /** Line height used for single-line text (labels, subtitle, part #). */
  lineHeight: 1.2,
} as const;

/** Front-face geometry in millimetres (the PDF uses the same constants). */
export const KANBAN_FRONT_MM = {
  headerPadTop: 4,
  headerPadBottom: 3.5,
  subtitleGap: 0.8,
  bodyPadTop: 3,
  bodyPadBottom: 2.5,
  qrSize: 52,
  qrGap: 4,
  footerHeight: 8,
  labelGap: 0.6,
  fieldRulePad: 1.2,
} as const;

/** Green border round the front face, in points (inside the coloured area). */
export const KANBAN_FRONT_BORDER_PT = 1.5;

export interface KanbanFrontField {
  label: string;
  value: string;
  /** Supplier part number, printed on its own line under the value. */
  part: string | null;
}

export interface KanbanFrontFieldLayout extends KanbanFrontField {
  valuePt: number;
  /** Lines drawn (never more than valueMaxLines). */
  valueLines: number;
  /** True only for absurd text that won't fit two lines even at the minimum
   *  size: the PDF cuts it at two lines with an ellipsis. */
  clipped: boolean;
  /** Height in points of this field (label + value + part + rule). */
  height: number;
}

export interface KanbanFrontLayout {
  namePt: number;
  /** Lines drawn (never more than nameMaxLines). */
  nameLines: number;
  /** As for a field: cut at two lines with an ellipsis rather than overflow. */
  nameClipped: boolean;
  headerHeight: number;
  fields: KanbanFrontFieldLayout[];
  /** Width in points the field text column has (beside the QR code). */
  fieldColumnWidth: number;
  /** Height the fields share, between header and footer. */
  fieldsAvailableHeight: number;
  /** Height the fields need at the chosen sizes (≤ available when `fits`). */
  fieldsHeight: number;
  fits: boolean;
}

function fieldHeight(valuePt: number, valueLines: number, hasPart: boolean): number {
  const T = KANBAN_FRONT_TYPE;
  return T.labelPt * T.lineHeight + mm(KANBAN_FRONT_MM.labelGap)
    + valueLines * valuePt * T.valueLineHeight
    + (hasPart ? T.partPt * T.lineHeight : 0)
    + mm(KANBAN_FRONT_MM.fieldRulePad) + 0.75;
}

/**
 * Sizes for everything on the front face of one card. The name gets the
 * biggest size that fits one line across the face (two lines, smaller, for
 * a long name); each field value the biggest that fits two lines beside
 * the QR code. If the four fields then need more height than the face has,
 * the values step down together, then the name, until everything fits —
 * so one awkward value never pushes the rest off the card.
 */
export function kanbanFrontLayout(name: string, fields: KanbanFrontField[], sheet: KanbanSheet = "a5"): KanbanFrontLayout {
  const T = KANBAN_FRONT_TYPE;
  const M = KANBAN_FRONT_MM;
  const fill = kanbanSheetLayout(sheet).frontFill;
  const innerHeight = fill.height - 2 * KANBAN_FRONT_BORDER_PT;
  const contentWidth = fill.width - 2 * KANBAN_FRONT_BORDER_PT - 2 * mm(FACE_CONTENT_PADDING_MM);
  const fieldColumnWidth = contentWidth - mm(M.qrSize) - mm(M.qrGap);

  const fitName = (maxPt: number) => {
    const oneLine = maxPt >= T.nameOneLineMinPt
      ? fitFontSize(name, { maxPt, minPt: T.nameOneLineMinPt, widthPt: contentWidth, maxLines: 1 })
      : null;
    const pt = oneLine !== null && wrappedLineCount(name, oneLine, contentWidth) === 1
      ? oneLine
      : fitFontSize(name, { maxPt: Math.min(maxPt, T.nameTwoLineMaxPt), minPt: T.nameMinPt, widthPt: contentWidth, maxLines: T.nameMaxLines });
    const lines = wrappedLineCount(name, pt, contentWidth);
    return { pt, lines: Math.min(lines, T.nameMaxLines), clipped: lines > T.nameMaxLines };
  };
  const headerFor = (pt: number, lines: number) =>
    mm(M.headerPadTop) + lines * pt * T.nameLineHeight + mm(M.subtitleGap) + T.subtitlePt * T.lineHeight + mm(M.headerPadBottom);

  const layoutFields = (valueMaxPt: number) => fields.map((f) => {
    const valuePt = fitFontSize(f.value, { maxPt: valueMaxPt, minPt: T.valueMinPt, widthPt: fieldColumnWidth, maxLines: T.valueMaxLines });
    const lines = wrappedLineCount(f.value, valuePt, fieldColumnWidth);
    const valueLines = Math.min(lines, T.valueMaxLines);
    return { ...f, valuePt, valueLines, clipped: lines > T.valueMaxLines, height: fieldHeight(valuePt, valueLines, Boolean(f.part)) };
  });

  let { pt: namePt, lines: nameLines, clipped: nameClipped } = fitName(T.nameMaxPt);
  let valueMax: number = T.valueMaxPt;
  for (;;) {
    const headerHeight = headerFor(namePt, nameLines);
    const fieldsAvailableHeight = innerHeight - headerHeight - mm(M.footerHeight) - mm(M.bodyPadTop) - mm(M.bodyPadBottom);
    const laid = layoutFields(valueMax);
    const fieldsHeight = laid.reduce((sum, f) => sum + f.height, 0);
    const fits = fieldsHeight <= fieldsAvailableHeight;
    if (fits || (valueMax <= T.valueMinPt && namePt <= T.nameMinPt)) {
      return { namePt, nameLines, nameClipped, headerHeight, fields: laid, fieldColumnWidth, fieldsAvailableHeight, fieldsHeight, fits };
    }
    // Values give way first (to a still-readable size), then the name, then
    // the values again down to their minimum.
    if (valueMax > T.valueComfortPt) valueMax -= 0.5;
    else if (namePt > T.nameMinPt) ({ pt: namePt, lines: nameLines, clipped: nameClipped } = fitName(namePt - 0.5));
    else valueMax -= 0.5;
  }
}

/** Item names run from "Salt" to "Mature cheddar, grated, 2 kg bag": the
 *  heading shrinks (and wraps to two lines) for long ones so it never runs
 *  off the face or pushes the fields off the card. */
export function kanbanNameFontSize(name: string, sheet: KanbanSheet = "a5"): number {
  return kanbanFrontLayout(name, [], sheet).namePt;
}
