/**
 * Wrapping pace maths (extracted 2026-09-15 so the live station KPI and the
 * Production KPIs history report use ONE definition of "packs per hour").
 *
 * Active time = first submission to last, minus gaps longer than the idle
 * threshold (20 minutes for wrapping: it's stop-start work — a 24-stack can
 * legitimately take ten minutes, and the team gets pulled onto deliveries —
 * so only long gaps pause the clock, and the whole gap is then excluded).
 */

export const WRAPPING_IDLE_THRESHOLD_MS = 20 * 60 * 1000;

export interface PaceSub { ts: number; packs: number }

export interface PaceResult {
  packs: number;
  submissions: number;
  windowMinutes: number | null;
  idleMinutes: number | null;
  idleBreaks: number;
  activeMinutes: number | null;
  packsPerHour: number | null;
}

export function paceFromSubs(subs: PaceSub[], idleThresholdMs: number = WRAPPING_IDLE_THRESHOLD_MS): PaceResult {
  const ordered = [...subs].sort((a, b) => a.ts - b.ts);
  const packs = ordered.reduce((s, x) => s + x.packs, 0);
  if (ordered.length < 2) {
    return { packs, submissions: ordered.length, windowMinutes: null, idleMinutes: null, idleBreaks: 0, activeMinutes: null, packsPerHour: null };
  }
  const windowMs = ordered[ordered.length - 1].ts - ordered[0].ts;
  let idleMs = 0;
  let idleBreaks = 0;
  for (let i = 1; i < ordered.length; i++) {
    const gap = ordered[i].ts - ordered[i - 1].ts;
    if (gap > idleThresholdMs) {
      idleMs += gap;
      idleBreaks++;
    }
  }
  const activeMs = Math.max(0, windowMs - idleMs);
  const activeHours = activeMs > 60_000 ? activeMs / 3_600_000 : null;
  return {
    packs,
    submissions: ordered.length,
    windowMinutes: Math.round(windowMs / 60_000),
    idleMinutes: Math.round(idleMs / 60_000),
    idleBreaks,
    activeMinutes: Math.round(activeMs / 60_000),
    packsPerHour: activeHours != null ? Math.round(packs / activeHours) : null,
  };
}
