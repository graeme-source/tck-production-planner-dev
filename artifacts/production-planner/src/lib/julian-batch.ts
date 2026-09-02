/**
 * Julian batch numbers are YYDDD (26217 = day 217 of 2026 = 5 Aug) — the
 * production date printed on every pack label. Client-side port of the
 * server's lib/julian-batch.ts, so the packing opening check can colour a
 * batch chip red the instant it's tapped instead of after a round-trip.
 * The server recomputes the verdict on record — this copy is display-only.
 */
export function productionDateFromJulianBatch(batchNumber: number): string | null {
  if (!Number.isInteger(batchNumber) || batchNumber < 10000 || batchNumber > 99999) return null;
  const yy = Math.floor(batchNumber / 1000);
  const ddd = batchNumber % 1000;
  if (ddd < 1 || ddd > 366) return null;
  const d = new Date(Date.UTC(2000 + yy, 0, ddd, 12));
  return d.toISOString().slice(0, 10);
}

/** Noon-UTC calendar-day arithmetic (matches the server's expiry maths). */
export function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface BatchDispatchVerdict {
  useByDate: string;
  /** Can this batch be dispatched today? (use-by ≥ earliest acceptable) */
  ok: boolean;
}

/**
 * The dispatch shelf-life verdict for a batch: batch number → made-on date,
 * + the recipe's shelf life → use-by, compared against the earliest
 * acceptable use-by the server computed from the min-days-at-customer rule.
 * Null = can't verify (no shelf life on the recipe, or unparseable batch).
 */
export function batchDispatchVerdict(
  batchNumber: number,
  shelfLifeDays: number | null | undefined,
  earliestOkUseBy: string | null | undefined,
): BatchDispatchVerdict | null {
  if (!shelfLifeDays || shelfLifeDays <= 0 || !earliestOkUseBy) return null;
  const prodDate = productionDateFromJulianBatch(batchNumber);
  if (!prodDate) return null;
  const useByDate = addCalendarDays(prodDate, shelfLifeDays);
  return { useByDate, ok: useByDate >= earliestOkUseBy };
}
