/**
 * The FRONT name label (#331, Kerri-Leigh Dovale; approved by Graeme
 * 2026-10-22): 102 × 25 mm, the recipe's label name in big bold type that
 * shrinks to fit ONE line, with an optional short second line under it.
 *
 * Today these are made by hand in Label LIVE for every test flavour. The name
 * comes from the recipe (its label name, or its name), so a new flavour has a
 * front label as soon as its recipe exists. Same fonts, same rasteriser and
 * same PDF as the back labels — the print path doesn't change.
 *
 * Pure layout here (measured through TextMeasurer, so it's testable and the
 * browser can import it); render.ts draws it.
 */
import { mmToDots } from "@workspace/units";
import type { Face, PlacedRun, TextMeasurer } from "./layout";
import type { WidthVariant } from "./template";

export const FRONT_LABEL_PAGE = { widthMm: 102, heightMm: 25, dpi: 203, marginMm: 2 } as const;

/** The second line is a short tag ("NEW", "Test flavour"), not a sentence. */
export const FRONT_SECOND_LINE_MAX = 40;

/** Widest first: the name is as big as it can be, narrowing only when a long
 *  name would otherwise have to shrink. */
const WIDTHS: WidthVariant[] = ["normal", "semi-condensed", "condensed"];
/** How much of the space a second line takes when there is one. */
const SECOND_SHARE = 0.3;
const GAP_SHARE = 0.06;

export interface FrontLabelInput {
  name: string;
  secondLine?: string | null;
}

export interface FrontLabelLayout {
  widthDots: number;
  heightDots: number;
  dpi: number;
  runs: PlacedRun[];
  /** The name's size, in dots — the test checks it shrinks for long names. */
  nameSizeDots: number;
  /** False when there's no name to print. */
  ok: boolean;
}

export function cleanFrontText(input: FrontLabelInput): { name: string; second: string | null } {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  const second = (input.secondLine ?? "").replace(/\s+/g, " ").trim().slice(0, FRONT_SECOND_LINE_MAX);
  return { name, second: second || null };
}

interface Fit { face: Face; size: number; inkW: number; inkTop: number; inkBottom: number; inkLeft: number }

/** The biggest single line of `text` that fits w × h, no bigger than maxSize. */
function fitLine(m: TextMeasurer, text: string, weight: 700 | 500, w: number, h: number, maxSize = Infinity): Fit {
  let best: { face: Face; size: number } | null = null;
  const probe = 100;
  for (const width of WIDTHS) {
    const face: Face = { width, weight };
    const ink = m.ink(text, face, probe, 0);
    const inkW = ink.right - ink.left;
    const inkH = ink.top + ink.bottom;
    if (inkW <= 0 || inkH <= 0) continue;
    const size = Math.floor(Math.min((w / inkW) * probe, (h / inkH) * probe, maxSize));
    // Prefer the wider face unless a narrower one is clearly bigger.
    if (!best || size > best.size * 1.08) best = { face, size };
  }
  if (!best) best = { face: { width: "normal", weight }, size: 1 };
  // Step down until the ink really fits (glyph rounding isn't linear).
  let size = Math.max(1, best.size);
  let ink = m.ink(text, best.face, size, 0);
  while (size > 1 && (ink.right - ink.left > w || ink.top + ink.bottom > h)) {
    size -= 1;
    ink = m.ink(text, best.face, size, 0);
  }
  return { face: best.face, size, inkW: ink.right - ink.left, inkTop: ink.top, inkBottom: ink.bottom, inkLeft: ink.left };
}

/** The second line is never more than this share of the name's size. */
const SECOND_MAX_OF_NAME = 0.6;

export function layoutFrontLabel(m: TextMeasurer, input: FrontLabelInput): FrontLabelLayout {
  const p = FRONT_LABEL_PAGE;
  const widthDots = Math.round(mmToDots(p.widthMm, p.dpi));
  const heightDots = Math.round(mmToDots(p.heightMm, p.dpi));
  const margin = Math.round(mmToDots(p.marginMm, p.dpi));
  const { name, second } = cleanFrontText(input);
  if (!name) return { widthDots, heightDots, dpi: p.dpi, runs: [], nameSizeDots: 0, ok: false };

  const innerW = widthDots - margin * 2;
  const innerH = heightDots - margin * 2;
  const gap = second ? Math.round(innerH * GAP_SHARE) : 0;
  const secondH = second ? Math.round(innerH * SECOND_SHARE) : 0;
  const nameFit = fitLine(m, name, 700, innerW, innerH - secondH - gap);
  const lines: Array<{ text: string; fit: Fit }> = [{ text: name, fit: nameFit }];
  if (second) lines.push({ text: second, fit: fitLine(m, second, 500, innerW, secondH, Math.floor(nameFit.size * SECOND_MAX_OF_NAME)) });

  // Centre the lines as one block, each line centred across the label.
  const blockH = lines.reduce((t, l) => t + l.fit.inkTop + l.fit.inkBottom, 0) + gap * (lines.length - 1);
  let top = margin + (innerH - blockH) / 2;
  const runs: PlacedRun[] = lines.map(({ text, fit }) => {
    const run: PlacedRun = {
      x: Math.round(margin + (innerW - fit.inkW) / 2 - fit.inkLeft),
      y: Math.round(top + fit.inkTop),
      text, face: fit.face, sizeDots: fit.size, letterSpacingEm: 0,
    };
    top += fit.inkTop + fit.inkBottom + gap;
    return run;
  });
  return { widthDots, heightDots, dpi: p.dpi, runs, nameSizeDots: nameFit.size, ok: true };
}

/** The name that prints: the recipe's label name, or its name (the same rule
 *  as the back label's title). */
export function frontLabelName(labelName: string | null | undefined, recipeName: string): string {
  return labelName?.trim() || recipeName.trim();
}
