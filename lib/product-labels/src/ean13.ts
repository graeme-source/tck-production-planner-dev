/**
 * EAN-13 (GTIN-13) barcodes, encoded in code — no downloaded images.
 *
 * encodeEan13 returns the 95 modules (true = bar) of the symbol: start guard
 * 101, six left digits (A/B sets chosen by the first digit), centre guard
 * 01010, six right digits (C set), end guard 101. The renderer draws each
 * module as a WHOLE number of printer dots (see barcodeModuleDots), because a
 * module that is 2.6 dots wide prints as a mix of 2s and 3s and stops
 * scanning reliably.
 */
import { dotsToMm, mmToDots } from "@workspace/units";

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Check digit for the first 12 digits (weights 1,3,1,3…). */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("EAN-13 needs 12 digits before the check digit");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export type Ean13Check =
  | { ok: true; digits: string }
  | { ok: false; reason: string };

/** Validate a typed barcode number. Spaces are ignored. */
export function checkEan13(input: string): Ean13Check {
  const digits = input.replace(/\s+/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "Numbers only" };
  if (digits.length !== 13) return { ok: false, reason: `Needs 13 digits — this has ${digits.length}` };
  const expected = ean13CheckDigit(digits.slice(0, 12));
  if (Number(digits[12]) !== expected) {
    return { ok: false, reason: `Last digit should be ${expected} — check the number was typed correctly` };
  }
  return { ok: true, digits };
}

/** The 95 modules of a valid EAN-13. Throws on an invalid number. */
export function encodeEan13(digits: string): boolean[] {
  const c = checkEan13(digits);
  if (!c.ok) throw new Error(c.reason);
  const d = c.digits;
  const parity = PARITY[Number(d[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[Number(d[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[Number(d[i])];
  bits += "101";
  return [...bits].map(b => b === "1");
}

/** Module indexes of the guard bars (drawn longer than the digit bars). */
export function isGuardModule(index: number): boolean {
  return index < 3 || (index >= 45 && index < 50) || index >= 92;
}

/** Quiet zones in modules (GS1): 11 left, 7 right. */
export const EAN13_QUIET_LEFT = 11;
export const EAN13_QUIET_RIGHT = 7;
export const EAN13_TOTAL_MODULES = EAN13_QUIET_LEFT + 95 + EAN13_QUIET_RIGHT;

/** GS1 X-dimension limits for EAN-13: 80%–200% of 0.330 mm. */
export const EAN13_MIN_MODULE_MM = 0.264;
export const EAN13_MAX_MODULE_MM = 0.66;

export type ModuleChoice =
  | { ok: true; moduleDots: number; moduleMm: number; magnificationPct: number; widthDots: number }
  | { ok: false; reason: string; neededMm: number };

/** The widest whole-dot module that fits the box, within GS1 limits. */
export function barcodeModuleDots(boxWidthDots: number, dpi: number): ModuleChoice {
  const minDots = Math.ceil(mmToDots(EAN13_MIN_MODULE_MM, dpi) - 1e-9);
  const maxDots = Math.max(minDots, Math.floor(mmToDots(EAN13_MAX_MODULE_MM, dpi) + 1e-9));
  const fit = Math.floor(boxWidthDots / EAN13_TOTAL_MODULES);
  const moduleDots = Math.min(maxDots, fit);
  if (moduleDots < minDots) {
    return {
      ok: false,
      reason: `The barcode needs ${dotsToMm(minDots * EAN13_TOTAL_MODULES, dpi).toFixed(1)} mm across (with its quiet zones) at ${dpi} dpi — the box is ${dotsToMm(boxWidthDots, dpi).toFixed(1)} mm`,
      neededMm: dotsToMm(minDots * EAN13_TOTAL_MODULES, dpi),
    };
  }
  const moduleMm = dotsToMm(moduleDots, dpi);
  return { ok: true, moduleDots, moduleMm, magnificationPct: Math.round((moduleMm / 0.33) * 100), widthDots: moduleDots * EAN13_TOTAL_MODULES };
}
