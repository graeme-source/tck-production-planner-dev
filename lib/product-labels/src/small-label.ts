/**
 * The small product label (Graeme, 2026-10-27): 102 × 25 mm, the same stock
 * as the front name label. Name (and an optional second line, e.g. "5 PACK")
 * on the left with a big USE BY and the batch number; the product's barcode,
 * digits underneath, on the right. Used for the brownie 5-pack despatch
 * labels and the TCK Garlic Mayo pot labels, which were made by hand in
 * Label LIVE.
 *
 * The barcode is EAN-13 when the code is a valid EAN-13, otherwise Code 128
 * (Shopify's 14-digit mayo code). Pure layout, measured through
 * TextMeasurer; render.ts draws it.
 */
import { mmToDots } from "@workspace/units";
import type { PlacedRun, TextMeasurer } from "./layout";
import { checkEan13, encodeEan13, EAN13_QUIET_LEFT, EAN13_QUIET_RIGHT } from "./ean13";
import { code128Ok, encodeCode128, CODE128_QUIET } from "./code128";
import { fitLine, FRONT_LABEL_PAGE, type Fit } from "./front-label";

export const SMALL_LABEL_PAGE = FRONT_LABEL_PAGE;

export interface SmallLabelInput {
  name: string;
  /** A short second line under the name ("5 PACK"). */
  secondLine?: string | null;
  /** Already formatted, "14/11/26". */
  useBy: string;
  batch?: string | null;
  /** The product's barcode digits; none = no barcode. */
  barcode?: string | null;
}

export interface SmallLabelBarcode {
  kind: "ean13" | "code128";
  /** One per module, quiet zones included. */
  modules: boolean[];
  x: number;
  top: number;
  bottom: number;
  moduleDots: number;
}

export interface SmallLabelLayout {
  widthDots: number;
  heightDots: number;
  dpi: number;
  runs: PlacedRun[];
  barcode: SmallLabelBarcode | null;
  /** Why the barcode was left off (a code that can't be drawn). */
  barcodeProblem: string | null;
  ok: boolean;
}

/** The modules for a code, quiet zones included, or why it can't be drawn. */
export function smallLabelBarcodeModules(code: string): { kind: "ean13" | "code128"; modules: boolean[] } | { problem: string } {
  const digits = code.replace(/\s+/g, "");
  if (/^\d{13}$/.test(digits) && checkEan13(digits).ok) {
    return { kind: "ean13", modules: [...Array(EAN13_QUIET_LEFT).fill(false), ...encodeEan13(digits), ...Array(EAN13_QUIET_RIGHT).fill(false)] };
  }
  if (code128Ok(digits)) {
    const quiet = Array(CODE128_QUIET).fill(false);
    return { kind: "code128", modules: [...quiet, ...encodeCode128(digits), ...quiet] };
  }
  return { problem: `“${code}” can't be printed as a barcode.` };
}

/** Rows on the left, as shares of the height. */
const ROW = { name: 0.34, second: 0.2, useBy: 0.3, batch: 0.2 } as const;
/** Tidy, not overstated (Graeme, 2026-10-27: "don't go overboard on the
 *  size... we don't have to literally fill up every pixel"): each line's
 *  type is capped, in mm of font size, and the block sits in the middle. */
const ROW_MAX_MM = { name: 5.2, second: 3.4, useBy: 3.8, batch: 3.4 } as const;
/** Bars no taller than this, however much room there is. */
const BAR_MAX_MM = 12;
const ROW_GAP_SHARE = 0.07;
/** The barcode never takes more than this share of the width. */
const BARCODE_MAX_SHARE = 0.45;
const DIGITS_SHARE = 0.17;

