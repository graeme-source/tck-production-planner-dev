/**
 * The label layout engine (pure, tested).
 *
 * Works in printer dots. Every field has a box; its text is wrapped to the
 * box width and must fit the box height. Text starts at the field's MAX size
 * in its preferred width and steps down in quarter points; at each size it
 * tries the narrower widths (Barlow → Semi Condensed → Condensed, but never
 * past the field's `narrowest`) BEFORE going smaller. The smallest size is the field's minimum, never below the
 * legal x-height minimum for that width. If the text still doesn't fit at
 * the minimum in the narrowest width, the label is DOESN'T FIT — and the
 * layout still places every word (running past the box) so the proof shows
 * the overflow. Nothing is ever truncated or dropped.
 *
 * Measuring goes through a TextMeasurer. The real one (fonts.ts) uses the
 * bundled font files' own glyph advances and kerning, and the renderer draws
 * glyphs at exactly the positions measured here — preview and print are one
 * computation.
 *
 * Regions: title band across the top; the cooking steps in a row; an
 * optional thin divider rule; then a left column (storage, dates, barcode at the bottom) and a right
 * column (ingredients, allergen note/may contain/warning, address). Fields
 * stacked in a column shrink together, level by level.
 */
import { dotsToMm, mmToDots, ptToDots } from "@workspace/units";
import { fieldParagraphs, type LabelContent } from "./content";
import { EAN13_QUIET_LEFT, EAN13_QUIET_RIGHT, EAN13_TOTAL_MODULES, largestFittingModule, minModuleDots, moduleChoice, type ModuleChoice } from "./ean13";
import { legalMinPt, PT_STEP, xHeightMmAt } from "./legal";
import type { BodyWeight, FieldKey, FieldStyle, LabelTemplate, WidthVariant } from "./template";
import { allowedWidths, dividerDots, FIELD_LABEL, WIDTH_ORDER } from "./template";
import type { Paragraph, Run } from "./text";

export interface Face {
  width: WidthVariant;
  weight: BodyWeight;
}

export interface FaceMetrics {
  /** All as fractions of the em. descender is positive (below baseline). */
  ascender: number;
  descender: number;
  xHeight: number;
  capHeight: number;
}

export interface TextMeasurer {
  /** Advance width in dots, including letter spacing after every glyph. */
  advance(text: string, face: Face, sizeDots: number, letterSpacingEm: number): number;
  metrics(face: Face): FaceMetrics;
  /** Characters the font can't draw. */
  missingGlyphs(text: string, face: Face): string[];
  /** Where the glyphs' INK actually goes, in dots, relative to the pen start
   *  and baseline: left/right edges (left may be negative), and how far it
   *  reaches above (top) and below (bottom) the baseline. The layout keeps
   *  ink — not just advance widths — inside each box, so nothing printed can
   *  stray into the margin. */
  ink(text: string, face: Face, sizeDots: number, letterSpacingEm: number): InkBox;
}

export interface InkBox { left: number; right: number; top: number; bottom: number }

export interface Rect { x: number; y: number; w: number; h: number }

export interface PlacedRun {
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  face: Face;
  sizeDots: number;
  letterSpacingEm: number;
  /** Drawn white (the step numbers inside their black circles). */
  white?: boolean;
}

export interface FieldLayout {
  key: FieldKey;
  /** For steps, one entry per step box; otherwise one. */
  boxes: Rect[];
  sizePt: number;
  width: WidthVariant;
  /** The smallest size this field was allowed (configured or legal, whichever is bigger). */
  minPt: number;
  legalMinPt: number;
  xHeightMm: number;
  lines: number;
  usedHeight: number;
  fits: boolean;
  runs: PlacedRun[];
}

export interface BarcodeLayout {
  digits: string | null;
  box: Rect;
  module: ModuleChoice;
  /** Left edge of the first bar (after the left quiet zone). */
  x: number;
  barsTop: number;
  barsBottom: number;
  guardBottom: number;
  digitRuns: PlacedRun[];
}

export interface FitProblem {
  field: FieldKey | "barcode" | "content";
  message: string;
  overflowMm?: number;
}

export interface LabelLayout {
  widthDots: number;
  heightDots: number;
  dpi: number;
  fields: FieldLayout[];
  circles: Array<{ cx: number; cy: number; r: number }>;
  barcode: BarcodeLayout;
  /** The column boxes (for the proof overlay). */
  columns: { left: Rect; right: Rect; leftText: Rect };
  /** The thin rule between the steps and the columns (whole dots), or null
   *  when it's switched off. */
  divider: Rect | null;
  /** The black "KEEP FROZEN" band at the top of the storage column (whole
   *  dots), with its white words in `extraRuns` and its snowflakes. */
  banner: { rect: Rect; flakes: Array<{ cx: number; cy: number; r: number }> } | null;
  /** Runs outside the text fields: the banner words (white) and the net
   *  quantity line above the barcode. */
  extraRuns: PlacedRun[];
  fits: boolean;
  problems: FitProblem[];
}

// ── Wrapping ───────────────────────────────────────────────────────────────

interface Seg { text: string; bold: boolean }
type Word = Seg[];

