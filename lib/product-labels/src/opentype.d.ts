// The slice of opentype.js 1.3.4 the label renderer uses. (@types/opentype.js
// pulls the DOM lib into the API server's build, which breaks Node's stream
// types — so the few signatures we need are declared here.)
declare module "opentype.js" {
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };

  export interface Path {
    commands: PathCommand[];
  }

  export interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    getPath(x?: number, y?: number, fontSize?: number): Path;
    getBoundingBox(): BoundingBox;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: { os2?: { sxHeight?: number; sCapHeight?: number }; [name: string]: unknown };
    charToGlyph(c: string): Glyph;
    charToGlyphIndex(c: string): number;
    stringToGlyphs(s: string, options?: unknown): Glyph[];
    getKerningValue(left: Glyph, right: Glyph): number;
  }

  export function parse(buffer: ArrayBuffer): Font;

  const opentype: { parse: typeof parse };
  export default opentype;
}
