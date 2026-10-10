/**
 * The label layout engine (pure, tested).
 *
 * Works in printer dots. Every field has a box; its text is wrapped to the
 * box width and must fit the box height. Text starts at the field's MAX size
 * in its preferred width and steps down in quarter points; at each size it
 * tries the narrower widths (Barlow → Semi Condensed → Condensed) BEFORE
 * going smaller. The smallest size is the field's minimum, never below the
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
 * Regions: title band across the top; the three cooking steps in a row;
 * then a left column (storage, dates, barcode at the bottom) and a right
 * column (ingredients, allergen note/may contain/warning, address). Fields
 * stacked in a column shrink together, level by level.
 */
import { dotsToMm, mmToDots, ptToDots } from "@workspace/units";
import { fieldParagraphs, type LabelContent } from "./content";
import { barcodeModuleDots, type ModuleChoice } from "./ean13";
import { legalMinPt, PT_STEP, xHeightMmAt } from "./legal";
import type { BodyWeight, FieldKey, FieldStyle, LabelTemplate, WidthVariant } from "./template";
import { FIELD_LABEL, WIDTH_ORDER } from "./template";
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

function widthCandidates(style: FieldStyle): WidthVariant[] {
  const start = WIDTH_ORDER.indexOf(style.width);
  return style.allowNarrower ? WIDTH_ORDER.slice(start) : [style.width];
}

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
 *  gaps); false: each field (box) has the whole height to itself. */
function fitGroup(specs: FieldSpec[], availH: number, stack: boolean, gap: number, t: LabelTemplate, m: TextMeasurer): { trials: Trial[]; fits: boolean } {
  const ok = (trials: Trial[]) => {
    if (trials.some(tr => tr.wraps.some(w => w.tooWide))) return false;
    if (stack) {
      const total = trials.reduce((s, tr) => s + tr.height, 0) + gap * Math.max(0, trials.filter(tr => tr.height > 0).length - 1);
      return total <= availH + 1e-6;
    }
    return trials.every(tr => tr.height <= availH + 1e-6);
  };
  let last: Trial[] = [];
  for (let level = 0; level < 400; level++) {
    for (let w = 0; w < WIDTH_ORDER.length; w++) {
      const trials = specs.map(s => trial(s, level, w, t, m));
      last = trials;
      if (ok(trials)) return { trials, fits: true };
      if (specs.every(s => atFloor(s, level, w, t, m))) return { trials, fits: false };
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
  const stepsTop = titleBox.y + titleBox.h + d(page.bandGapMm);
  const stepsH = d(page.stepsBandMm);
  const stepGap = d(page.columnGapMm);
  const circleD = d(page.stepCircleMm);
  const stepInset = circleD + d(1);
  // Any number of steps (2 by default), widths worked out automatically: a
  // step written as whole lines (step 2's cooking lines, which never wrap)
  // gets exactly the width its longest line needs at the size being tried;
  // the other steps share what's left equally. If every step is whole
  // lines, they're scaled to fill the row.
  const nSteps = content.steps.length;
  const stepSpace = innerW - Math.max(0, nSteps - 1) * stepGap;
  const wholeStep = content.steps.map(ps => ps.some(p => p.some(r => r.text.includes(" "))));
  const stepBoxesFor = (width: WidthVariant, sizeDots: number): Rect[] => {
    const style = t.fields.steps;
    const need = content.steps.map((ps, i) =>
      wholeStep[i] ? stepInset + Math.max(0, ...ps.map(p => wrap([p], style, width, sizeDots, Infinity, m).lineRight[0] ?? 0)) + 1 : 0);
    const fixed = need.reduce((s, w) => s + w, 0);
    const flexCount = wholeStep.filter(w => !w).length;
    const widths = flexCount > 0
      ? need.map((w, i) => (wholeStep[i] ? w : Math.max(0, (stepSpace - fixed) / flexCount)))
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
  const module = barcodeModuleDots(left.w, dpi, page.barcodeSizePct);
  const md = module.ok ? module.moduleDots : Math.ceil(d(0.264));
  // Human-readable digits: about 2.4 mm tall at nominal size, scaled with the
  // bars; each must fit under its own 7 modules; never under the legal minimum.
  const digitFace: Face = { width: "normal", weight: 500 };
  const digitMet = m.metrics(digitFace);
  const unitInk = m.ink("0123456789", digitFace, 1, 0);
  const unitDigitW = Math.max(...[..."0123456789"].map(c => m.advance(c, digitFace, 1, 0)));
  const byHeight = d(2.4 * ((module.ok ? module.magnificationPct : 100) / 100)) / Math.max(unitInk.top, 0.01);
  const byWidth = (6.5 * md) / Math.max(unitDigitW, 0.01);
  const digitSize = Math.max(ptToDots(legalMinPt(digitMet.xHeight, page.smallPack), dpi), Math.min(byHeight, byWidth));
  const digitTop = unitInk.top * digitSize;
  const digitBottom = unitInk.bottom * digitSize;
  const barsH = Math.round(d(page.barcodeHeightMm));
  const digitGap = Math.max(2, md);
  const barcodeBlockH = barsH + digitGap + digitTop + digitBottom;
  // Whole dots, rounded UP the column, so the block can't creep into the margin.
  const barcodeTop = Math.floor(left.y + left.h - barcodeBlockH);
  const barcode = layoutBarcode(content.barcode, { x: left.x, y: barcodeTop, w: left.w, h: barcodeBlockH }, module, barsH, digitGap, digitTop, digitFace, digitSize, m);
  if (!module.ok) problems.push({ field: "barcode", message: module.reason, overflowMm: Math.round((module.neededMm - dotsToMm(left.w, dpi)) * 10) / 10 });
  const leftText: Rect = { x: left.x, y: left.y, w: left.w, h: Math.max(0, barcodeTop - d(page.fieldGapMm) - left.y) };

  // Missing glyphs anywhere = can't print that character.
  const allParas: Array<[FieldKey, Paragraph[]]> = [
    ["title", content.title], ["steps", content.steps.flat()],
    ["headings", [...content.storageHeading, ...content.ingredientsHeading]],
    ["storage", content.storage], ["dates", content.dates],
    ["ingredients", content.ingredients], ["allergenInfo", content.allergenInfo], ["address", content.address],
  ];
  for (const [key, paras] of allParas) {
    const st = t.fields[key];
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
    const g = fitGroup([spec("title", [titleBox], [content.title])], titleBox.h, false, 0, t, m);
    fields.push(fieldLayout(g.trials[0], [titleBox], -1, g.fits, t, m));
    if (!g.fits) problems.push(overflowProblem(g.trials[0], titleBox.h, mm1));
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
        const boxes = stepBoxesFor(width, sizeDots);
        const tr = trial(spec("steps", boxes, content.steps, stepInset), level, w, t, m);
        chosen = tr;
        stepBoxes = boxes;
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
  const circles = stepBoxes.map(b => ({ cx: b.x + circleD / 2, cy: b.y + circleD / 2, r: circleD / 2 }));
  // Step numbers, white in the black circles.
  const numFace: Face = { width: "normal", weight: 700 };
  const numSize = circleD * 0.7;
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
  const headingGap = d(0.8);
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
  const leftHead = placeHeading(content.storageHeading, leftText);
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
