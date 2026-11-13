/**
 * Wrapping pace maths — ONE definition of "packs per hour", shared by the
 * live wrapping station KPI and the Production KPIs history report.
 *
 * The method (Graeme, 13 Nov 2026: "this is when we started, this is when
 * we finished … taking our lunch and snack break as we do on the production
 * line KPI. I don't want to be too smart"):
 *   - Window = first wrap → last wrap.
 *   - Breaks come off exactly as on the line run rate (lib/run-rate.ts):
 *     the morning snack by the clock when the window spans it, lunch when
 *     there's a real stop of 40+ minutes, each plus the restart allowance.
 *   - Nothing else is taken off. Until 13 Nov any gap over 20 minutes was
 *     excluded, which removed 1½–5 hours a day (deliveries, set-up, the
 *     stop-start of stacking) and read ~252/hr against a 180 standard; on
 *     this method the same days read ~114/hr (15 Oct–12 Nov).
 */
import {
  computeBatchesPerHour, DEFAULT_RESTART_ALLOWANCE_MINUTES, LUNCH_ANCHOR, LUNCH_GAP_MINUTES, MORNING_ANCHOR,
  type StandardBreakConfig,
} from "../lib/run-rate";

export interface PaceSub { ts: number; packs: number }

export interface PaceResult {
  packs: number;
  submissions: number;
  /** First wrap → last wrap, minutes. */
  windowMinutes: number | null;
  /** Break minutes taken off (snack and/or lunch, with the allowance). */
  idleMinutes: number | null;
  /** How many breaks were taken off (0–2). */
  idleBreaks: number;
  activeMinutes: number | null;
  packsPerHour: number | null;
}

/** Settings → break lengths when the caller has none to hand. */
export const DEFAULT_WRAPPING_BREAKS: StandardBreakConfig = {
  morning: { anchorMinutes: MORNING_ANCHOR, minutes: 15 },
  lunch: { anchorMinutes: LUNCH_ANCHOR, minutes: 35 },
  allowanceMinutes: DEFAULT_RESTART_ALLOWANCE_MINUTES,
  lunchGapMinutes: LUNCH_GAP_MINUTES,
};

export function paceFromSubs(subs: PaceSub[], breaks: StandardBreakConfig = DEFAULT_WRAPPING_BREAKS): PaceResult {
  const ordered = [...subs].sort((a, b) => a.ts - b.ts);
  const packs = ordered.reduce((s, x) => s + x.packs, 0);
  if (ordered.length < 2) {
    return { packs, submissions: ordered.length, windowMinutes: null, idleMinutes: null, idleBreaks: 0, activeMinutes: null, packsPerHour: null };
  }
  // The line's own window + break rule, fed the wrapping taps' times.
  const r = computeBatchesPerHour(ordered.map(s => new Date(s.ts)), breaks);
  const activeHours = r.activeMinutes > 1 ? r.activeMinutes / 60 : null;
  return {
    packs,
    submissions: ordered.length,
    windowMinutes: r.wallClockMinutes,
    idleMinutes: r.breakMinutesDeducted,
    idleBreaks: (r.morningBreakDeducted ? 1 : 0) + (r.lunchBreakDeducted ? 1 : 0),
    activeMinutes: r.activeMinutes,
    packsPerHour: activeHours != null ? Math.round(packs / activeHours) : null,
  };
}
