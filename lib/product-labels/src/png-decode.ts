/**
 * Read back a label PNG made by encodePng (pure, tested) — Objective D.
 *
 * Every published label version stores the exact image it went live with
 * (product_label_versions.proof_png). The history's archive PDF stamps that
 * stored image rather than re-drawing the label with today's layout code, so
 * it shows what was really printed. encodePng writes 1-bit greyscale,
 * filter 0, uncompressed ("stored") deflate blocks — that is all this reads;
 * anything else throws and the caller falls back to re-drawing.
 */
import { Bitmap } from "./raster";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Inflate a zlib stream made only of stored blocks. */
function inflateStored(z: Uint8Array): Uint8Array {
  if (z.length < 2 || (z[0] & 0x0f) !== 8) throw new Error("Not a zlib stream");
  const parts: Uint8Array[] = [];
  let o = 2;
  let total = 0;
  for (;;) {
    if (o + 5 > z.length) throw new Error("Truncated deflate block");
    const header = z[o];
    if ((header & 0x06) !== 0) throw new Error("Compressed PNG — only stored blocks are read");
    const len = z[o + 1] | (z[o + 2] << 8);
    const nlen = z[o + 3] | (z[o + 4] << 8);
    if ((len ^ 0xffff) !== nlen) throw new Error("Corrupt stored block");
    o += 5;
    if (o + len > z.length) throw new Error("Truncated stored block");
    parts.push(z.subarray(o, o + len));
    total += len;
    o += len;
    if (header & 1) break;
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

export function decodeLabelPng(png: Uint8Array): Bitmap {
  for (let i = 0; i < 8; i++) if (png[i] !== SIG[i]) throw new Error("Not a PNG");
  let o = 8;
  let width = 0, height = 0;
  const idat: Uint8Array[] = [];
  while (o + 8 <= png.length) {
    const len = u32(png, o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = u32(data, 0);
      height = u32(data, 4);
      if (data[8] !== 1 || data[9] !== 0 || data[12] !== 0) throw new Error("Only 1-bit greyscale, non-interlaced label PNGs are read");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    o += 12 + len;
  }
  if (!width || !height || idat.length === 0) throw new Error("PNG has no image");
  const z = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let p = 0;
  for (const d of idat) { z.set(d, p); p += d.length; }
  const raw = inflateStored(z);
  const bytesPerRow = Math.ceil(width / 8);
  if (raw.length < (bytesPerRow + 1) * height) throw new Error("PNG image data too short");
  const bm = new Bitmap(width, height);
  for (let y = 0; y < height; y++) {
    const row = y * (bytesPerRow + 1);
    if (raw[row] !== 0) throw new Error("Filtered PNG rows aren't read");
    for (let x = 0; x < width; x++) {
      // PNG greyscale 0 = black; our bitmap 1 = black.
      const bit = (raw[row + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (bit === 0) bm.data[y * width + x] = 1;
    }
  }
  return bm;
}
