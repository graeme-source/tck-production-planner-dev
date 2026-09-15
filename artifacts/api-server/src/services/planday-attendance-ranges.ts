/**
 * Pure date-range coverage maths for the Planday attendance mirror —
 * separated from planday-attendance-cache.ts so it can be unit-tested
 * without touching the database module.
 */

export interface DateRange { from: string; to: string }

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which parts of `requested` the mirror hasn't covered yet, given the
 * contiguous covered range (both bounds null when nothing is synced).
 * Returns 0, 1 or 2 ranges: the piece before coverage and the piece after.
 * Coverage is kept contiguous by the caller: after syncing the pieces the
 * new coverage is the union of old coverage and the request.
 */
export function missingRanges(
  requested: DateRange,
  covered: { from: string | null; to: string | null },
): DateRange[] {
  if (requested.from > requested.to) return [];
  if (!covered.from || !covered.to) return [requested];
  const out: DateRange[] = [];
  if (requested.from < covered.from) {
    // Up to the day before coverage starts — but never past the request end.
    const end = addDays(covered.from, -1) < requested.to ? addDays(covered.from, -1) : requested.to;
    out.push({ from: requested.from, to: end });
  }
  if (requested.to > covered.to) {
    const start = addDays(covered.to, 1) > requested.from ? addDays(covered.to, 1) : requested.from;
    out.push({ from: start, to: requested.to });
  }
  return out;
}

/** Union of coverage and a newly synced request, as one contiguous range. */
export function extendCoverage(
  covered: { from: string | null; to: string | null },
  synced: DateRange,
): { from: string; to: string } {
  if (!covered.from || !covered.to) return { from: synced.from, to: synced.to };
  return {
    from: synced.from < covered.from ? synced.from : covered.from,
    to: synced.to > covered.to ? synced.to : covered.to,
  };
}
