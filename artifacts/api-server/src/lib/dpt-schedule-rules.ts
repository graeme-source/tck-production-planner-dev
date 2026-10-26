/**
 * Scheduled DPT rules — which rule covers a plan date (pure, tested). The
 * loader and the why are in dpt-schedules.ts.
 */
export interface DptScheduleRow {
  id: number;
  recipeId: number;
  startsOn: string;
  endsOn: string | null;
  extraBatches: number;
  reason: string | null;
  endedAt: string | null;
}

export interface DptCap { scheduleId: number; extraBatches: number; reason: string | null; startsOn: string; endsOn: string | null }

/** The rule covering `date` for each recipe: started on or before it, not
 *  finished before it ("End now" sets the end date to yesterday, so plans
 *  made while it ran still show it). If two overlap, the later start wins. */
export function capsForDate(rows: readonly DptScheduleRow[], date: string): Map<number, DptCap> {
  const out = new Map<number, DptCap>();
  const live = rows
    .filter(r => r.startsOn <= date && (r.endsOn == null || r.endsOn >= date))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id - b.id);
  for (const r of live) {
    out.set(r.recipeId, { scheduleId: r.id, extraBatches: r.extraBatches, reason: r.reason, startsOn: r.startsOn, endsOn: r.endsOn });
  }
  return out;
}
