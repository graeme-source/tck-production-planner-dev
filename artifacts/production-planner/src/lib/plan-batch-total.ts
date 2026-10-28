/**
 * Create Plan's "Total batches" — the ONE number the operator sets, and how
 * it is shared across the recipe rows (Graeme, 28 Oct 2026: "We just want the
 * suggestion of how many batches, and then we want to be able to change the
 * number of batches up and down manually … We can't actually override it.").
 *
 * The rule: the total typed is the total the rows add up to. Nothing caps it
 * silently.
 *
 * Before this file, typing 110 left the rows on 98 ("Planned 98 / 110"):
 *   - the typed total was shared across EVERY DPT row, unticked ones too, so
 *     an unticked recipe's share simply vanished from the plan;
 *   - the slow-meat tray limit then cut slow-meat rows and the batches it cut
 *     went nowhere;
 *   - hand-added recipes sat outside the total, and a scheduled DPT rule
 *     ("orders + N batches") was forgotten as soon as the total was typed.
 * Here the total is shared across the ticked DPT rows only, rows that keep a
 * fixed number (queued test production, recipes added by hand) take their
 * day capacity off the top, and whatever the slow-meat limit cuts is handed
 * to the recipes that have no slow meat. If the batches still cannot all be
 * placed (every row is slow meat), the screen says "Rows add up to N".
 *
 * Pure — no React, no network. The solver is @workspace/plan-margin's
 * solveTargetAllocation, the same code the server's /calculate uses, so the
 * screen and the API cannot diverge.
 */
import { minBatchesForOrders, solveTargetAllocation, type PlanMarginSettings } from "@workspace/plan-margin";

/** Minimal shape the allocator needs. `salesPercent` is the surplus weight,
 *  already normalised by the caller (DPT split → live sales → equal).
 *  `stockAfterPacks` is the projected packs left after this horizon's
 *  dispatches with NO production — estimatedFactoryNumber − bag equivalents
 *  − dispatch2 − dispatch3, may be negative; the allocator adds the deficit
 *  production back itself. `demandPacks` (dispatch2 + dispatch3) sets the
 *  row's whole-batch floor: orders + the safety margin (@workspace/plan-margin). */
export interface AllocRecipe {
  deficitBatches: number;
  salesPercent: number;
  packsSold: number;
  packsPerBatch: number;
  stockAfterPacks: number;
  demandPacks: number;
  /** A scheduled DPT rule's "orders + N batches" for this plan date. */
  extraBatchesCap?: number | null;
}

export interface AllocResult {
  suggestedBatches: number;
  surplusBatches: number;
  targetStockPacks: number | null;
}

/** Target-stock allocation (Graeme, 2026-08-06): the plan should RESULT in
 *  end-of-horizon factory numbers split by the DPT percentages. Every row is
 *  floored at the whole batches that cover its orders + the safety margin
 *  (15 Oct 2026). Shared by the Create and Edit Plan dialogs. */
export function allocateBatchesToTargets(recipes: AllocRecipe[], capacity: number, margin: PlanMarginSettings): AllocResult[] {
  const totalPacksSold = recipes.reduce((s, r) => s + r.packsSold, 0);
  const solved = solveTargetAllocation(recipes.map(r => ({
    weight: totalPacksSold > 0 ? r.salesPercent : 0,
    ppb: r.packsPerBatch,
    proj: r.stockAfterPacks,
    floorBatches: minBatchesForOrders({
      demandPacks: r.demandPacks,
      stockPacks: r.stockAfterPacks + r.demandPacks,
      packsPerBatch: r.packsPerBatch,
    }, margin).batches,
    extraBatchesCap: r.extraBatchesCap ?? null,
  })), capacity);
  return recipes.map((r, idx) => ({
    suggestedBatches: solved.batches[idx],
    surplusBatches: Math.max(0, solved.batches[idx] - r.deficitBatches),
    targetStockPacks: solved.targets[idx],
  }));
}

