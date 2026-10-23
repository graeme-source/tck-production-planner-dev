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

/** Item names run from "Salt" to "Mature cheddar, grated, 2 kg bag": shrink
 *  the heading for long ones so it never pushes the fields off the card. */
export function kanbanNameFontSize(name: string): number {
  const n = name.trim().length;
  if (n <= 18) return 24;
  if (n <= 28) return 20;
  if (n <= 40) return 16;
  if (n <= 60) return 13;
  return 11;
}
