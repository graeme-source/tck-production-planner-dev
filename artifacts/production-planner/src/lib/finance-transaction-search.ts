/**
 * Searching outstanding transactions as you type (Graeme, 26 Nov 2026): every
 * word must appear in the supplier, the card description, the amount (755,
 * 755.10 or £755.10), the date (6 Nov, 2026-11-06) or the cardholder.
 * Objective I.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function matchesTransactionSearch(
  t: { supplier: string; descriptor: string; amount: string; lineDate: string; cardholder?: string | null },
  query: string,
): boolean {
  const words = query.toLowerCase().replace(/[£,]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const [y, m, d] = t.lineDate.split("-").map(Number);
  const amount = Number(t.amount);
  const hay = [
    t.supplier, t.descriptor, t.cardholder ?? "", t.lineDate,
    Number.isFinite(amount) ? amount.toFixed(2) : t.amount,
    d && m ? `${d} ${MONTHS[m - 1]} ${y}` : "",
  ].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