/** The plan-row fields the typed-total distribution reads. */
export interface TotalPlanRow {
  id: string;
  recipeId: number;
  included: boolean;
  /** Came from the DPT calculation (core menu or an orders-led chilled row). */
  isFromDpt: boolean;
  batchesTarget: number;
  dptPercent?: number;
  salesPercent: number;
  deficitBatches: number;
  packsPerBatch: number;
  packSize: number;
  eightPackBagCount?: number;
  estimatedFactoryNumber: number;
  dispatch2Qty: number;
  dispatch3Qty: number;
  /** A scheduled DPT rule's "orders + N batches" for this plan date. */
  extraBatchesCap?: number | null;
}

/** Queued test production: fixed batches the operator didn't choose here. */
export const isQueuedRow = (row: { id: string }): boolean => row.id.startsWith("queued-");

/** 2-pack stock consumed by this row's 8-pack bags (8 portions = 8/packSize
 *  packs). Mirrors `bagPackEquivalents` on the server. */
export function bagPackEquivalents(row: Pick<TotalPlanRow, "packSize" | "eightPackBagCount">): number {
  const packSize = row.packSize || 2;
  return (row.eightPackBagCount ?? 0) * (8 / packSize);
}

export interface PlanTotalOptions<R extends TotalPlanRow> {
  /** Calzone batches of day capacity a row uses (0 outside the main kitchen;
   *  a recipe with an equivalence, like buns, by its equivalence). Default:
   *  its batches. */
  capacityOf?: (row: R) => number;
  /** Whether a row is on the line the total counts (the main kitchen).
   *  Default: every row. */
  inTotal?: (row: R) => boolean;
}

/** Rows that share the typed total: ticked, from the DPT, not queued. */
export function sharesTotal<R extends TotalPlanRow>(row: R, opts: PlanTotalOptions<R> = {}): boolean {
  return row.included && row.isFromDpt && !isQueuedRow(row) && (opts.inTotal?.(row) ?? true);
}

/** What the ticked rows add up to, in the same units as the total box. */
export function rowsBatchTotal<R extends TotalPlanRow>(rows: readonly R[], opts: PlanTotalOptions<R> = {}): number {
  const cap = opts.capacityOf ?? ((r: R) => r.batchesTarget);
  const sum = rows.reduce((s, r) => s + (r.included && (opts.inTotal?.(r) ?? true) ? cap(r) : 0), 0);
  return Math.round(sum * 100) / 100;
}

/** Weights for the sharing rows, normalised across just those rows: DPT
 *  split when any DPT is set, else live sales, else equal. */
export function allocRecipesFor(rows: readonly TotalPlanRow[]): AllocRecipe[] {
  const sumDpt = rows.reduce((s, r) => s + (r.dptPercent ?? 0), 0);
  const sumSales = rows.reduce((s, r) => s + (r.salesPercent || 0), 0);
  const fallback = 100 / Math.max(1, rows.length);
  return rows.map(r => ({
    deficitBatches: r.deficitBatches,
    salesPercent: sumDpt > 0
      ? ((r.dptPercent ?? 0) / sumDpt) * 100
      : sumSales > 0 ? ((r.salesPercent || 0) / sumSales) * 100 : fallback,
    // The solver only checks packsSold > 0 to decide whether to spread
    // surplus at all — any positive value does the job.
    packsSold: 1,
    packsPerBatch: r.packsPerBatch,
    stockAfterPacks: r.estimatedFactoryNumber - bagPackEquivalents(r) - r.dispatch2Qty - r.dispatch3Qty,
    demandPacks: r.dispatch2Qty + r.dispatch3Qty,
    extraBatchesCap: r.extraBatchesCap ?? null,
  }));
}

