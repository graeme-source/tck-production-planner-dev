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
 *
 * Builders own their numbers (Graeme, 12 Oct 2026, fix-queue #318 from Jane:
 * "The builders need to be able to minus off batches and packs as they see
 * fit"). There is no floor at what the ovens have recorded: the Ovens "From
 * Building" count is its own batch_completions rows (station 'ovens'), one
 * per tray the oven person taps through. If the builders' corrected count is
 * below it, the same save takes the ovens' newest rows off so Ovens never
 * shows more than was built — the oven person doesn't have to find and fix a
 * mistake they didn't make. The only floors left are 0 and the packs already
 * wrapped into the fridge/freezer (real stock, moved only by Wrapping's own
 * confirmed "take back out").
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
  /** The ovens' own rows for this item (server side), so a save that takes
   *  building below the ovens can say which oven rows come off. Optional:
   *  the count alone is enough to work out and show the new number. */
  ovenCompletions?: BuildCompletion[];
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
  /** Batches added (+) / taken off (−) each line. Lines with no change omitted. */
  batchesByLine: Partial<Record<string, number>>;
  /** Loose packs added (+) / taken off (−) each line. Lines with no change omitted. */
  extraPacksByLine: Partial<Record<string, number>>;
  /** The ovens' "From Building" count follows the builders down: never more
   *  oven rows than building rows. */
  ovens: OvenFollow;
  before: BuildNumbers;
  after: BuildNumbers;
}

