/**
 * The recipe's product photo for Shopify (Graeme, 30 Oct 2026: "images must
 * be at least 1000 × 750 pixels"). Pure and shared: the browser checks the
 * file before uploading it, and the server checks it again from the bytes —
 * the width and height are read from the image HEADER, never trusted from
 * the request. PNG, JPEG and WebP (lossy, lossless and extended).
 */

export const PRODUCT_PHOTO_MIN_WIDTH = 1000;
export const PRODUCT_PHOTO_MIN_HEIGHT = 750;
/** Biggest photo kept (Shopify takes up to 20 MB; a good product photo is
 *  well under this). */
export const PRODUCT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type ProductPhotoMime = "image/png" | "image/jpeg" | "image/webp";
export const PRODUCT_PHOTO_MIMES: readonly ProductPhotoMime[] = ["image/jpeg", "image/png", "image/webp"];

export interface ImageInfo { mime: ProductPhotoMime; width: number; height: number }

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** Type and pixel size from the file's own header, or null if it isn't a
 *  PNG, JPEG or WebP we can read. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  // PNG: signature, then the IHDR chunk (width, height big-endian).
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && ascii(bytes, 12, 4) === "IHDR") {
    return { mime: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: walk the markers to the first start-of-frame (SOF0–SOF15, not
  // DHT C4, JPG C8, DAC CC).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; } // fill byte
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(bytes, i + 2);
      if (len < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
      }
      if (marker === 0xda || marker === 0xd9) return null; // image data before any frame header
      i += 2 + len;
    }
    return null;
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X.
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 ") {
      // Key frame start code 9d 01 2a, then 14-bit width / height.
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return { mime: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (chunk === "VP8L") {
      if (bytes[20] !== 0x2f) return null;
      const b = bytes;
      const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
      return { mime: "image/webp", width, height };
    }
    if (chunk === "VP8X") {
      return { mime: "image/webp", width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    }
    return null;
  }
  return null;
}

/** The plain-English reason a photo can't be used, or null when it can. */
export function productPhotoProblem(input: { width: number; height: number; bytes: number; mime: string | null }): string | null {
  if (!input.mime || !(PRODUCT_PHOTO_MIMES as readonly string[]).includes(input.mime)) {
    return "That isn't a JPEG, PNG or WebP photo — save it as a JPEG and try again.";
  }
  if (input.bytes > PRODUCT_PHOTO_MAX_BYTES) {
    return `That photo is ${(input.bytes / 1024 / 1024).toFixed(1)} MB — the most is ${PRODUCT_PHOTO_MAX_BYTES / 1024 / 1024} MB. Export it smaller (still at least ${PRODUCT_PHOTO_MIN_WIDTH} × ${PRODUCT_PHOTO_MIN_HEIGHT}).`;
  }
  if (input.width < PRODUCT_PHOTO_MIN_WIDTH || input.height < PRODUCT_PHOTO_MIN_HEIGHT) {
    return `That photo is ${input.width} × ${input.height} pixels — Shopify product photos must be at least ${PRODUCT_PHOTO_MIN_WIDTH} wide and ${PRODUCT_PHOTO_MIN_HEIGHT} tall. Use a bigger original.`;
  }
  return null;
}

/** Server side: read the header and check it. */
export function checkProductPhoto(bytes: Uint8Array): { ok: true; info: ImageInfo } | { ok: false; reason: string } {
  const info = readImageInfo(bytes);
  if (!info) return { ok: false, reason: "That file isn't a JPEG, PNG or WebP photo we can read — save it as a JPEG and try again." };
  const problem = productPhotoProblem({ width: info.width, height: info.height, bytes: bytes.length, mime: info.mime });
  return problem ? { ok: false, reason: problem } : { ok: true, info };
}

/** "Chicken & Tarragon Pie", "image/jpeg" → "chicken-tarragon-pie.jpg". */
export function productPhotoFilename(title: string, mime: ProductPhotoMime): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "recipe";
  return `${slug}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
}
