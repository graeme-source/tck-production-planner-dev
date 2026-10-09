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
 * Which line each counter's change applies to — the builder picks it in the
 * dialog (Graeme, 2026-10-09: "You can ask which line"). A plain string
 * means the same line for both.
 */
export interface EditLines { batches: string; extraPacks: string }

function linesOf(lines: EditLines | string): EditLines {
  return typeof lines === "string" ? { batches: lines, extraPacks: lines } : lines;
}

/** "building_2" → "Line 2". */
export function lineLabel(line: string): string {
  const n = line.match(/(\d+)$/)?.[1];
  return n ? `Line ${n}` : line;
}

/** One line's own share of a recipe: its batch rows and its loose packs. */
export function lineNumbers(state: BuildEditState, line: string): { batches: number; extraPacks: number } {
  const ppb = ppbOf(state);
  const rows = state.completions.filter(c => c.stationType === line);
  const shortfall = rows.reduce((s, c) => s + shortfallOf(c, ppb), 0);
  return { batches: rows.length, extraPacks: (state.stationExtras[line] ?? 0) + shortfall };
}

/**
 * Which of a line's rows come off when its batch count goes down: full
 * batches before part batches (a part batch is nearly always the recipe's
 * deliberate last one; the mistake is an extra full batch), newest first.
 */
export function removalOrder(completions: BuildCompletion[], line: string): BuildCompletion[] {
  return completions
    .filter(c => c.stationType === line)
    .sort((a, b) => ((a.partialPacks == null ? 0 : 1) - (b.partialPacks == null ? 0 : 1)) || newestFirst(a, b));
}

/**
 * Turn the staged numbers into exactly what to change, on the chosen line(s).
 * Removing a part batch gives its line back the shortfall that was taken off
 * its extras, so the batch disappears with its own packs and that line's
 * loose-pack count is untouched. A line can only give up what it has —
 * editBlockReason says so in words; this never takes from the other line.
 */
export function planBuildEdit(state: BuildEditState, target: EditTarget, lines: EditLines | string): EditPlan {
  const { batches: batchLine, extraPacks: packLine } = linesOf(lines);
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
    for (const c of removalOrder(state.completions, batchLine).slice(0, -batchChange)) {
      removeCompletionIds.push(c.id);
      bump(c.stationType, shortfallOf(c, ppb));
    }
  } else {
    addBatches = batchChange;
  }

  const extraChange = Math.trunc(target.extraPacks) - before.extraPacks;
  bump(packLine, extraChange);
  for (const k of Object.keys(extrasDelta)) if (extrasDelta[k] === 0) delete extrasDelta[k];

  const afterState: BuildEditState = {
    ...state,
    completions: [
      ...state.completions.filter(c => !removeCompletionIds.includes(c.id)),
      ...Array.from({ length: addBatches }, (_, i) => ({
        id: -1 - i, stationType: batchLine, completedAt: new Date(8.64e15), partialPacks: null,
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
 * Can `line` give up `n` batches / extra packs? Used for the line buttons
 * (a line with nothing to remove is disabled) and by editBlockReason.
 */
export function lineCanGive(state: BuildEditState, line: string, field: keyof EditTarget, n: number): boolean {
  const own = lineNumbers(state, line);
  return n <= 0 || (field === "batches" ? own.batches : Math.max(0, own.extraPacks)) >= n;
}

/**
 * Why a staged edit can't be saved, in words for the builder — or null when
 * it's fine. The chosen line must have what's being taken off it; then the
 * downstream floors: nothing below what the ovens have already cooked, and
 * the pack total never below what is already wrapped into the fridge/freezer.
 */
export function editBlockReason(state: BuildEditState, target: EditTarget, lines: EditLines | string, unit: UnitWords = BATCH_WORDS): string | null {
  const chosen = linesOf(lines);
  const before = buildNumbers(state);
  if (!Number.isInteger(target.batches) || target.batches < 0) return `${cap(unit.plural)} can't go below 0.`;
  // Below 0 is refused — unless it already was (a part batch taken off by
  // the old Undo left its shortfall behind) and isn't being lowered further.
  const extrasFloor = Math.min(0, before.extraPacks);
  if (!Number.isInteger(target.extraPacks) || target.extraPacks < extrasFloor) return `Extra packs can't go below ${extrasFloor}.`;
  if (target.batches < state.ovenBatches) {
    return `${count(state.ovenBatches, unit)} ${state.ovenBatches === 1 ? "has" : "have"} already gone through the ovens, so this can't go below ${state.ovenBatches}. If the ovens recorded one by mistake, the oven station takes it off first.`;
  }
  const batchesOff = before.batches - target.batches;
  if (!lineCanGive(state, chosen.batches, "batches", batchesOff)) {
    const has = lineNumbers(state, chosen.batches).batches;
    return `${lineLabel(chosen.batches)} has only ${count(has, unit)} of this recipe recorded.`;
  }
  const packsOff = before.extraPacks - target.extraPacks;
  if (packsOff > 0 && !lineCanGive(state, chosen.extraPacks, "extraPacks", packsOff)) {
    const has = Math.max(0, lineNumbers(state, chosen.extraPacks).extraPacks);
    return `${lineLabel(chosen.extraPacks)} has only ${count(has, { singular: "extra pack", plural: "extra packs" })} on this recipe.`;
  }
  const { after } = planBuildEdit(state, target, chosen);
  if (after.totalPacks < state.packsStored) {
    return `${count(state.packsStored, PACK_WORDS)} ${state.packsStored === 1 ? "is" : "are"} already wrapped and in the fridge or freezer, so the total can't drop below ${state.packsStored}. Wrapping takes packs back out first.`;
  }
  return null;
}

/**
 * The lowest value a counter can go to with the other counter held, if
 * the builder picks whichever line has the most to give.
 */
export function lowestAllowed(state: BuildEditState, target: EditTarget, field: keyof EditTarget, otherLine: string = BUILDING_LINES[0]): number {
  let v = target[field];
  const ok = (val: number) => BUILDING_LINES.some(l =>
    editBlockReason(state, { ...target, [field]: val }, field === "batches" ? { batches: l, extraPacks: otherLine } : { batches: otherLine, extraPacks: l }) === null);
  while (ok(v - 1)) v--;
  return v;
}

export interface UnitWords { singular: string; plural: string }
export const BATCH_WORDS: UnitWords = { singular: "batch", plural: "batches" };
export const PACK_WORDS: UnitWords = { singular: "pack", plural: "packs" };

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function count(n: number, w: UnitWords): string { return `${n} ${n === 1 ? w.singular : w.plural}`; }

/**
 * Plain summary for the Save button and the audit log, e.g.
 * "Batches 9 → 8 (taken off Line 2), Extra packs 0 → 2 (added to Line 1)".
 * Empty string when nothing changed. Lines are named only when given.
 */
export function editSummary(before: EditTarget, after: EditTarget, unit: UnitWords = BATCH_WORDS, lines?: EditLines | string): string {
  const chosen = lines ? linesOf(lines) : null;
  const where = (b: number, a: number, line: string | undefined) =>
    line ? ` (${a < b ? "taken off" : "added to"} ${lineLabel(line)})` : "";
  const parts: string[] = [];
  if (before.batches !== after.batches) parts.push(`${cap(unit.plural)} ${before.batches} → ${after.batches}${where(before.batches, after.batches, chosen?.batches)}`);
  if (before.extraPacks !== after.extraPacks) parts.push(`Extra packs ${before.extraPacks} → ${after.extraPacks}${where(before.extraPacks, after.extraPacks, chosen?.extraPacks)}`);
  return parts.join(", ");
}
