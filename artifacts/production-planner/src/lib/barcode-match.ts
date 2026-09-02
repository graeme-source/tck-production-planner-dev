/**
 * Barcode comparison for the picking screen. The same product code can
 * arrive in different dress: our sauces carry 12-digit UPC-A codes
 * ("702382999100"), and a scanner set to normalise to EAN-13 sends them
 * with a leading zero ("0702382999100") — string equality then fails and a
 * perfectly good scan bleeps red. All-numeric codes are compared with
 * leading zeros stripped; anything non-numeric compares as typed.
 * Pure and unit-tested (live incident 2026-09-02: scans bleeping without
 * ticking).
 */
export function normaliseBarcode(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!/^\d+$/.test(t)) return t;
  return t.replace(/^0+/, "") || "0";
}

export function barcodeMatches(input: string, barcode: string | null | undefined): boolean {
  if (!barcode) return false;
  return normaliseBarcode(input) === normaliseBarcode(barcode);
}
