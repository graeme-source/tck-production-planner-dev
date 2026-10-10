/**
 * Bitmap → 1-bit greyscale PNG (pure, tested). Uses uncompressed ("stored")
 * deflate blocks so it needs no zlib and runs the same in Node and the
 * browser — a 100 × 70 mm label at 203 dpi is about 55 KB.
 */
import type { Bitmap } from "./raster";

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, raw.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >>> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

export function encodePng(bm: Bitmap): Uint8Array {
  const { bytesPerRow, bytes } = bm.packedRows();
  // PNG greyscale: 1 = white. Our bitmap: 1 = black. Invert, and prefix each
  // row with filter type 0.
  const raw = new Uint8Array((bytesPerRow + 1) * bm.height);
  for (let y = 0; y < bm.height; y++) {
    raw[y * (bytesPerRow + 1)] = 0;
    for (let i = 0; i < bytesPerRow; i++) raw[y * (bytesPerRow + 1) + 1 + i] = ~bytes[y * bytesPerRow + i] & 0xff;
  }
  const chunks: Array<[string, Uint8Array]> = [];
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, bm.width); dv.setUint32(4, bm.height);
  ihdr[8] = 1; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(["IHDR", ihdr]);
  chunks.push(["IDAT", zlibStored(raw)]);
  chunks.push(["IEND", new Uint8Array(0)]);
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const png = new Uint8Array(size);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  const pv = new DataView(png.buffer);
  for (const [type, data] of chunks) {
    pv.setUint32(o, data.length); o += 4;
    const typeStart = o;
    for (let i = 0; i < 4; i++) png[o++] = type.charCodeAt(i);
    png.set(data, o); o += data.length;
    pv.setUint32(o, crc32(png, typeStart, o)); o += 4;
  }
  return png;
}

/** Base64 without Buffer/btoa differences. */
export function toBase64(bytes: Uint8Array): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let s = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += A[n >>> 18] + A[(n >>> 12) & 63] + A[(n >>> 6) & 63] + A[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    s += A[n >>> 18] + A[(n >>> 12) & 63] + (i + 1 < bytes.length ? A[(n >>> 6) & 63] : "=") + "=";
  }
  return s;
}

export function pngDataUrl(bm: Bitmap): string {
  return `data:image/png;base64,${toBase64(encodePng(bm))}`;
}
