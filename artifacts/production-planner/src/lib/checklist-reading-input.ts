/**
 * Typing a checklist reading (issue #87) — what the box accepts and how the
 * pass range reads. Whether a reading is in range, and which readings are
 * still missing, come from the server (api-server lib/checklist-readings.ts);
 * this file only handles the keyboard and the wording.
 */

/** "" → null (nothing typed); a number with up to 2 decimals → it;
 *  anything else → undefined (not a reading yet). */
export function parseReadingText(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Keep only what a reading can contain while typing (digits, one point,
 *  a leading minus). A comma is taken as the decimal point. */
export function cleanReadingTyping(text: string): string {
  let out = text.replace(/,/g, ".").replace(/[^\d.-]/g, "");
  const negative = out.startsWith("-");
  out = out.replace(/-/g, "");
  const firstDot = out.indexOf(".");
  if (firstDot >= 0) out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, "");
  return (negative ? "-" : "") + out.slice(0, 12);
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
}

/** How the item's pass range reads, e.g. "Pass: 999 to 1001 g". null = no range. */
export function readingRangeText(min: number | null | undefined, max: number | null | undefined, unit: string): string | null {
  if (min != null && max != null) return `Pass: ${fmt(min)} to ${fmt(max)} ${unit}`;
  if (min != null) return `Pass: at least ${fmt(min)} ${unit}`;
  if (max != null) return `Pass: up to ${fmt(max)} ${unit}`;
  return null;
}

/** The admin form's labels box: one per line (or comma-separated). */
export function labelsFromText(text: string): string[] {
  return text.split(/[\n,]/).map(l => l.trim()).filter(Boolean);
}
