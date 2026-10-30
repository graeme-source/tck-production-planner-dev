import { describe, expect, it } from "vitest";
import { checkProductPhoto, productPhotoFilename, productPhotoProblem, readImageInfo } from "./product-photo";

const bytes = (...parts: Array<number[] | string>) => Uint8Array.from(parts.flatMap(p => (typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : p)));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

function png(w: number, h: number) {
  return bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(w), be32(h), [8, 2, 0, 0, 0], [0, 0, 0, 0]);
}
/** JFIF APP0, an EXIF-ish APP1, a DQT, then the SOF the size is read from. */
function jpeg(w: number, h: number, sof = 0xc0) {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0], be16(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1], be16(8), "Exif", [0, 0],
    [0xff, 0xdb], be16(4), [0, 0],
    [0xff, sof], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda], be16(2),
  );
}
function webpLossy(w: number, h: number) {
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h), [0, 0]);
}
function webpLossless(w: number, h: number) {
  const a = w - 1, b = h - 1;
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f],
    [a & 0xff, ((a >> 8) & 0x3f) | ((b & 0x03) << 6), (b >> 2) & 0xff, (b >> 10) & 0x0f], [0, 0, 0, 0, 0]);
}
function webpExtended(w: number, h: number) {
  return bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1), [0, 0]);
}

describe("reading a photo's size from its header", () => {
  it("PNG", () => expect(readImageInfo(png(1600, 1200))).toEqual({ mime: "image/png", width: 1600, height: 1200 }));
  it("JPEG — skips the APP / table segments to the frame header", () => {
    expect(readImageInfo(jpeg(4032, 3024))).toEqual({ mime: "image/jpeg", width: 4032, height: 3024 });
    expect(readImageInfo(jpeg(1200, 900, 0xc2))).toEqual({ mime: "image/jpeg", width: 1200, height: 900 }); // progressive
  });
  it("WebP lossy, lossless and extended", () => {
    expect(readImageInfo(webpLossy(1500, 1000))).toEqual({ mime: "image/webp", width: 1500, height: 1000 });
    expect(readImageInfo(webpLossless(1001, 751))).toEqual({ mime: "image/webp", width: 1001, height: 751 });
    expect(readImageInfo(webpExtended(2048, 1536))).toEqual({ mime: "image/webp", width: 2048, height: 1536 });
  });
  it("anything else (GIF, HEIC, a PDF, junk, a truncated JPEG) is not read", () => {
    expect(readImageInfo(bytes("GIF89a", [0, 4, 0, 3]))).toBeNull();
    expect(readImageInfo(bytes("%PDF-1.7 hello world padding......"))).toBeNull();
    expect(readImageInfo(new Uint8Array(40))).toBeNull();
    expect(readImageInfo(jpeg(1200, 900).subarray(0, 30))).toBeNull();
  });
});

describe("the 1000 × 750 minimum", () => {
  it("both sides must be big enough — width ≥ 1000 AND height ≥ 750", () => {
    expect(productPhotoProblem({ width: 1000, height: 750, bytes: 100, mime: "image/jpeg" })).toBeNull();
    expect(productPhotoProblem({ width: 999, height: 2000, bytes: 100, mime: "image/jpeg" })).toMatch(/999 × 2000.*at least 1000 wide and 750 tall/);
    expect(productPhotoProblem({ width: 3000, height: 749, bytes: 100, mime: "image/jpeg" })).toMatch(/3000 × 749/);
  });
  it("refuses other types and very big files", () => {
    expect(productPhotoProblem({ width: 2000, height: 2000, bytes: 100, mime: "image/heic" })).toMatch(/JPEG, PNG or WebP/);
    expect(productPhotoProblem({ width: 2000, height: 2000, bytes: 11 * 1024 * 1024, mime: "image/jpeg" })).toMatch(/11\.0 MB/);
  });
  it("the server check uses the header, not what the browser said", () => {
    expect(checkProductPhoto(jpeg(1600, 1200))).toEqual({ ok: true, info: { mime: "image/jpeg", width: 1600, height: 1200 } });
    expect(checkProductPhoto(png(800, 600))).toMatchObject({ ok: false, reason: expect.stringContaining("800 × 600") });
    expect(checkProductPhoto(bytes("not an image at all, honestly"))).toMatchObject({ ok: false });
  });
});

it("names the file after the recipe", () => {
  expect(productPhotoFilename("Chicken & Tarragon Pie", "image/jpeg")).toBe("chicken-tarragon-pie.jpg");
  expect(productPhotoFilename("Crème Brûlée!", "image/webp")).toBe("creme-brulee.webp");
  expect(productPhotoFilename("", "image/png")).toBe("recipe.png");
});
