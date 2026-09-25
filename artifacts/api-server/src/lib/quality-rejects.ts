/**
 * Quality rejects — the two classifications (Graeme, 2026-09-25: "They're
 * both quality rejects, but some of them are going to be dog bins, and some
 * of them are wonkies. Two different classifications of quality rejects.").
 *
 *   wonky   — cooked but not pretty enough for a normal pack. Still sellable:
 *             it waits on the Wonky Rack (wonly_count, the live rack count)
 *             until the wrapping team transfers the lot to Wonky stock in the
 *             Product Freezer (/wonky-to-freezer, which zeroes wonly_count).
 *             wonly_total is the day's cumulative count for reporting.
 *   dog_bin — too far gone even for Wonky stock. Thrown away. dog_bin_count
 *             is never reset (there is no rack to transfer from) and it is
 *             NEVER added to the freezer, the fridge or any stock count.
 *
 * Both kinds reduce what reaches the fridge (see remainingWrappingPacks in
 * @workspace/stock-prediction and netTwoPacks on the stations).
 *
 * Pure: the route (routes/quality-rejects.ts) turns these decisions into one
 * atomic UPDATE plus an audit row. Tested without a database.
 */

export const QUALITY_REJECT_KINDS = ["wonky", "dog_bin"] as const;
export type QualityRejectKind = (typeof QUALITY_REJECT_KINDS)[number];

/** The production_plan_items counters a quality-reject tap may move. Nothing
 *  outside this list — in particular no fridge or freezer quantity — is ever
 *  touched by a tap. */
export type RejectCounter = "wonlyCount" | "wonlyTotal" | "dogBinCount";
export type RejectCounts = Record<RejectCounter, number>;

export type TapDelta = 1 | -1;

/** Which counters one tap moves, and by how much. */
export function rejectCounterChanges(kind: QualityRejectKind, delta: TapDelta): Partial<Record<RejectCounter, TapDelta>> {
  if (kind === "wonky") {
    // The total moves with the rack count so an undo of a mistaken tap
    // doesn't leave the day's recorded total inflated (unchanged behaviour).
    return { wonlyCount: delta, wonlyTotal: delta };
  }
  return { dogBinCount: delta };
}

/** The counter that must be above zero before a removal is allowed. For
 *  wonkies that's the live rack count: once the rack has been transferred to
 *  the freezer there's nothing left on it to take off. */
export function liveCounter(kind: QualityRejectKind): RejectCounter {
  return kind === "wonky" ? "wonlyCount" : "dogBinCount";
}

export const REJECT_LABELS: Record<QualityRejectKind, { name: string; alreadyZero: string }> = {
  wonky: { name: "Wonky", alreadyZero: "Wonky count is already 0" },
  dog_bin: { name: "Dog bin", alreadyZero: "Dog bin count is already 0" },
};

export type TapResult =
  | { ok: true; counts: RejectCounts }
  | { ok: false; reason: "already_zero" };

/**
 * What one tap does to an item's counters. Mirrors the SQL the route runs
 * (increment, or decrement guarded on the live counter being above zero, each
 * floored at 0) so the rules are tested here once.
 */
export function applyRejectTap(counts: RejectCounts, kind: QualityRejectKind, delta: TapDelta): TapResult {
  if (delta < 0 && (counts[liveCounter(kind)] ?? 0) <= 0) return { ok: false, reason: "already_zero" };
  const next: RejectCounts = { ...counts };
  for (const [col, d] of Object.entries(rejectCounterChanges(kind, delta)) as Array<[RejectCounter, TapDelta]>) {
    next[col] = Math.max(0, (next[col] ?? 0) + d);
  }
  return { ok: true, counts: next };
}

/** One day's quality rejects for the meetings: wonkies use the cumulative
 *  total (survives the freezer transfer), dog bins their never-reset count. */
export function sumQualityRejects(items: Array<{ wonlyTotal: number | null; dogBinCount?: number | null }>): { wonky: number; dogBin: number } {
  let wonky = 0;
  let dogBin = 0;
  for (const it of items) {
    wonky += it.wonlyTotal ?? 0;
    dogBin += it.dogBinCount ?? 0;
  }
  return { wonky, dogBin };
}
