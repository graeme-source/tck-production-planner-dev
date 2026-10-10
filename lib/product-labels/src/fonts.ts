/**
 * The bundled label fonts, parsed with opentype.js — the ONE place text is
 * measured and shaped.
 *
 * Barlow, Barlow Semi Condensed and Barlow Condensed (SIL Open Font Licence,
 * fonts/OFL.txt), weights 400/500/700, Latin subset, from @fontsource 5.3.0.
 * The files live in the repo (lib/product-labels/fonts) so a package update
 * can never silently change how labels lay out.
 *
 * shapeText() is used both to MEASURE (layout.ts, through the measurer) and
 * to DRAW (render.ts): same glyphs, same advances, same kerning, same letter
 * spacing — so what the proof shows is what the printer gets.
 */
/// <reference path="./opentype.d.ts" />
import opentype, { type Font, type Glyph, type PathCommand } from "opentype.js";
import type { Face, FaceMetrics, TextMeasurer } from "./layout";
import type { BodyWeight, WidthVariant } from "./template";

export const FONT_FILES: Array<{ width: WidthVariant; weight: BodyWeight; file: string }> = [];
for (const width of ["normal", "semi-condensed", "condensed"] as WidthVariant[]) {
  for (const weight of [400, 500, 700] as BodyWeight[]) {
    const stem = width === "normal" ? "barlow" : `barlow-${width}`;
    FONT_FILES.push({ width, weight, file: `${stem}-${weight}.woff` });
  }
}

const faceKey = (f: Face) => `${f.width}/${f.weight}`;

/** Ligatures off (one character = one glyph, so nothing is merged or lost),
 *  kerning on. */
const SHAPE_OPTIONS = { kerning: true, features: { liga: false, rlig: false } };

export interface ShapedGlyph {
  glyph: Glyph;
  /** Pen position (dots) relative to the run start. */
  x: number;
}

interface LoadedFace {
  font: Font;
  scale: number; // per unitsPerEm
  kerning: unknown;
  metrics: FaceMetrics;
}

export class LabelFontSet implements TextMeasurer {
  private faces = new Map<string, LoadedFace>();
  private cache = new Map<string, number>();

  constructor(files: Array<{ width: WidthVariant; weight: BodyWeight; data: ArrayBuffer }>) {
    for (const f of files) {
      const font = opentype.parse(f.data);
      const upm = font.unitsPerEm;
      const os2 = font.tables.os2 as { sxHeight?: number; sCapHeight?: number } | undefined;
      // x-height from the real "x" glyph outline (falls back to OS/2); the
      // smaller of the two is used so the legal check is never optimistic.
      const xBox = font.charToGlyph("x").getBoundingBox();
      const xFromGlyph = xBox.y2 > 0 ? xBox.y2 : Infinity;
      const xFromOs2 = os2?.sxHeight && os2.sxHeight > 0 ? os2.sxHeight : Infinity;
      const xh = Math.min(xFromGlyph, xFromOs2);
      const capBox = font.charToGlyph("H").getBoundingBox();
      this.faces.set(faceKey(f), {
        font,
        scale: 1 / upm,
        kerning: (font as unknown as { position: { getKerningTables(s: string): unknown } }).position.getKerningTables("latn"),
        metrics: {
          ascender: font.ascender / upm,
          descender: Math.abs(font.descender) / upm,
          xHeight: Number.isFinite(xh) ? xh / upm : 0.5,
          capHeight: (os2?.sCapHeight && os2.sCapHeight > 0 ? os2.sCapHeight : capBox.y2) / upm,
        },
      });
    }
    for (const f of FONT_FILES) {
      if (!this.faces.has(faceKey(f))) throw new Error(`Label font missing: ${f.file}`);
    }
  }

  private face(f: Face): LoadedFace {
    const lf = this.faces.get(faceKey(f));
    if (!lf) throw new Error(`No label font for ${faceKey(f)}`);
    return lf;
  }

  /** Glyphs and their pen positions — measuring and drawing both use this. */
  shapeText(text: string, f: Face, sizeDots: number, letterSpacingEm: number): { glyphs: ShapedGlyph[]; advance: number } {
    const lf = this.face(f);
    const glyphs = lf.font.stringToGlyphs(text, SHAPE_OPTIONS);
    const k = sizeDots * lf.scale;
    const pos = (lf.font as unknown as { position: { getKerningValue(t: unknown, a: number, b: number): number } }).position;
    const out: ShapedGlyph[] = [];
    let x = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      out.push({ glyph: g, x });
      x += (g.advanceWidth ?? 0) * k;
      if (i < glyphs.length - 1) {
        const kv = lf.kerning ? pos.getKerningValue(lf.kerning, g.index, glyphs[i + 1].index) : lf.font.getKerningValue(g, glyphs[i + 1]);
        x += kv * k;
      }
      x += letterSpacingEm * sizeDots;
    }
    return { glyphs: out, advance: x };
  }

  advance(text: string, f: Face, sizeDots: number, letterSpacingEm: number): number {
    const key = `${faceKey(f)}|${sizeDots}|${letterSpacingEm}|${text}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      v = this.shapeText(text, f, sizeDots, letterSpacingEm).advance;
      if (this.cache.size > 50_000) this.cache.clear();
      this.cache.set(key, v);
    }
    return v;
  }

  metrics(f: Face): FaceMetrics {
    return this.face(f).metrics;
  }

  missingGlyphs(text: string, f: Face): string[] {
    const font = this.face(f).font;
    const missing = new Set<string>();
    for (const ch of text) {
      if (ch === " " || ch === " ") continue;
      if (font.charToGlyphIndex(ch) === 0) missing.add(ch);
    }
    return [...missing];
  }

  /** Glyph outline in dots at a baseline position (y grows downwards). */
  glyphPath(g: Glyph, x: number, y: number, sizeDots: number): PathCommand[] {
    return g.getPath(x, y, sizeDots).commands;
  }
}
