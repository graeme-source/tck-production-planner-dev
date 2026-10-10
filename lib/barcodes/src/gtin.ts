/**
 * GTIN barcode numbers (EAN-13, UPC-A, EAN-8, GTIN-14) — the numbers a hand
 * scanner reads off a pack and Shopify stores on a variant.
 *
 * Every GTIN ends in a mod-10 check digit computed the same way whatever the
 * length: from the RIGHT, the digits before the check digit are weighted
 * 3, 1, 3, 1… The label printer's EAN-13 encoder
 * (lib/product-labels ean13.ts) only draws 13-digit numbers; this module is
 * the wider "is this a real barcode number?" check used when a barcode is
 * typed into the app or pulled from Shopify.
 */

export type GtinFormat = "EAN-8" | "UPC-A" | "EAN-13" | "GTIN-14";

const FORMAT_BY_LENGTH: Record<number, GtinFormat> = { 8: "EAN-8", 12: "UPC-A", 13: "EAN-13", 14: "GTIN-14" };

export type GtinCheck =
  | { ok: true; digits: string; format: GtinFormat }
  | { ok: false; reason: string };

/** Spaces and dashes people type or paste are not part of the number. */
export function normaliseBarcode(input: string | null | undefined): string {
  return (input ?? "").replace(/[\s-]+/g, "");
}

/** The check digit for everything before it (any GTIN length). */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new Error("GTIN body must be digits");
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - 1 - i;
    sum += Number(body[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** Is this a valid GTIN-8/12/13/14? Plain-English reason when it isn't. */
export function checkGtin(input: string | null | undefined): GtinCheck {
  const digits = normaliseBarcode(input);
  if (digits === "") return { ok: false, reason: "No barcode number" };
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "Numbers only" };
  const format = FORMAT_BY_LENGTH[digits.length];
  if (!format) return { ok: false, reason: `Barcodes have 8, 12, 13 or 14 digits — this has ${digits.length}` };
  const expected = gtinCheckDigit(digits.slice(0, -1));
  if (Number(digits[digits.length - 1]) !== expected) {
    return { ok: false, reason: `Last digit should be ${expected} — check the number was typed correctly` };
  }
  return { ok: true, digits, format };
}