function styleRuns(p: Paragraph, style: FieldStyle): Run[] {
  return p.map(r => ({ text: style.caps ? r.text.toUpperCase() : r.text, bold: style.bold || r.bold }));
}

/** Split runs into words at spaces; a word may mix bold and regular. */
function toWords(runs: Run[]): Word[] {
  const words: Word[] = [];
  let cur: Word = [];
  for (const r of runs) {
    const pieces = r.text.split(/( +)/);
    for (const piece of pieces) {
      if (piece === "") continue;
      if (/^ +$/.test(piece)) {
        if (cur.length) { words.push(cur); cur = []; }
        continue;
      }
      cur.push({ text: piece, bold: r.bold });
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

interface WrapResult {
  lines: Array<Array<{ seg: Seg; x: number }>>;
  /** Right edge of each line's ink (for centring). */
  lineRight: number[];
  /** A single word wider than the box. */
  tooWide: { word: string; widthDots: number } | null;
  /** Tallest ink above / deepest below the baseline, over every line. */
  top: number;
  bottom: number;
}

function faceFor(style: FieldStyle, width: WidthVariant, bold: boolean): Face {
  return { width, weight: bold ? 700 : style.weight };
}

/** Greedy word wrap. A line fits when its INK (not just its advance) stays
 *  between 0 and boxW; a first glyph whose ink starts left of the pen is
 *  nudged right so it never pokes out of the box. */
function wrap(paras: Paragraph[], style: FieldStyle, width: WidthVariant, sizeDots: number, boxW: number, m: TextMeasurer): WrapResult {
  const lines: WrapResult["lines"] = [];
  const lineRight: number[] = [];
  let tooWide: WrapResult["tooWide"] = null;
  let top = 0;
  let bottom = 0;
  const ls = style.letterSpacingEm;
  const segW = (s: Seg) => m.advance(s.text, faceFor(style, width, s.bold), sizeDots, ls);
  const segInk = (s: Seg) => m.ink(s.text, faceFor(style, width, s.bold), sizeDots, ls);
  const space = m.advance(" ", faceFor(style, width, false), sizeDots, ls);
  for (const p of paras) {
    const words = toWords(styleRuns(p, style));
    let line: Array<{ seg: Seg; x: number }> = [];
    let x = 0;
    let right = 0;
    for (const w of words) {
      // The word's advance and ink, relative to its own start.
      let wx = 0;
      let l = Infinity;
      let r = -Infinity;
      for (const seg of w) {
        const k = segInk(seg);
        if (k.right > k.left) { l = Math.min(l, wx + k.left); r = Math.max(r, wx + k.right); }
        top = Math.max(top, k.top);
        bottom = Math.max(bottom, k.bottom);
        wx += segW(seg);
      }
      if (!Number.isFinite(l)) { l = 0; r = wx; }
      const lead = Math.max(0, -l);
      if (lead + r > boxW + 1e-6 && !tooWide) tooWide = { word: w.map(s => s.text).join(""), widthDots: lead + r };
      let start = line.length === 0 ? lead : x + space;
      if (line.length > 0 && start + r > boxW + 1e-6) {
        lines.push(line);
        lineRight.push(right);
        line = [];
        start = lead;
      }
      let cx = start;
      for (const seg of w) {
        line.push({ seg, x: cx });
        cx += segW(seg);
      }
      x = cx;
      right = start + r;
    }
    if (line.length) { lines.push(line); lineRight.push(right); }
  }
  return { lines, lineRight, tooWide, top, bottom };
}

// ── Fitting ────────────────────────────────────────────────────────────────

interface FieldSpec {
  key: FieldKey;
  paras: Paragraph[][]; // one entry per box (steps: three)
  boxes: Rect[];
  /** Left inset of the text inside each box (steps: after the circle). */
  inset: number;
  style: FieldStyle;
}

interface Trial {
  spec: FieldSpec;
  sizePt: number;
  width: WidthVariant;
  wraps: WrapResult[];
  /** Tallest box's INK height: first line's ink top → last line's ink bottom. */
  height: number;
  pitch: number;
  /** Ink above the first baseline / below the last (shared by all boxes, so
   *  the three steps line up). */
  top: number;
  bottom: number;
}

const widthCandidates = (style: FieldStyle): WidthVariant[] => allowedWidths(style);

function legalMinFor(style: FieldStyle, width: WidthVariant, m: TextMeasurer, smallPack: boolean): number {
  // The binding x-height is the smallest of the weights this field uses.
  const xh = Math.min(m.metrics({ width, weight: style.weight }).xHeight, m.metrics({ width, weight: 700 }).xHeight);
  return legalMinPt(xh, smallPack);
}

/** The legal minimum for each field at each width it may use. */
export function legalMinimums(t: LabelTemplate, m: TextMeasurer): Record<FieldKey, Record<WidthVariant, number>> {
  const out = {} as Record<FieldKey, Record<WidthVariant, number>>;
  for (const k of Object.keys(t.fields) as FieldKey[]) {
    out[k] = {} as Record<WidthVariant, number>;
    for (const w of WIDTH_ORDER) out[k][w] = legalMinFor(t.fields[k], w, m, t.page.smallPack);
  }
  return out;
}

/** Raise any field minimum set below the legal minimum (for any width the
 *  field may use) — the settings can never hold an unlawful minimum. */
export function enforceLegalMinimums(t: LabelTemplate, m: TextMeasurer): { template: LabelTemplate; raised: FieldKey[] } {
  const copy: LabelTemplate = JSON.parse(JSON.stringify(t));
  const raised: FieldKey[] = [];
  for (const k of Object.keys(copy.fields) as FieldKey[]) {
    const f = copy.fields[k];
    const legal = Math.max(...widthCandidates(f).map(w => legalMinFor(f, w, m, copy.page.smallPack)));
    if (f.minPt < legal) { f.minPt = legal; raised.push(k); }
    if (f.maxPt < f.minPt) f.maxPt = f.minPt;
  }
  return { template: copy, raised };
}

function sizeAt(style: FieldStyle, level: number, effMin: number): number {
  return Math.max(effMin, Math.max(style.maxPt, effMin) - level * PT_STEP);
}

function trial(spec: FieldSpec, level: number, widthIdx: number, t: LabelTemplate, m: TextMeasurer): Trial {
  const cands = widthCandidates(spec.style);
  const width = cands[Math.min(widthIdx, cands.length - 1)];
  const effMin = Math.max(spec.style.minPt, legalMinFor(spec.style, width, m, t.page.smallPack));
  const sizePt = sizeAt(spec.style, level, effMin);
  const sizeDots = ptToDots(sizePt, t.page.dpi);
  const pitch = spec.style.lineHeight * sizeDots;
  const wraps = spec.boxes.map((b, i) => wrap(spec.paras[i] ?? [], spec.style, width, sizeDots, b.w - spec.inset, m));
  const top = Math.max(0, ...wraps.map(w => w.top));
  const bottom = Math.max(0, ...wraps.map(w => w.bottom));
  const height = Math.max(0, ...wraps.map(w => (w.lines.length ? top + (w.lines.length - 1) * pitch + bottom : 0)));
  return { spec, sizePt, width, wraps, height, pitch, top, bottom };
}

function atFloor(spec: FieldSpec, level: number, widthIdx: number, t: LabelTemplate, m: TextMeasurer): boolean {
  const cands = widthCandidates(spec.style);
  if (widthIdx < cands.length - 1) return false;
  const width = cands[cands.length - 1];
  const effMin = Math.max(spec.style.minPt, legalMinFor(spec.style, width, m, t.page.smallPack));
  return sizeAt(spec.style, level, effMin) <= effMin;
}

/** Find the first level (largest size, then widest) where every field of a
 *  group fits. stack=true: the fields share one column height (stacked with
 *  gaps); false: each field (box) has the whole height to itself.
 *
 *  Fields of a group shrink BIGGEST FIRST, under one falling ceiling: a
 *  field set smaller than the group's biggest keeps its own size (and its
 *  preferred width) until the ceiling comes down to it, then they shrink
 *  together. So an 11 pt deck squeezes down to the 9 pt allergen note before
 *  the note gets any smaller, and 11 pt storage text shrinks before the 10 pt
 *  use-by lines (Graeme, 2026-10-12: bigger storage and ingredients). */
function fitGroup(specs: FieldSpec[], availH: number, stack: boolean, gap: number, t: LabelTemplate, m: TextMeasurer): { trials: Trial[]; fits: boolean } {
  const ok = (trials: Trial[]) => {
    if (trials.some(tr => tr.wraps.some(w => w.tooWide))) return false;
    if (stack) {
      const total = trials.reduce((s, tr) => s + tr.height, 0) + gap * Math.max(0, trials.filter(tr => tr.height > 0).length - 1);
      return total <= availH + 1e-6;
    }
    return trials.every(tr => tr.height <= availH + 1e-6);
  };
  // How many quarter-point levels each field sits below the group's biggest.
  const top = Math.max(...specs.map(s => s.style.maxPt));
  const offsets = specs.map(s => Math.max(0, Math.round((top - s.style.maxPt) / PT_STEP)));
  let last: Trial[] = [];
  for (let level = 0; level < 800; level++) {
    for (let w = 0; w < WIDTH_ORDER.length; w++) {
      // A field still under the ceiling stays at its biggest, widest.
      const at = offsets.map(off => (level - off < 0 ? { level: 0, w: 0 } : { level: level - off, w }));
      const trials = specs.map((s, i) => trial(s, at[i].level, at[i].w, t, m));
      last = trials;
      if (ok(trials)) return { trials, fits: true };
      if (specs.every((s, i) => atFloor(s, at[i].level, at[i].w, t, m))) return { trials, fits: false };
    }
  }
  return { trials: last, fits: false };
}

function place(tr: Trial, top: number): PlacedRun[] {
  const runs: PlacedRun[] = [];
  const { spec } = tr;
  const sizeDots = tr.pitch / spec.style.lineHeight;
  spec.boxes.forEach((box, bi) => {
    const wr = tr.wraps[bi];
    const baseline0 = (top < 0 ? box.y : top) + tr.top;
    const textW = box.w - spec.inset;
    wr.lines.forEach((line, li) => {
      const shift = spec.style.align === "center" ? Math.max(0, (textW - wr.lineRight[li]) / 2) : 0;
      for (const { seg, x } of line) {
        runs.push({
          x: box.x + spec.inset + shift + x,
          y: baseline0 + li * tr.pitch,
          text: seg.text,
          face: faceFor(spec.style, tr.width, seg.bold),
          sizeDots,
          letterSpacingEm: spec.style.letterSpacingEm,
        });
      }
    });
  });
  return runs;
}

function fieldLayout(tr: Trial, boxes: Rect[], top: number, fits: boolean, t: LabelTemplate, m: TextMeasurer): FieldLayout {
  const legal = legalMinFor(tr.spec.style, tr.width, m, t.page.smallPack);
  const xh = Math.min(m.metrics({ width: tr.width, weight: tr.spec.style.weight }).xHeight, m.metrics({ width: tr.width, weight: 700 }).xHeight);
  return {
    key: tr.spec.key,
    boxes,
    sizePt: tr.sizePt,
    width: tr.width,
    minPt: Math.max(tr.spec.style.minPt, legal),
    legalMinPt: legal,
    xHeightMm: xHeightMmAt(tr.sizePt, xh),
    lines: tr.wraps.reduce((s, w) => s + w.lines.length, 0),
    usedHeight: tr.height,
    fits,
    runs: place(tr, top),
  };
}

// ── The whole label ────────────────────────────────────────────────────────

export function layoutLabel(t: LabelTemplate, content: LabelContent, m: TextMeasurer): LabelLayout {
  const { page } = t;
  const dpi = page.dpi;
  const d = (mm: number) => mmToDots(mm, dpi);
  const mm1 = (dots: number) => Math.round(dotsToMm(dots, dpi) * 10) / 10;
  const W = Math.round(d(page.widthMm));
  const H = Math.round(d(page.heightMm));
  const margin = d(page.marginMm);
  const innerX = margin;
  const innerW = W - 2 * margin;
  const problems: FitProblem[] = [];

  // Bands
  const titleBox: Rect = { x: innerX, y: margin, w: innerW, h: d(page.titleBandMm) };
  // Title fitted here (it only needs its band); placed with the fields below.
  const titleSpec: FieldSpec = { key: "title", boxes: [titleBox], paras: [content.title], inset: 0, style: t.fields.title };
  const titleFit = fitGroup([titleSpec], titleBox.h, false, 0, t, m);
  // Optional subtitle: a small centred line just under the title's ink. It
  // pushes the steps and columns down by its own height; with none (the
  // usual case) nothing below moves.
  let subtitleFit: { trials: Trial[]; fits: boolean } | null = null;
  let subtitleBox: Rect | null = null;
  let bandsBottom = titleBox.y + titleBox.h;
  if (content.subtitle?.length && t.fields.subtitle) {
    const y = titleBox.y + titleFit.trials[0].height + d(1.2);
    const box: Rect = { x: innerX, y, w: innerW, h: d(8) };
    subtitleFit = fitGroup([{ key: "subtitle", boxes: [box], paras: [content.subtitle], inset: 0, style: t.fields.subtitle }], box.h, false, 0, t, m);
    subtitleBox = { ...box, h: subtitleFit.trials[0].height };
    bandsBottom = Math.max(bandsBottom, subtitleBox.y + subtitleBox.h);
  }
  const stepsTop = bandsBottom + d(page.bandGapMm);
  const stepsH = d(page.stepsBandMm);
  const stepGap = d(page.columnGapMm);
  // Step-number circle: fixed (stepCircleMm), or — the default — as tall as
  // the steps' text at the size they fit at, worked out in the fitting loop
  // below. The text starts this far right of the circle's left edge.
  const minAutoCircle = d(4);
  const insetFor = (circle: number) => circle + d(page.stepCircleAuto ? 1.5 : 1);
  let circleD = page.stepCircleAuto ? minAutoCircle : d(page.stepCircleMm);
  // Any number of steps (2 by default), widths worked out automatically: a
  // step written as whole lines (step 2's cooking lines, which never wrap)
  // gets exactly the width its longest line needs at the size being tried;
  // the other steps share what's left equally. If every step is whole
  // lines, they're scaled to fill the row.
  const nSteps = content.steps.length;
  const stepSpace = innerW - Math.max(0, nSteps - 1) * stepGap;
  const wholeStep = content.steps.map(ps => ps.some(p => p.some(r => r.text.includes(" "))));
  const stepBoxesFor = (width: WidthVariant, sizeDots: number, stepInset: number): Rect[] => {
    const style = t.fields.steps;
    const need = content.steps.map((ps, i) =>
      wholeStep[i] ? stepInset + Math.max(0, ...ps.map(p => wrap([p], style, width, sizeDots, Infinity, m).lineRight[0] ?? 0)) + 1 : 0);
    const fixed = need.reduce((s, w) => s + w, 0);
    const flexCount = wholeStep.filter(w => !w).length;
    // Wrapping steps share what's left in proportion to how much they say
    // (their one-line length), so a long step 1 isn't squeezed into the same
    // width as a short step 2 (fried chicken's three steps, 2026-10-12).
    const flexLen = content.steps.map((ps, i) =>
      wholeStep[i] ? 0 : Math.max(1, ps.reduce((s, p) => s + (wrap([p], style, width, sizeDots, Infinity, m).lineRight[0] ?? 0), 0)));
    const flexTotal = flexLen.reduce((s, x) => s + x, 0);
    const minWord = content.steps.map((ps, i) =>
      wholeStep[i] ? 0 : Math.max(0, ...wrap(ps, style, width, sizeDots, 1, m).lineRight) + 1);
    const minWordTotal = minWord.reduce((s, x) => s + x, 0);
    const widths = flexCount > 0
      // Each wrapping step gets its circle's room and its longest word, then
      // a share of the rest in proportion to its length.
      ? need.map((w, i) => (wholeStep[i] ? w : stepInset + minWord[i] + Math.max(0, ((stepSpace - fixed - flexCount * stepInset - minWordTotal) * flexLen[i]) / flexTotal)))
      : need.map(w => (fixed > 0 ? (w * stepSpace) / fixed : stepSpace / Math.max(1, nSteps)));
    const boxes: Rect[] = [];
    let x = innerX;
    for (const w of widths) { boxes.push({ x, y: stepsTop, w, h: stepsH }); x += w + stepGap; }
    return boxes;
  };

  // Columns
  const colTop = stepsTop + stepsH + d(page.bandGapMm);

  const colH = H - margin - colTop;
  const leftW = innerW * (page.columnSplitPct / 100);
  const left: Rect = { x: innerX, y: colTop, w: leftW, h: colH };
  const right: Rect = { x: innerX + leftW + d(page.columnGapMm), y: colTop, w: innerW - leftW - d(page.columnGapMm), h: colH };

  // Barcode block at the bottom of the left column. Space is reserved even
  // when there's no barcode yet, so adding one never re-flows the label.
  //
  // Quiet zones are blank by definition, so they may sit where ink can't
  // (2026-10-12, to give the ingredients more width): the LEFT quiet zone
  // (11 modules) may run into the page margin — but not off the label, and
  // the first human-readable digit, printed in that zone, keeps its ink
  // inside the margin line — and the RIGHT quiet zone (7 modules) may run
  // into the column gap, ending before the right column's text starts. The
  // bars themselves stay inside the ink-safe area. The module is the
  // requested size if it fits like that, else the widest that does (the
  // proof states the real printed %), never under 80%.
  // Human-readable digits: about 2.4 mm tall at nominal size, scaled with the
  // bars; each must fit under its own 7 modules; never under the legal minimum.
  const digitFace: Face = { width: "normal", weight: 500 };
  const digitMet = m.metrics(digitFace);
  const unitInk = m.ink("0123456789", digitFace, 1, 0);
  const unitDigitW = Math.max(...[..."0123456789"].map(c => m.advance(c, digitFace, 1, 0)));
  const digitSizeFor = (moduleDots: number) => {
    const byHeight = d(2.4 * (moduleChoice(moduleDots, dpi) as { magnificationPct: number }).magnificationPct / 100) / Math.max(unitInk.top, 0.01);
    const byWidth = (6.5 * moduleDots) / Math.max(unitDigitW, 0.01);
    return Math.max(ptToDots(legalMinPt(digitMet.xHeight, page.smallPack), dpi), Math.min(byHeight, byWidth));
  };
  // Where the bars start: after the full left quiet zone (measured from the
  // label edge), and far enough in that the first digit — centred 4 modules
  // left of the bars — stays inside the margin line.
  const barsStartFor = (moduleDots: number) =>
    Math.ceil(Math.max(EAN13_QUIET_LEFT * moduleDots, innerX + 4 * moduleDots + (unitDigitW * digitSizeFor(moduleDots)) / 2));
  const barcodeFits = (moduleDots: number) =>
    barsStartFor(moduleDots) + (95 + EAN13_QUIET_RIGHT) * moduleDots <= Math.floor(right.x);
  const chosenMd = largestFittingModule(dpi, page.barcodeSizePct, barcodeFits);
  const minMd = minModuleDots(dpi);
  const module: ModuleChoice = chosenMd != null ? moduleChoice(chosenMd, dpi) : {
    ok: false,
    reason: `The barcode doesn't fit even at 80% (${dotsToMm(minMd, dpi).toFixed(2)} mm bars) — widen the left column`,
    neededMm: dotsToMm(barsStartFor(minMd) + (95 + EAN13_QUIET_RIGHT) * minMd - innerX, dpi),
  };
  const md = module.ok ? module.moduleDots : minMd;
  const barsX = barsStartFor(md);
  const digitSize = digitSizeFor(md);
  const digitTop = unitInk.top * digitSize;
  const digitBottom = unitInk.bottom * digitSize;
  const barsH = Math.round(d(page.barcodeHeightMm));
  const digitGap = Math.max(2, md);
  const barcodeBlockH = barsH + digitGap + digitTop + digitBottom;
  // Whole dots, rounded UP the column, so the block can't creep into the margin.
  const barcodeTop = Math.floor(left.y + left.h - barcodeBlockH);
  // The box spans the quiet zones: x is where the left one starts (maybe in
  // the margin), so the bars begin exactly at barsX.
  const barcode = layoutBarcode(content.barcode, { x: barsX - EAN13_QUIET_LEFT * md, y: barcodeTop, w: EAN13_TOTAL_MODULES * md, h: barcodeBlockH }, module, barsH, digitGap, digitTop, digitFace, digitSize, m);
  if (!module.ok) problems.push({ field: "barcode", message: module.reason, overflowMm: Math.round((module.neededMm - dotsToMm(right.x - innerX, dpi)) * 10) / 10 });
  else if (module.moduleDots < Math.min(Math.round(d((0.33 * page.barcodeSizePct) / 100)), Math.floor(d(0.66)))) {
    // The asked-for size didn't fit: say so rather than shrink it silently.
    problems.push({ field: "barcode", message: `The barcode only fits at ${module.magnificationPct}% (asked for ${page.barcodeSizePct}%) — widen the left column or ask for a smaller size` });
  }
  // Net quantity ("500g"): a big bold line just above the barcode, at its
  // set size (smaller only if it's wider than the column). Its room comes
  // off the storage/dates space.
  const extraRuns: PlacedRun[] = [];
  let netTop = barcodeTop;
  if (content.netQuantity?.length) {
    const face: Face = { width: "normal", weight: 700 };
    const text = content.netQuantity[0].map(r => r.text).join("");
    let size = ptToDots(t.netQuantity.sizePt, dpi);
    const w0 = m.ink(text, face, size, 0);
    if (w0.right - Math.min(0, w0.left) > left.w) size *= left.w / (w0.right - Math.min(0, w0.left));
    const ink = m.ink(text, face, size, 0);
    netTop = Math.floor(barcodeTop - d(1.5) - (ink.top + ink.bottom));
    extraRuns.push({ x: left.x - Math.min(0, ink.left), y: netTop + ink.top, text, face, sizeDots: size, letterSpacingEm: 0 });
  }
  const leftText: Rect = { x: left.x, y: left.y, w: left.w, h: Math.max(0, netTop - d(page.fieldGapMm) - left.y) };

  // Missing glyphs anywhere = can't print that character.
  const allParas: Array<[FieldKey, Paragraph[]]> = [
    ["title", content.title], ["subtitle", content.subtitle ?? []], ["steps", content.steps.flat()],
    ["headings", [...content.storageHeading, ...content.ingredientsHeading]],
    ["storage", content.storage], ["dates", content.dates],
    ["ingredients", content.ingredients], ["allergenInfo", content.allergenInfo], ["address", content.address],
  ];
  for (const [key, paras] of allParas) {
    const st = t.fields[key];
    if (!st) continue;
    const missing = new Set<string>();
    for (const p of paras) for (const r of styleRuns(p, st)) {
      for (const ch of m.missingGlyphs(r.text, faceFor(st, st.width, r.bold))) missing.add(ch);
    }
    if (missing.size) problems.push({ field: key, message: `${FIELD_LABEL[key]}: the font has no ${[...missing].map(c => `“${c}”`).join(" ")} — retype it`, });
  }

  const spec = (key: FieldKey, boxes: Rect[], paras: Paragraph[][], inset = 0): FieldSpec => ({ key, boxes, paras, inset, style: t.fields[key] });
  const fieldGap = d(page.fieldGapMm);
  const fields: FieldLayout[] = [];

  // Title — its own band.
  {
    const g = titleFit;
    fields.push(fieldLayout(g.trials[0], [titleBox], -1, g.fits, t, m));
    if (!g.fits) problems.push(overflowProblem(g.trials[0], titleBox.h, mm1));
  }
  if (subtitleFit && subtitleBox) {
    fields.push(fieldLayout(subtitleFit.trials[0], [subtitleBox], subtitleBox.y, subtitleFit.fits, t, m));
    if (!subtitleFit.fits) problems.push(overflowProblem(subtitleFit.trials[0], d(8), mm1));
  }
  // Steps — one size for all of them; the boxes are re-worked for every size
  // tried (bigger first, narrower widths before smaller), so the whole-line
  // step always gets exactly the room it needs.
  let stepBoxes: Rect[] = [];
  if (nSteps > 0) {
    const style = t.fields.steps;
    const cands = widthCandidates(style);
    let chosen: Trial | null = null;
    let fits = false;
    outer: for (let level = 0; level < 400; level++) {
      for (let w = 0; w < WIDTH_ORDER.length; w++) {
        const width = cands[Math.min(w, cands.length - 1)];
        const effMin = Math.max(style.minPt, legalMinFor(style, width, m, page.smallPack));
        const sizeDots = ptToDots(sizeAt(style, level, effMin), dpi);
        // Auto circles: start small and grow to the text's height until the
        // two agree (a bigger circle narrows the text, which can add a line,
        // which makes the circle bigger…). Only ever grows, capped at the
        // band, so it settles in a step or two. The trial kept is always the
        // one laid out with the circle that's drawn — nothing can overlap.
        let circle = page.stepCircleAuto ? minAutoCircle : d(page.stepCircleMm);
        let boxes: Rect[] = [];
        let tr!: Trial;
        for (let i = 0; i < 6; i++) {
          boxes = stepBoxesFor(width, sizeDots, insetFor(circle));
          tr = trial(spec("steps", boxes, content.steps, insetFor(circle)), level, w, t, m);
          if (!page.stepCircleAuto) break;
          // As tall as the text, but never more than two lines' worth: a
          // three- or four-line step (fried chicken) would otherwise get a
          // circle so wide it squeezes its own text smaller.
          const twoLines = tr.top + tr.pitch + tr.bottom;
          const want = Math.min(stepsH, twoLines, Math.max(minAutoCircle, tr.height));
          if (want <= circle + 0.5) break;
          circle = want;
        }
        chosen = tr;
        stepBoxes = boxes;
        circleD = circle;
        const stepInset = insetFor(circle);
        const narrowOk = boxes.every(b => b.w > stepInset);
        if (narrowOk && !tr.wraps.some(x => x.tooWide) && tr.height <= stepsH + 1e-6) { fits = true; break outer; }
        if (atFloor(tr.spec, level, w, t, m)) break outer;
      }
    }
    if (chosen) {
      fields.push(fieldLayout(chosen, stepBoxes, -1, fits, t, m));
      if (!fits) problems.push(overflowProblem(chosen, stepsH, mm1));
    }
  }
  // The divider: full inner width, whole dots thick (at least one) on
  // whole-dot rows so it prints as a clean, even line. Centred between the
  // bottom of the steps' INK (or the band, if there are no steps) and the
  // top of the columns, so the white space either side looks equal however
  // much of the band the steps use. Never above the steps band's text, never
  // into the columns.
  let divider: Rect | null = null;
  if (page.dividerOn) {
    const h = dividerDots(page);
    const stepsField = fields.find(f => f.key === "steps");
    // The step-number circles count as ink too.
    const above = stepsField && stepsField.lines > 0
      ? Math.min(stepsTop + Math.max(stepsField.usedHeight, circleD), stepsTop + stepsH)
      : stepsTop + stepsH;
    const y = Math.max(Math.ceil(above), Math.min(Math.floor(colTop) - h, Math.round((above + colTop) / 2 - h / 2)));
    divider = { x: Math.round(innerX), y, w: Math.round(innerX + innerW) - Math.round(innerX), h };
  }
  const circles = stepBoxes.map(b => ({ cx: b.x + circleD / 2, cy: b.y + circleD / 2, r: circleD / 2 }));
  // Step numbers, white in the black circles.
  const numFace: Face = { width: "normal", weight: 700 };
  // A big bold number: cap height about half the circle.
  const numSize = circleD * (page.stepCircleAuto ? 0.72 : 0.7);
  const numMet = m.metrics(numFace);
  const numberRuns: PlacedRun[] = circles.map((c, i) => {
    const w = m.advance(String(i + 1), numFace, numSize, 0);
    return { x: c.cx - w / 2, y: c.cy + (numMet.capHeight * numSize) / 2, text: String(i + 1), face: numFace, sizeDots: numSize, letterSpacingEm: 0, white: true };
  });

  // Columns — stacked fields shrinking together.
  // `bottomKey` sits at the foot of the column when everything fits (the
  // address, bottom right, as on Graeme's label).
  const stackColumn = (keys: FieldKey[], box: Rect, bottomKey?: FieldKey) => {
    const specs = keys.map(k => spec(k, [box], [fieldParagraphs(content, k)]));
    const g = fitGroup(specs, box.h, true, fieldGap, t, m);
    let y = box.y;
    let overflowField: FieldKey | null = null;
    for (const tr of g.trials) {
      if (g.fits && tr.spec.key === bottomKey) y = Math.max(y, box.y + box.h - tr.height);
      const fieldBox: Rect = { x: box.x, y, w: box.w, h: tr.height };
      if (!overflowField && y + tr.height > box.y + box.h + 1e-6) overflowField = tr.spec.key;
      fields.push(fieldLayout(tr, [fieldBox], y, g.fits, t, m));
      if (tr.height > 0) y += tr.height + fieldGap;
    }
    if (!g.fits) {
      const used = y - fieldGap - box.y;
      const tooWide = g.trials.find(tr => tr.wraps.some(w => w.tooWide));
      if (tooWide) problems.push(overflowProblem(tooWide, box.h, mm1));
      else {
        const over = mm1(used - box.h);
        const f = overflowField ?? keys[keys.length - 1];
        problems.push({
          field: f,
          message: `${FIELD_LABEL[f]} runs ${over} mm past the bottom of its column, even at the smallest allowed size in the narrowest width`,
          overflowMm: over,
        });
      }
    }
  };
  // Section headings — one shared style at a FIXED size (level 0 = its
  // biggest, never narrowed), placed first at the top of each column; their
  // height is reserved and only the text underneath shrinks to fit.
  // 1 mm: at 0.5 mm the heading almost touched the text under it — closer
  // than the body lines are to each other (Graeme, 2026-10-12).
  const headingGap = d(1);
  const headingBoxes: Rect[] = [];
  const headingRuns: PlacedRun[] = [];
  let headingTrial: Trial | null = null;
  let headingsFit = true;
  const placeHeading = (paras: Paragraph[], col: Rect): number => {
    if (paras.length === 0) return 0;
    const tr = trial(spec("headings", [col], [paras]), 0, 0, t, m);
    headingTrial = tr;
    const box: Rect = { x: col.x, y: col.y, w: col.w, h: tr.height };
    headingBoxes.push(box);
    headingRuns.push(...fieldLayout(tr, [box], col.y, true, t, m).runs);
    if (tr.wraps.some(w => w.tooWide)) { headingsFit = false; problems.push(overflowProblem(tr, col.h, mm1)); }
    return tr.height + headingGap;
  };
  // The storage band (e.g. "KEEP FROZEN"): solid black, whole dots, white
  // bold capitals with a drawn snowflake either side, at the top of the
  // storage column; the heading (if any) and the storage text follow.
  let banner: LabelLayout["banner"] = null;
  let bannerH = 0;
  if (content.storageBanner) {
    const h = Math.round(d(t.storageBanner.heightMm));
    const rect: Rect = { x: Math.round(leftText.x), y: Math.round(leftText.y), w: Math.floor(leftText.w), h };
    const face: Face = { width: "normal", weight: 700 };
    const ls = 0.04;
    const text = content.storageBanner;
    const flakeD = t.storageBanner.snowflake ? h * 0.72 : 0;
    const pad = h * 0.3;
    const cap = m.metrics(face).capHeight;
    let size = (h * 0.56) / cap;
    const avail = rect.w - 2 * pad - (flakeD ? 2 * (flakeD + pad) : 0);
    const w0 = m.advance(text, face, size, ls);
    if (w0 > avail) size *= avail / w0;
    const tw = m.advance(text, face, size, ls);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + h / 2;
    extraRuns.push({ x: cx - tw / 2, y: cy + (cap * size) / 2, text, face, sizeDots: size, letterSpacingEm: ls, white: true });
    const flakes = flakeD ? [-1, 1].map(s => ({ cx: cx + s * (tw / 2 + pad + flakeD / 2), cy, r: flakeD / 2 })) : [];
    banner = { rect, flakes };
    bannerH = h + d(1.5);
  }
  const leftHead = bannerH + placeHeading(content.storageHeading, { ...leftText, y: leftText.y + bannerH, h: Math.max(0, leftText.h - bannerH) });
  const rightHead = placeHeading(content.ingredientsHeading, right);
  if (headingTrial) {
    const hl = fieldLayout(headingTrial, headingBoxes, -1, headingsFit, t, m);
    fields.push({ ...hl, boxes: headingBoxes, runs: headingRuns, lines: headingBoxes.length, usedHeight: Math.max(...headingBoxes.map(b => b.h)) });
  }

  stackColumn(["storage", "dates"], { ...leftText, y: leftText.y + leftHead, h: Math.max(0, leftText.h - leftHead) });
  stackColumn(["ingredients", "allergenInfo", "address"], { ...right, y: right.y + rightHead, h: Math.max(0, right.h - rightHead) }, "address");

  // Step numbers ride along with the steps field's runs.
  const steps = fields.find(f => f.key === "steps");
  if (steps) steps.runs.push(...numberRuns);

  return {
    widthDots: W,
    heightDots: H,
    dpi,
    fields,
    circles,
    barcode,
    columns: { left, right, leftText },
    divider,
    banner,
    extraRuns,
    fits: problems.length === 0,
    problems,
  };
}

function overflowProblem(tr: Trial, availH: number, mm1: (d: number) => number): FitProblem {
  const label = FIELD_LABEL[tr.spec.key];
  const wide = tr.wraps.find(w => w.tooWide)?.tooWide;
  if (wide) {
    return { field: tr.spec.key, message: `${label}: “${wide.word}” is too wide for its box even at the smallest size — shorten it or widen the box`, overflowMm: mm1(wide.widthDots - (tr.spec.boxes[0].w - tr.spec.inset)) };
  }
  const over = mm1(tr.height - availH);
  return { field: tr.spec.key, message: `${label} is ${over} mm too tall for its box, even at the smallest allowed size in the narrowest width`, overflowMm: over };
}

/** EAN-13 geometry: bars start after an 11-module quiet zone (7 modules
 *  clear on the right — the box is at least 113 modules wide). Digits sit
 *  BELOW the bars with a gap; only the guard bars extend down (5 modules,
 *  the standard extension) between the digit groups. */
function layoutBarcode(
  digits: string | null, box: Rect, module: ModuleChoice, barsH: number, digitGap: number, digitTop: number,
  digitFace: Face, digitSize: number, m: TextMeasurer,
): BarcodeLayout {
  const md = module.ok ? module.moduleDots : 0;
  const x = Math.ceil(box.x + 11 * md);
  const barsTop = Math.ceil(box.y);
  const barsBottom = barsTop + barsH;
  const guardBottom = barsBottom + 5 * md;
  const digitRuns: PlacedRun[] = [];
  if (digits && module.ok) {
    const baseline = barsBottom + digitGap + digitTop;
    const put = (text: string, centreX: number) => {
      const w = m.advance(text, digitFace, digitSize, 0);
      digitRuns.push({ x: centreX - w / 2, y: baseline, text, face: digitFace, sizeDots: digitSize, letterSpacingEm: 0 });
    };
    // First digit in the left quiet zone; then 6 under each half, each digit
    // centred under its own 7 modules.
    put(digits[0], x - 4 * md);
    for (let i = 0; i < 6; i++) put(digits[1 + i], x + (3 + i * 7 + 3.5) * md);
    for (let i = 0; i < 6; i++) put(digits[7 + i], x + (50 + i * 7 + 3.5) * md);
  }
  return { digits, box, module, x, barsTop, barsBottom, guardBottom, digitRuns };
}
