// Extract money-like amounts from email subject/body text. Pure, tested.
// Returns unique decimal strings ("48.98"), capped to keep index rows small.

const AMOUNT_RE = /(?:[£$€]\s?|GBP\s|USD\s|EUR\s)?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\b/g;

export function extractAmounts(text: string, cap = 40): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text)) !== null && seen.size < cap) {
    const cleaned = m[1].replace(/,/g, "");
    const n = Number(cleaned);
    // Skip implausible values: fragments like "0.00" and giant ids.
    if (n > 0 && n < 100_000) seen.add(cleaned);
  }
  return [...seen];
}
