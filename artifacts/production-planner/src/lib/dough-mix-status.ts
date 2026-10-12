/**
 * Dough Prep — which mixes are done, from the saved mix progress
 * (GET /api/dough-mix-progress/:planId) and the balls recorded.
 *
 * Why the balls matter (Graeme, 2026-10-12): ticks and "Mix N complete" used
 * to live only in the iPad's memory, so old days have nothing saved, and a
 * team can forget to press "Mix complete". Balls (dough_prep batch
 * completions) ARE always saved — and you can't ball dough that wasn't
 * mixed. So:
 *   - A saved "Mix N complete" always counts, shown as recorded.
 *   - Balls fill in mixes nobody marked, never undo a saved one:
 *       all balls recorded → every mix done ("Mixed — balls all recorded");
 *       some balls        → ceil(balls ÷ balls per mix) mixes done, capped
 *                           at the mix count, shown as estimated.
 *     Estimated mixes are the lowest-numbered ones not already saved.
 *   - Ingredient ticks come only from what was saved.
 * Pure — tested in dough-mix-status.test.ts.
 */

export type SavedDoughMix = {
  mixNo: number;
  ticked: Array<{ ingredientKey: string; at?: string; byUserId?: number | null; byName?: string | null }>;
  completedAt: string | null;
  completedBy?: { id: number; name: string | null } | null;
};

export type DoughMixStatus = {
  /** Every mix counted as done — saved or estimated. */
  completedMixes: Set<number>;
  /** The subset of completedMixes that come from balls, not a saved tap. */
  estimatedMixes: Set<number>;
  /** Saved ingredient ticks, by mix number. */
  ticksByMix: Record<number, Set<string>>;
  /** Plain-English note when any mix is estimated, else null. */
  note: string | null;
};

export function deriveDoughMixStatus(input: {
  mixCount: number;
  saved: SavedDoughMix[] | null | undefined;
  ballsRecorded: number;
  ballsNeeded: number;
}): DoughMixStatus {
  const mixCount = Math.max(0, Math.floor(input.mixCount));
  const completedMixes = new Set<number>();
  const estimatedMixes = new Set<number>();
  const ticksByMix: Record<number, Set<string>> = {};

  for (const m of input.saved ?? []) {
    if (m.mixNo < 1 || m.mixNo > mixCount) continue;
    if (m.ticked.length > 0) ticksByMix[m.mixNo] = new Set(m.ticked.map(t => t.ingredientKey));
    if (m.completedAt) completedMixes.add(m.mixNo);
  }

  const balls = Math.max(0, input.ballsRecorded);
  const needed = Math.max(0, input.ballsNeeded);
  const allBalls = needed > 0 && balls >= needed;
  let fromBalls = 0;
  if (mixCount > 0 && balls > 0) {
    fromBalls = allBalls
      ? mixCount
      : needed > 0
        // ceil(balls ÷ (needed ÷ mixCount)), in whole numbers to avoid float drift.
        ? Math.min(mixCount, Math.ceil((balls * mixCount) / needed))
        : 0;
  }

  for (let n = 1; n <= mixCount && completedMixes.size < fromBalls; n++) {
    if (!completedMixes.has(n)) {
      completedMixes.add(n);
      estimatedMixes.add(n);
    }
  }

  const note = estimatedMixes.size === 0
    ? null
    : allBalls
      ? "Mixed — balls all recorded"
      : "Estimated from balls recorded";

  return { completedMixes, estimatedMixes, ticksByMix, note };
}

/** Apply one change to the saved progress — the optimistic update the
 *  station shows before the server answers. Mirrors the PUT's rules. */
export type DoughMixChange =
  | { action: "tick"; mixNo: number; ingredientKey: string; ticked: boolean }
  | { action: "complete"; mixNo: number; completed: boolean };

export function applyDoughMixChange(saved: SavedDoughMix[], change: DoughMixChange, nowIso: string): SavedDoughMix[] {
  const existing = saved.find(m => m.mixNo === change.mixNo)
    ?? { mixNo: change.mixNo, ticked: [], completedAt: null, completedBy: null };
  let next: SavedDoughMix;
  if (change.action === "tick") {
    const others = existing.ticked.filter(t => t.ingredientKey !== change.ingredientKey);
    next = {
      ...existing,
      ticked: change.ticked ? [...others, { ingredientKey: change.ingredientKey, at: nowIso }] : others,
    };
  } else {
    next = { ...existing, completedAt: change.completed ? nowIso : null, completedBy: change.completed ? existing.completedBy ?? null : null };
  }
  return [...saved.filter(m => m.mixNo !== change.mixNo), next].sort((a, b) => a.mixNo - b.mixNo);
}

/** The dashboard's Dough Prep tile (Graeme, 2026-10-12: "a progress bar on
 *  the dashboard for the dough prep to see where we're up to … and when it's
 *  finished, it's complete"). Built on deriveDoughMixStatus, so the tile and
 *  the station always agree. No KPI or timing yet — progress only.
 *  pct = mixing and balling weighted equally (mixing shows before any ball
 *  is rolled; 100 only when both are done). */
export type DoughTileSummary = {
  line: string;
  pct: number;
  complete: boolean;
  /** Nothing to make for this plan — the tile shows no bar. */
  empty: boolean;
};

export function doughTileSummary(input: {
  mixCount: number;
  saved: SavedDoughMix[] | null | undefined;
  ballsRecorded: number;
  ballsNeeded: number;
}): DoughTileSummary {
  const mixCount = Math.max(0, Math.floor(input.mixCount));
  const needed = Math.max(0, input.ballsNeeded);
  if (mixCount === 0 && needed === 0) return { line: "No dough on this plan", pct: 0, complete: false, empty: true };
  const balls = Math.max(0, input.ballsRecorded);
  const mixesDone = Math.min(mixCount, deriveDoughMixStatus(input).completedMixes.size);
  const mixFrac = mixCount > 0 ? mixesDone / mixCount : 1;
  const ballFrac = needed > 0 ? Math.min(1, balls / needed) : 1;
  const complete = mixFrac >= 1 && ballFrac >= 1;
  if (complete) return { line: "Complete ✓", pct: 100, complete, empty: false };
  const pct = Math.min(99, Math.floor(((mixFrac + ballFrac) / 2) * 100));
  const parts: string[] = [];
  if (mixCount > 0) parts.push(`${mixesDone} of ${mixCount} mix${mixCount === 1 ? "" : "es"}`);
  if (needed > 0) parts.push(`${balls} of ${needed} balls`);
  return { line: parts.join(" · "), pct, complete, empty: false };
}
