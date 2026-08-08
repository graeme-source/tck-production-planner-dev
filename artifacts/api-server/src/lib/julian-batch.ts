/** Julian batch numbers are YYDDD (26217 = day 217 of 2026 = 5 Aug) — the
 *  production date printed on every pack label. Null when the number doesn't
 *  parse (e.g. the unknown-batch sentinel 0). */
export function productionDateFromJulianBatch(batchNumber: number): string | null {
  if (!Number.isInteger(batchNumber) || batchNumber < 10000 || batchNumber > 99999) return null;
  const yy = Math.floor(batchNumber / 1000);
  const ddd = batchNumber % 1000;
  if (ddd < 1 || ddd > 366) return null;
  const d = new Date(Date.UTC(2000 + yy, 0, ddd, 12));
  return d.toISOString().slice(0, 10);
}
