/**
 * The reading a temperature check should show: the most recently recorded
 * one. Temperatures are never edited in place — a re-record (Fix queue #81)
 * saves a NEW reading and the earlier ones stay in the log for the auditor —
 * so the screen must pick the latest by time, not by list position (the API
 * returns newest first, while a fresh save is appended to the end).
 */
export function latestTempRecord<T extends { id: number; recordedAt: string }>(
  records: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const r of records) {
    if (!latest) { latest = r; continue; }
    const a = Date.parse(r.recordedAt);
    const b = Date.parse(latest.recordedAt);
    if (a > b || (a === b && r.id > latest.id)) latest = r;
  }
  return latest;
}
