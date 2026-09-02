import { describe, it, expect } from "vitest";
import { barcodeMatches, normaliseBarcode } from "./barcode-match";

describe("barcodeMatches", () => {
  it("matches an exact EAN-13", () => {
    expect(barcodeMatches("5065018206054", "5065018206054")).toBe(true);
  });

  // The 2026-09-02 incident class: sauces carry 12-digit UPC-A codes, and a
  // scanner normalising to EAN-13 prepends a zero — that must still match.
  it("matches a UPC-A cached code scanned with a leading zero", () => {
    expect(barcodeMatches("0702382999100", "702382999100")).toBe(true);
    expect(barcodeMatches("702382999100", "0702382999100")).toBe(true);
  });

  it("does not match different codes", () => {
    expect(barcodeMatches("5065018206054", "5065018206061")).toBe(false);
    expect(barcodeMatches("1", "5065018206054")).toBe(false);
  });

  it("never matches a missing barcode", () => {
    expect(barcodeMatches("5065018206054", null)).toBe(false);
    expect(barcodeMatches("5065018206054", "")).toBe(false);
  });

  it("compares non-numeric codes as typed (case-insensitive)", () => {
    expect(barcodeMatches("ABC-123", "abc-123")).toBe(true);
    expect(normaliseBarcode("0ABC")).toBe("0abc"); // not all digits — zeros kept
  });

  it("survives an all-zero code", () => {
    expect(normaliseBarcode("000")).toBe("0");
  });
});