export interface DistributeOptions<R extends TotalPlanRow> extends PlanTotalOptions<R> {
  /** Return the row set to this allocation (batches, suggestion, tins…). */
  apply: (row: R, alloc: AllocResult) => R;
  /** A hard limit that may cut rows (the slow-meat tray limit). Rows it cuts
   *  keep the cut number and the batches go to the other sharing rows. */
  cap?: (rows: R[]) => R[];
}

/**
 * Share `total` (calzone batches for the day) across the rows so the ticked
 * rows add up to it. Rows that don't share (queued test production, recipes
 * added by hand) keep their batches and take their day capacity off the top;
 * unticked rows are left exactly as they are.
 */
export function distributePlanTotal<R extends TotalPlanRow>(
  rows: R[],
  total: number,
  margin: PlanMarginSettings,
  opts: DistributeOptions<R>,
): R[] {
  const sharing = rows.filter(r => sharesTotal(r, opts));
  if (sharing.length === 0) return rows;
  const capacityOf = opts.capacityOf ?? ((r: R) => r.batchesTarget);
  const fixed = rows
    .filter(r => r.included && !sharesTotal(r, opts) && (opts.inTotal?.(r) ?? true))
    .reduce((s, r) => s + capacityOf(r), 0);
  const pool = Math.max(0, Math.round((Number(total) || 0) - fixed));

  // Rows the hard limit holds below their share, at the number it allows.
  const held = new Map<string, R>();
  let out = rows;
  for (let pass = 0; pass < 12; pass++) {
    const free = sharing.filter(r => !held.has(r.id));
    const heldBatches = [...held.values()].reduce((s, r) => s + r.batchesTarget, 0);
    const alloc = allocateBatchesToTargets(allocRecipesFor(free), Math.max(0, pool - heldBatches), margin);
    const allocById = new Map(free.map((r, i) => [r.id, alloc[i]]));
    const next = rows.map(r => held.get(r.id) ?? (allocById.has(r.id) ? opts.apply(r, allocById.get(r.id)!) : r));
    if (!opts.cap) return next;
    const capped = opts.cap(next);
    out = capped;
    // Only a cut to a SHARING row is handed on; a row added by hand that the
    // limit trims stays trimmed (and the screen shows the rows' real total).
    const cut = capped.filter((c, i) => sharesTotal(c, opts) && c.batchesTarget !== next[i].batchesTarget);
    if (cut.length === 0) return capped;
    // Re-run with the cut rows (and any already held) fixed at what the limit
    // allows: their batches go to the rows the limit doesn't touch.
    for (const c of cut) held.set(c.id, c);
    for (const id of [...held.keys()]) {
      const now = capped.find(r => r.id === id);
      if (now) held.set(id, now);
    }
  }
  return out;
}

// ── Who's on: the one team line under the total ─────────────────────────────

export interface RotaPerson { name: string; position: string }

/** Same rule as the server's schedule-capacity (Planday position "Dough Prep"). */
const DOUGH_PREP_POSITION = /^dough\s*prep$/i;

export interface RotaLine {
  /** "9 on shift today" / "9 on shift on Thu 30 Oct". */
  onShift: string;
  /** "Dough prep: Sam" — null when nobody is on dough prep. */
  doughPrep: string | null;
}

/** The team line for the plan date. `dayLabel` is "today" or "on Thu 30 Oct". */
export function rotaLine(rota: { teamSize?: number; hasDoughPrep?: boolean; people?: RotaPerson[] }, dayLabel: string): RotaLine {
  const names = (rota.people ?? []).filter(p => DOUGH_PREP_POSITION.test(p.position.trim())).map(p => p.name);
  const unique = [...new Set(names)];
  const doughPrep = unique.length > 0
    ? `Dough prep: ${unique.join(" & ")}`
    : rota.hasDoughPrep ? "Dough prep on" : null;
  return { onShift: `${rota.teamSize ?? (rota.people ?? []).length} on shift ${dayLabel}`, doughPrep };
}
