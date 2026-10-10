import { describe, it, expect } from "vitest";
import { barcodeModuleDots, checkEan13, ean13CheckDigit, encodeEan13 } from "./ean13";

describe("EAN-13 check digit", () => {
  it("accepts Graeme's Chicken & Chorizo barcode 5065018206009", () => {
    expect(ean13CheckDigit("506501820600")).toBe(9);
    expect(checkEan13("5065018206009")).toEqual({ ok: true, digits: "5065018206009" });
  });
  it("knows the textbook example 4006381333931", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
  });
  it("rejects a wrong last digit and says what it should be", () => {
    const c = checkEan13("5065018206008");
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toContain("should be 9");
  });
  it("rejects wrong lengths and letters; ignores spaces", () => {
    expect(checkEan13("506501820600").ok).toBe(false);
    expect(checkEan13("50650182060O9").ok).toBe(false);
    expect(checkEan13("5 065018 206009").ok).toBe(true);
  });
});

describe("EAN-13 encoding", () => {
  const bits = (m: boolean[]) => m.map(b => (b ? "1" : "0")).join("");
  it("is 95 modules with guards in place", () => {
    const m = encodeEan13("4006381333931");
    expect(m).toHaveLength(95);
    const s = bits(m);
    expect(s.slice(0, 3)).toBe("101");
    expect(s.slice(45, 50)).toBe("01010");
    expect(s.slice(92)).toBe("101");
  });
  it("encodes 4006381333931 exactly (first digit 4 → parity LGLLGG)", () => {
    const s = bits(encodeEan13("4006381333931"));
    // 0 in L, 0 in G, 6 in L, 3 in L, 8 in G, 1 in G
    expect(s.slice(3, 45)).toBe("0001101" + "0100111" + "0101111" + "0111101" + "0001001" + "0110011");
    // 333931 in R
    expect(s.slice(50, 92)).toBe("1000010" + "1000010" + "1000010" + "1110100" + "1000010" + "1100110");
  });
  it("refuses to encode an invalid number", () => {
    expect(() => encodeEan13("5065018206008")).toThrow();
  });
});

describe("barcode module width snaps to whole printer dots", () => {
  it("203 dpi: 2 dots (0.25 mm) is under GS1's 80% minimum, so it uses 3 dots", () => {
    const c = barcodeModuleDots(400, 203);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.moduleDots).toBe(3);
      expect(c.widthDots).toBe(339);
    }
  });
  it("300 dpi uses 4 dots (0.34 mm, ~103%) when there's room", () => {
    const c = barcodeModuleDots(500, 300);
    expect(c.ok && c.moduleDots).toBe(4);
  });
  it("says how much room it needs when the box is too narrow", () => {
    const c = barcodeModuleDots(300, 203);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.neededMm).toBeCloseTo(42.4, 1);
  });
  it("never goes above 200%", () => {
    const c = barcodeModuleDots(5000, 203);
    expect(c.ok && c.moduleDots).toBe(5);
  });
});
