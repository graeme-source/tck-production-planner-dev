/**
 * Load the bundled label fonts from disk (Node only — the API server and the
 * tests). The fonts sit in lib/product-labels/fonts, which the Docker image
 * copies in with the rest of lib/.
 */
import { readFileSync } from "node:fs";
import { FONT_FILES, LabelFontSet } from "./fonts";

let cached: LabelFontSet | null = null;

export function loadBundledFonts(): LabelFontSet {
  if (cached) return cached;
  const files = FONT_FILES.map(f => {
    const buf = readFileSync(new URL(`../fonts/${f.file}`, import.meta.url));
    return { width: f.width, weight: f.weight, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer };
  });
  cached = new LabelFontSet(files);
  return cached;
}
