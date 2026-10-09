/**
 * "Edit production numbers" on the building station — the pure rules,
 * shared by the screen (staging, limits, the summary on the Save button) and
 * the API (which re-checks everything inside its transaction).
 *
 * Why (Graeme, 9 Oct 2026): an extra batch got recorded and neither builder
 * could work out how to take it off — the only way back was an "Undo" that
 * didn't say what it would undo. Now each recipe has one Edit: two counters
 * (Batches, Extra packs), changes staged, one Save.
 *
 * How the numbers are stored (unchanged by this feature):
 *   - every batch is one batch_completions row on building_1 / building_2,
 *     with its time — the TCK run rate and the dashboard KPI count these rows;
 *   - a PART batch is a row with partial_packs = k, and the line that
 *     recorded it had (packsPerBatch − k) taken off its extra_packs, so
 *     `batches × packsPerBatch + Σ extra_packs` is the recipe's pack total;
 *   - extra (loose) packs live per line in building_station_progress.
 *
 * What the builder sees here:
 *   Batches     = every batch row on both lines (part batches included — it is
 *                 the same number as the big counter and what ovens work to);
 *   Extra packs = loose packs not in any batch row (≥ 0): Σ extra_packs plus
 *                 the part-batch shortfall that was taken off them;
 *   Total packs = Batches × packsPerBatch − part-batch shortfall + Extra packs.
 */

export const BUILDING_LINES = ["building_1", "building_2"] as const;
export type BuildingLine = typeof BUILDING_LINES[number];

export interface BuildCompletion {
  id: number;
  stationType: string;
  /** ISO string or Date — only used for "most recent first" ordering. */
  completedAt: string | Date;
  /** Packs in a part batch; null = a full batch. */
  partialPacks: number | null;
}

export interface BuildEditState {
  /** Building-line batch rows for ONE plan item. */
  completions: BuildCompletion[];
  /** Each line's own extra_packs (may be negative after a part batch). */
  stationExtras: Partial<Record<string, number>>;
  packsPerBatch: number;
  /** Batches the ovens have already cooked for this item. */
  ovenBatches: number;
  /** Packs already wrapped into the Production Fridge / Product Freezer. */
  packsStored: number;
}

export interface BuildNumbers {
  batches: number;
  partBatches: number;
  /** Packs in the part batches (Σ partialPacks). */
  partBatchPacks: number;
  extraPacks: number;
  totalPacks: number;
}

export interface EditTarget {
  batches: number;
  extraPacks: number;
}

export interface EditPlan {
  /** Batch rows to delete, in the order chosen. */
  removeCompletionIds: number[];
  /** Full batches to record now, on the editing line. */
  addBatches: number;
  /** Change to each line's extra_packs. Lines with no change are omitted. */
  extrasDelta: Partial<Record<string, number>>;
  before: BuildNumbers;
  after: BuildNumbers;
}

function ppbOf(state: BuildEditState): number {
  return Math.max(1, Math.floor(state.packsPerBatch) || 1);
}

function shortfallOf(c: BuildCompletion, ppb: number): number {
  return c.partialPacks == null ? 0 : Math.max(0, ppb - c.partialPacks);
}

function time(c: BuildCompletion): number {
  const t = c.completedAt instanceof Date ? c.completedAt.getTime() : Date.parse(c.completedAt);
  return Number.isFinite(t) ? t : 0;
}

/** Newest first; id breaks ties (two taps in the same millisecond). */
function newestFirst(a: BuildCompletion, b: BuildCompletion): number {
  return time(b) - time(a) || b.id - a.id;
}

export function buildNumbers(state: BuildEditState): BuildNumbers {
  const ppb = ppbOf(state);
  const parts = state.completions.filter(c => c.partialPacks != null);
  const shortfall = parts.reduce((s, c) => s + shortfallOf(c, ppb), 0);
  const extrasTotal = Object.values(state.stationExtras).reduce<number>((s, v) => s + (v ?? 0), 0);
  const batches = state.completions.length;
  const extraPacks = extrasTotal + shortfall;
  return {
    batches,
    partBatches: parts.length,
    partBatchPacks: parts.reduce((s, c) => s + (c.partialPacks ?? 0), 0),
    extraPacks,
    totalPacks: batches * ppb + extrasTotal,
  };
}

/**
 * Which rows come off when the batch count goes down: full batches before
 * part batches (a part batch is nearly always the recipe's deliberate last
 * one; the mistake is an extra full batch), the editing line before the
 * other line (whoever is editing most likely made the mis-tap), newest first.
 */
export function removalOrder(completions: BuildCompletion[], line: string): BuildCompletion[] {
  const rank = (c: BuildCompletion) => (c.partialPacks == null ? 0 : 2) + (c.stationType === line ? 0 : 1);
  return [...completions].sort((a, b) => rank(a) - rank(b) || newestFirst(a, b));
}