export interface OvenFollow {
  before: number;
  after: number;
  /** Oven rows to delete (newest first) — only when ovenCompletions given. */
  removeCompletionIds: number[];
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

/** The chosen line first, then the other building lines (and any other
 *  line that has rows), so a typed-in number can come off both lines. */
function lineOrder(first: string, state: BuildEditState): string[] {
  const others = [...BUILDING_LINES, ...state.completions.map(c => c.stationType), ...Object.keys(state.stationExtras)];
  return [...new Set([first, ...others])];
}

/**
 * How many oven rows a building count of `batches` leaves: the ovens can't
 * have cooked more than was built, so they come down to match; going up
 * leaves them alone.
 */
export function ovensAfterEdit(state: BuildEditState, batches: number): OvenFollow {
  const before = Math.max(0, state.ovenBatches);
  const after = Math.max(0, Math.min(before, Math.trunc(batches)));
  const rows = [...(state.ovenCompletions ?? [])].sort(newestFirst);
  return { before, after, removeCompletionIds: rows.slice(0, before - after).map(c => c.id) };
}

/**
 * Turn the staged numbers into exactly what to change. Batches come off the
 * chosen line first (its newest full batch first), then the other line if the
 * chosen one hasn't enough — so a builder can just type the right number.
 * Removing a part batch gives its line back the shortfall that was taken off
 * its extras, so the batch disappears with its own packs and that line's
 * loose-pack count is untouched. Extra packs likewise: the chosen line's
 * loose packs first, then the other line's; additions go on the chosen line.
 * If the new batch count is below the ovens' count, `ovens` says which oven
 * rows come off with it.
 */
export function planBuildEdit(state: BuildEditState, target: EditTarget, lines: EditLines | string): EditPlan {
  const { batches: batchLine, extraPacks: packLine } = linesOf(lines);
  const ppb = ppbOf(state);
  const before = buildNumbers(state);
  const extrasDelta: Record<string, number> = {};
  const batchesByLine: Record<string, number> = {};
  const extraPacksByLine: Record<string, number> = {};
  const bump = (into: Record<string, number>, station: string, d: number) => {
    if (d === 0) return;
    into[station] = (into[station] ?? 0) + d;
  };

  const batchChange = Math.trunc(target.batches) - before.batches;
  const removeCompletionIds: number[] = [];
  let addBatches = 0;
  if (batchChange < 0) {
    const order = lineOrder(batchLine, state).flatMap(l => removalOrder(state.completions, l));
    for (const c of order.slice(0, -batchChange)) {
      removeCompletionIds.push(c.id);
      bump(extrasDelta, c.stationType, shortfallOf(c, ppb));
      bump(batchesByLine, c.stationType, -1);
    }
  } else {
    addBatches = batchChange;
    bump(batchesByLine, batchLine, addBatches);
  }

  const extraChange = Math.trunc(target.extraPacks) - before.extraPacks;
  if (extraChange >= 0) {
    bump(extrasDelta, packLine, extraChange);
    bump(extraPacksByLine, packLine, extraChange);
  } else {
    // Each line's loose packs once the batch change above is applied: its
    // extra_packs (with any part-batch shortfall given back) plus the
    // shortfall of the part batches it still has.
    const loose = (l: string) => {
      const shortfall = state.completions
        .filter(c => c.stationType === l && !removeCompletionIds.includes(c.id))
        .reduce((t, c) => t + shortfallOf(c, ppb), 0);
      return (state.stationExtras[l] ?? 0) + (extrasDelta[l] ?? 0) + shortfall;
    };
    let need = -extraChange;
    for (const l of lineOrder(packLine, state)) {
      if (need <= 0) break;
      const take = Math.min(need, Math.max(0, loose(l)));
      if (take <= 0) continue;
      bump(extrasDelta, l, -take);
      bump(extraPacksByLine, l, -take);
      need -= take;
    }
    // Only reachable below the floor, which editBlockReason refuses.
    if (need > 0) { bump(extrasDelta, packLine, -need); bump(extraPacksByLine, packLine, -need); }
  }
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
  const after = buildNumbers(afterState);
  return {
    removeCompletionIds, addBatches, extrasDelta, batchesByLine, extraPacksByLine,
    ovens: ovensAfterEdit(state, after.batches),
    before, after,
  };
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
 * it's fine. Builders can set any number from 0 up (Graeme, 12 Oct 2026):
 * nothing stops them going below what the ovens recorded — the ovens follow
 * (planBuildEdit().ovens, said before Save by ovensFollowNote) — and a
 * change that one line can't cover comes off the other line too. The one
 * downstream floor left is real stock: the pack total never below what is
 * already wrapped into the fridge/freezer.
 */
export function editBlockReason(state: BuildEditState, target: EditTarget, lines: EditLines | string, unit: UnitWords = BATCH_WORDS): string | null {
  const chosen = linesOf(lines);
  const before = buildNumbers(state);
  if (!Number.isInteger(target.batches) || target.batches < 0) return `${cap(unit.plural)} can't go below 0.`;
  // Below 0 is refused — unless it already was (a part batch taken off by
  // the old Undo left its shortfall behind) and isn't being lowered further.
  const extrasFloor = Math.min(0, before.extraPacks);
  if (!Number.isInteger(target.extraPacks) || target.extraPacks < extrasFloor) return `Extra packs can't go below ${extrasFloor}.`;
  const { after } = planBuildEdit(state, target, chosen);
  if (after.totalPacks < state.packsStored) {
    return `${count(state.packsStored, PACK_WORDS)} ${state.packsStored === 1 ? "is" : "are"} already wrapped and in the fridge or freezer, so the total can't drop below ${state.packsStored}. Wrapping takes packs back out first.`;
  }
  return null;
}

/**
 * What the save will do to the ovens, in words, shown before Save — or null
 * when the ovens aren't affected. e.g. "Ovens has 10 batches recorded from
 * Building — saving will also set Ovens to 9."
 */
export function ovensFollowNote(state: BuildEditState, target: EditTarget, unit: UnitWords = BATCH_WORDS): string | null {
  const o = ovensAfterEdit(state, target.batches);
  if (o.after === o.before) return null;
  return `Ovens has ${count(o.before, unit)} recorded from Building — saving will also set Ovens to ${o.after}.`;
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

/**
 * The summary for the Save button and the audit log, from the plan itself,
 * so it names where each change landed and what the ovens did, e.g.
 * "Batches 10 → 5 (4 off Line 1, 1 off Line 2), Ovens 10 → 5".
 */
export function describeEdit(plan: EditPlan, unit: UnitWords = BATCH_WORDS): string {
  const where = (byLine: Partial<Record<string, number>>) => {
    const entries = Object.entries(byLine).filter((e): e is [string, number] => !!e[1]);
    if (entries.length === 0) return "";
    if (entries.length === 1) {
      const [l, d] = entries[0];
      return ` (${d < 0 ? "taken off" : "added to"} ${lineLabel(l)})`;
    }
    return ` (${entries.map(([l, d]) => `${Math.abs(d)} ${d < 0 ? "off" : "on"} ${lineLabel(l)}`).join(", ")})`;
  };
  const parts: string[] = [];
  if (plan.before.batches !== plan.after.batches) {
    parts.push(`${cap(unit.plural)} ${plan.before.batches} → ${plan.after.batches}${where(plan.batchesByLine)}`);
  }
  if (plan.before.extraPacks !== plan.after.extraPacks) {
    parts.push(`Extra packs ${plan.before.extraPacks} → ${plan.after.extraPacks}${where(plan.extraPacksByLine)}`);
  }
  if (plan.ovens.after !== plan.ovens.before) parts.push(`Ovens ${plan.ovens.before} → ${plan.ovens.after}`);
  return parts.join(", ");
}

/**
 * Building lines in order of who worked on this recipe last: the line with
 * the newest batch row first; a line with batches before one without, and
 * building_1 before building_2 when neither has any.
 */
export function linesByRecentWork(completions: BuildCompletion[]): BuildingLine[] {
  const newest = (l: BuildingLine) => completions
    .filter(c => c.stationType === l)
    .reduce((t, c) => Math.max(t, time(c)), -Infinity);
  return [...BUILDING_LINES].sort((a, b) =>
    (newest(b) - newest(a) || 0) || BUILDING_LINES.indexOf(a) - BUILDING_LINES.indexOf(b));
}

export type ExtraPackTap =
  | { ok: true; line: BuildingLine; extrasDelta: Partial<Record<string, number>> }
  | { ok: false; reason: string };

/**
 * One + / − tap on an "Extra packs" counter. Extras are stored per building
 * line, so every tap has to land on a line:
 *
 *   - a building line's own counter names its line (`requested`): the tap
 *     changes that line only, and − needs that line to hold a loose pack;
 *   - the oven station's counter names no line (Graeme, 9 Oct 2026 — every
 *     oven tap was refused for that). It is the oven person correcting what
 *     the builders made: + goes on the line that most recently recorded a
 *     batch of this recipe (building_1 if none); − comes off the most recent
 *     line that actually holds loose packs, so no line is pushed below 0.
 *
 * The change itself is the building Edit's (planBuildEdit: + on the chosen
 * line, − from lines holding packs, chosen line first) and so are its floors
 * (editBlockReason: never below 0, never below what's already wrapped).
 */
export function planExtraPackTap(state: BuildEditState, delta: 1 | -1, requested?: BuildingLine | null): ExtraPackTap {
  const held = (l: string) => state.stationExtras[l] ?? 0;
  let line: BuildingLine;
  if (requested) {
    if (delta < 0 && held(requested) <= 0) return { ok: false, reason: "This line has no extra packs to take off." };
    line = requested;
  } else {
    const order = linesByRecentWork(state.completions);
    const pick = delta > 0 ? order[0] : order.find(l => held(l) > 0);
    if (!pick) return { ok: false, reason: "There are no extra packs to take off." };
    line = pick;
  }
  const now = buildNumbers(state);
  const target = { batches: now.batches, extraPacks: now.extraPacks + delta };
  const reason = editBlockReason(state, target, line);
  if (reason) return { ok: false, reason };
  return { ok: true, line, extrasDelta: planBuildEdit(state, target, line).extrasDelta };
}