export function layoutSmallLabel(m: TextMeasurer, input: SmallLabelInput): SmallLabelLayout {
  const p = SMALL_LABEL_PAGE;
  const widthDots = Math.round(mmToDots(p.widthMm, p.dpi));
  const heightDots = Math.round(mmToDots(p.heightMm, p.dpi));
  const margin = Math.round(mmToDots(p.marginMm, p.dpi));
  const innerW = widthDots - margin * 2;
  const innerH = heightDots - margin * 2;
  const name = input.name.replace(/\s+/g, " ").trim();
  const runs: PlacedRun[] = [];
  if (!name) return { widthDots, heightDots, dpi: p.dpi, runs, barcode: null, barcodeProblem: null, ok: false };

  // ── Barcode on the right: the widest whole-dot module that fits. ──
  let barcode: SmallLabelBarcode | null = null;
  let barcodeProblem: string | null = null;
  let leftW = innerW;
  const code = input.barcode?.trim();
  if (code) {
    const enc = smallLabelBarcodeModules(code);
    if ("problem" in enc) barcodeProblem = enc.problem;
    else {
      const maxW = Math.floor(innerW * BARCODE_MAX_SHARE);
      // 2 dots = 0.25 mm modules: scans reliably at 203 dpi without shouting.
      const moduleDots = Math.max(1, Math.min(2, Math.floor(maxW / enc.modules.length)));
      const w = enc.modules.length * moduleDots;
      const x = widthDots - margin - w;
      const digitsH = Math.round(innerH * DIGITS_SHARE);
      const barGap = Math.round(innerH * 0.04);
      const barsH = Math.min(innerH - digitsH - barGap, Math.round(mmToDots(BAR_MAX_MM, p.dpi)));
      // Bars and digits as one block, centred top to bottom.
      const top = margin + Math.round((innerH - (barsH + barGap + digitsH)) / 2);
      const bottom = top + barsH;
      barcode = { kind: enc.kind, modules: enc.modules, x, top, bottom, moduleDots };
      const digitText = code.replace(/\s+/g, "");
      const fit = fitLine(m, digitText, 500, w - moduleDots * 8, digitsH, Math.round(mmToDots(3, p.dpi)));
      runs.push({ x: Math.round(x + (w - fit.inkW) / 2 - fit.inkLeft), y: bottom + barGap + fit.inkTop, text: digitText, face: fit.face, sizeDots: fit.size, letterSpacingEm: 0 });
      leftW = x - margin - Math.round(mmToDots(3, p.dpi));
    }
  }

  // ── Text on the left, top to bottom. ──
  const second = input.secondLine?.replace(/\s+/g, " ").trim() || null;
  const batch = input.batch?.trim() || null;
  const mm = (v: number) => Math.round(mmToDots(v, p.dpi));
  const rows: Array<{ text: string; weight: 700 | 500; share: number; max: number }> = [
    { text: name.toUpperCase(), weight: 700, share: ROW.name, max: mm(ROW_MAX_MM.name) },
    ...(second ? [{ text: second.toUpperCase(), weight: 500 as const, share: ROW.second, max: mm(ROW_MAX_MM.second) }] : []),
    { text: `USE BY: ${input.useBy}`, weight: 700, share: ROW.useBy, max: mm(ROW_MAX_MM.useBy) },
    ...(batch ? [{ text: `BATCH: ${batch}`, weight: 500 as const, share: ROW.batch, max: mm(ROW_MAX_MM.batch) }] : []),
  ];
  const gap = Math.max(Math.round(innerH * ROW_GAP_SHARE), Math.round(mmToDots(1.2, p.dpi)));
  const free = innerH - gap * (rows.length - 1);
  const total = rows.reduce((t, r) => t + r.share, 0);
  const fits: Fit[] = rows.map(r => fitLine(m, r.text, r.weight, leftW, Math.floor((free * r.share) / total), r.max));
  const blockH = fits.reduce((t, f) => t + f.inkTop + f.inkBottom, 0) + gap * (rows.length - 1);
  let top = margin + Math.max(0, (innerH - blockH) / 2);
  rows.forEach((r, i) => {
    const f = fits[i]!;
    runs.push({ x: Math.round(margin - f.inkLeft), y: Math.round(top + f.inkTop), text: r.text, face: f.face, sizeDots: f.size, letterSpacingEm: 0 });
    top += f.inkTop + f.inkBottom + gap;
  });
  return { widthDots, heightDots, dpi: p.dpi, runs, barcode, barcodeProblem, ok: true };
}