/**
 * Turn the staged numbers into exactly what to change. Removing a part
 * batch gives its line back the shortfall that was taken off its extras, so
 * the batch disappears with its own packs and the loose-pack count is
 * untouched. Extra packs come off lines holding loose packs first (this
 * line first) so the other builder's "PARTIAL BATCH DONE" isn't left
 * pointing at packs that no longer exist.
 */
export function planBuildEdit(state: BuildEditState, target: EditTarget, line: string): EditPlan {
  const ppb = ppbOf(state);
  const before = buildNumbers(state);
  const extrasDelta: Record<string, number> = {};
  const bump = (station: string, d: number) => {
    if (d === 0) return;
    extrasDelta[station] = (extrasDelta[station] ?? 0) + d;
  };

  const batchChange = Math.trunc(target.batches) - before.batches;
  const removeCompletionIds: number[] = [];
  let addBatches = 0;
  if (batchChange < 0) {
    const order = removalOrder(state.completions, line).slice(0, -batchChange);
    for (const c of order) {
      removeCompletionIds.push(c.id);
      bump(c.stationType, shortfallOf(c, ppb));
    }
  } else {
    addBatches = batchChange;
  }

  const extraChange = Math.trunc(target.extraPacks) - before.extraPacks;
  if (extraChange > 0) {
    bump(line, extraChange);
  } else if (extraChange < 0) {
    let toTake = -extraChange;
    const lines = [line, ...BUILDING_LINES.filter(l => l !== line)];
    for (const l of lines) {
      if (toTake <= 0) break;
      const held = Math.max(0, (state.stationExtras[l] ?? 0) + (extrasDelta[l] ?? 0));
      const take = Math.min(held, toTake);
      bump(l, -take);
      toTake -= take;
    }
    if (toTake > 0) bump(line, -toTake);
  }
  for (const k of Object.keys(extrasDelta)) if (extrasDelta[k] === 0) delete extrasDelta[k];

  const afterState: BuildEditState = {
    ...state,
    completions: [
      ...state.completions.filter(c => !removeCompletionIds.includes(c.id)),
      ...Array.from({ length: addBatches }, (_, i) => ({
        id: -1 - i, stationType: line, completedAt: new Date(8.64e15), partialPacks: null,
      })),
    ],
    stationExtras: Object.fromEntries(
      [...new Set([...Object.keys(state.stationExtras), ...Object.keys(extrasDelta)])]
        .map(k => [k, (state.stationExtras[k] ?? 0) + (extrasDelta[k] ?? 0)]),
    ),
  };
  return { removeCompletionIds, addBatches, extrasDelta, before, after: buildNumbers(afterState) };
}

/**
 * Why a staged edit can't be saved, in words for the builder — or null when
 * it's fine. These are the downstream floors: nothing below what the ovens
 * have already cooked, and the pack total never below what is already
 * wrapped into the fridge/freezer.
 */
export function editBlockReason(state: BuildEditState, target: EditTarget, line: string, unit: UnitWords = BATCH_WORDS): string | null {
  if (!Number.isInteger(target.batches) || target.batches < 0) return `${cap(unit.plural)} can't go below 0.`;
  if (!Number.isInteger(target.extraPacks) || target.extraPacks < 0) return "Extra packs can't go below 0.";
  if (target.batches < state.ovenBatches) {
    return `${count(state.ovenBatches, unit)} ${state.ovenBatches === 1 ? "has" : "have"} already gone through the ovens, so this can't go below ${state.ovenBatches}. If the ovens recorded one by mistake, the oven station takes it off first.`;
  }
  const { after } = planBuildEdit(state, target, line);
  if (after.totalPacks < state.packsStored) {
    return `${count(state.packsStored, PACK_WORDS)} ${state.packsStored === 1 ? "is" : "are"} already wrapped and in the fridge or freezer, so the total can't drop below ${state.packsStored}. Wrapping takes packs back out first.`;
  }
  return null;
}

/** The lowest value a counter can go to with the other counter held. */
export function lowestAllowed(state: BuildEditState, target: EditTarget, line: string, field: keyof EditTarget): number {
  let v = target[field];
  while (v > 0 && editBlockReason(state, { ...target, [field]: v - 1 }, line) === null) v--;
  return v;
}

export interface UnitWords { singular: string; plural: string }
export const BATCH_WORDS: UnitWords = { singular: "batch", plural: "batches" };
export const PACK_WORDS: UnitWords = { singular: "pack", plural: "packs" };

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function count(n: number, w: UnitWords): string { return `${n} ${n === 1 ? w.singular : w.plural}`; }

/**
 * Plain summary for the Save button and the audit log, e.g.
 * "Batches 6 → 5, Extra packs 0 → 2". Empty string when nothing changed.
 */
export function editSummary(before: EditTarget, after: EditTarget, unit: UnitWords = BATCH_WORDS): string {
  const parts: string[] = [];
  if (before.batches !== after.batches) parts.push(`${cap(unit.plural)} ${before.batches} → ${after.batches}`);
  if (before.extraPacks !== after.extraPacks) parts.push(`Extra packs ${before.extraPacks} → ${after.extraPacks}`);
  return parts.join(", ");
}
