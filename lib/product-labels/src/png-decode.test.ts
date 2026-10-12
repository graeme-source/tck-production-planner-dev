import { describe, it, expect } from "vitest";
import { decodeLabelPng } from "./png-decode";
import { encodePng } from "./png";
import { Bitmap } from "./raster";

function pattern(w: number, h: number): Bitmap {
  const bm = new Bitmap(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bm.data[y * w + x] = (x * 7 + y * 13) % 5 === 0 ? 1 : 0;
  return bm;
}

describe("decodeLabelPng", () => {
  it("reads back exactly what encodePng wrote (odd width, not a multiple of 8)", () => {
    const bm = pattern(21, 9);
    const back = decodeLabelPng(encodePng(bm));
    expect(back.width).toBe(21);
    expect(back.height).toBe(9);
    expect(Array.from(back.data)).toEqual(Array.from(bm.data));
  });

  it("handles an image bigger than one 64 KB stored block (a real label size)", () => {
    const bm = pattern(1119, 751);
    const back = decodeLabelPng(encodePng(bm));
    expect(back.blackCount()).toBe(bm.blackCount());
    expect(Array.from(back.data)).toEqual(Array.from(bm.data));
  });

  it("refuses anything that isn't a PNG", () => {
    expect(() => decodeLabelPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow("Not a PNG");
  });
});
