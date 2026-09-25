/**
 * Team efficiency — one production day, from raw components to the KPI
 * (Objective I; pure, no I/O).
 *
 * The nightly job stores each day's RAW components (packs and RRP value made
 * per line, despatched per line, labour cost, line-only labour). Everything a
 * founder setting can change — discount rates, despatch share, 8-pack
 * factor, the standard — is applied here, so a settings change restates
 * history without another trip to Planday.
 *
 * No product, recipe or category names in here: lines are recipe categories
 * as data, and the rates/positions per category come from settings.
 */
import { creditedValue } from "./team-efficiency";

// ── Settings ──────────────────────────────────────────────────────────────

export interface TeSettings {
  /** Value credited per £1 of labour that counts as 100%. Fixed, not rolling. */
  standardRatio: number;
  /** When the founder set the standard (YYYY-MM-DD), shown beside it. */
  standardSetOn: string | null;
  /** Share of credit given on despatch rather than production, e.g. 0.11. */
  despatchShare: number;
  /** Fixed discount per line (recipe category), e.g. { [category]: 0.22 }. */
  discountRates: Record<string, number>;
  /** Net £ of an 8-pack bag ÷ (its 2-packs × RRP), e.g. 0.72. */
  eightPackFactor: number;
  /** Planday position names that only ever work one line, by category —
   *  their pay comes off a day when that line didn't run in the planner. */
  linePositions: Record<string, string[]>;
  /** Holiday accrued on every hour worked (not inside the hourly rate). */
  holidayAccrual: number;
  /** Name of the Planday section whose positions count as production. */
  productionSection: string;
}

/** Fallbacks only — the real defaults (including per-line discount rates)
 *  are seeded by migration 0129 as data. */
export const FALLBACK_SETTINGS: TeSettings = {
  standardRatio: 4.78,
  standardSetOn: null,
  despatchShare: 0.11,
  discountRates: {},
  eightPackFactor: 0.72,
  linePositions: {},
  holidayAccrual: 0.1207,
  productionSection: "Production",
};

// ── Made ──────────────────────────────────────────────────────────────────

export interface PlanItemInput {
  category: string | null;
  /** Good 2-packs (or single packs) into the fridge. */
  fridgeQty: number;
  /** 8-pack bags (fridge + freezer). */
  eightPackBags: number;
  batchesTarget: number;
  batchesComplete: number;
  portionsPerBatch: number;
  packSize: number;
  /** RRP of one pack (recipes.rrp). */
  rrp: number;
}

export interface LineMade {
  /** Good packs made (not counting 8-pack bags). */
  packs: number;
  /** packs × RRP. */
  gross: number;
  bags: number;
  /** bags × (8 ÷ pack size) — the bags in the recipe's own packs. */
  bagPacks?: number;
  /** bags × (8 ÷ pack size) × RRP. */
  bagGross: number;
  plannedBatches: number;
  /** Packs the plan asked for (batches × portions ÷ pack size, bags as packs). */
  plannedPacks?: number;
  /** True when this line's output came from completed batches because it
   *  has no fridge count (lines counted at their own station). */
  fromBatches: boolean;
}

/** Packs in an 8-pack bag expressed in the recipe's own pack size. */
function bagPacks(packSize: number): number {
  return packSize > 0 ? 8 / packSize : 0;
}

/**
 * What each line made. A line counted at the fridge (any fridge 2-pack or
 * 8-pack count that day) uses those counts only — freezer_qty is mostly
 * wonkies and never counts. A line with NO fridge count at all is counted
 * at its own station, so its completed batches become packs
 * (batches × portions ÷ pack size).
 */
export function madeByLine(items: PlanItemInput[]): Record<string, LineMade> {
  const byCat = new Map<string, PlanItemInput[]>();
  for (const it of items) {
    if (!it.category) continue;
    const list = byCat.get(it.category) ?? [];
    list.push(it);
    byCat.set(it.category, list);
  }
  const out: Record<string, LineMade> = {};
  for (const [cat, list] of byCat) {
    const fridgeCounted = list.some(i => i.fridgeQty > 0 || i.eightPackBags > 0);
    const line: LineMade = { packs: 0, gross: 0, bags: 0, bagPacks: 0, bagGross: 0, plannedBatches: 0, plannedPacks: 0, fromBatches: !fridgeCounted };
    for (const i of list) {
      line.plannedBatches += i.batchesTarget;
      if (i.packSize > 0) line.plannedPacks! += (i.batchesTarget * i.portionsPerBatch) / i.packSize;
      if (fridgeCounted) {
        line.packs += i.fridgeQty;
        line.gross += i.fridgeQty * i.rrp;
        line.bags += i.eightPackBags;
        line.bagPacks! += i.eightPackBags * bagPacks(i.packSize);
        line.bagGross += i.eightPackBags * bagPacks(i.packSize) * i.rrp;
      } else if (i.packSize > 0) {
        const packs = (i.batchesComplete * i.portionsPerBatch) / i.packSize;
        line.packs += packs;
        line.gross += packs * i.rrp;
      }
    }
    if (!fridgeCounted && line.packs === 0) line.fromBatches = false;
    out[cat] = line;
  }
  return out;
}

// ── A day's stored components ─────────────────────────────────────────────

export interface LineDespatched {
  packs: number;
  gross: number;
  /** 8-pack bags despatched, in the recipe's own packs (bags × 8 ÷ pack size). */
  bagPacks: number;
  bagGross: number;
}

export interface DayComponents {
  date: string;
  made: Record<string, LineMade>;
  despatched: Record<string, LineDespatched>;
  ordersDespatched: number;
  /** Productive pay × on-cost multiplier, before any line removal. */
  labourCostTotal: number;
  /** Part of labourCostTotal paid to line-only positions, by category. */
  lineLabour: Record<string, number>;
  paidHours: number;
  headcount: number;
  /** Productive shifts on this day not yet approved in Planday. */
  pendingShifts: number;
  /** Old shifts that were never approved, left out of the day. */
  ignoredUnapproved: number;
}

/** A line counted below this share of its plan, by more than
 *  PARTLY_COUNTED_MIN_SHORT packs, was only partly recorded (a count sheet
 *  left half done), not a bad day — leave it out rather than show a false low. */
export const PARTLY_COUNTED_SHARE = 0.5;
export const PARTLY_COUNTED_MIN_SHORT = 100;

/** Packs counted for a line, 8-pack bags as their packs. */
function countedPacks(m: LineMade): number {
  return m.packs + (m.bagPacks ?? 0);
}

export type DayStatus = "ok" | "pending" | "excluded" | "no_labour";

export interface DayFlag {
  code: "uncounted_output" | "partly_counted" | "line_pay_removed" | "pending_approval" | "unapproved_ignored" | "no_labour";
  /** The line concerned, where there is one. */
  line?: string;
  /** Plain-English, safe for every viewer (never carries £). */
  message: string;
}

export interface DerivedDay {
  status: DayStatus;
  /** Left out of the standard, the rolling figure and every average. */
  excluded: boolean;
  flags: DayFlag[];
  packsByLine: Record<string, number>;
  eightPackBags: number;
  packsDespatched: number;
  valueMadeNet: number;
  valueDespatchedNet: number;
  valueCredited: number;
  labourCost: number;
  ratio: number | null;
  efficiencyPct: number | null;
}

function discount(s: TeSettings, cat: string): number {
  const r = s.discountRates[cat];
  return Number.isFinite(r) ? r : 0;
}

export function deriveDay(c: DayComponents, s: TeSettings): DerivedDay {
  const flags: DayFlag[] = [];
  let excluded = false;

  // A line that was planned but has nothing counted: its output is missing,
  // not zero. Showing the day would be a false low, so flag and leave it out.
  for (const [cat, m] of Object.entries(c.made)) {
    if (m.plannedBatches > 0 && m.packs === 0 && m.bags === 0) {
      flags.push({ code: "uncounted_output", line: cat, message: `Uncounted output: ${cat} was planned but nothing was counted` });
      excluded = true;
      continue;
    }
    const planned = m.plannedPacks ?? 0;
    const counted = countedPacks(m);
    if (planned > 0 && counted < planned * PARTLY_COUNTED_SHARE && planned - counted > PARTLY_COUNTED_MIN_SHORT) {
      flags.push({
        code: "partly_counted", line: cat,
        message: `Partly counted: ${cat} recorded ${Math.round(counted)} of ${Math.round(planned)} planned packs`,
      });
      excluded = true;
    }
  }

  // Line-only staff paid on a day that line isn't in the planner at all
  // (a run nobody planned or counted): take their pay off rather than
  // charge the rest of the team for output we can't see.
  let removed = 0;
  for (const cat of Object.keys(s.linePositions)) {
    const m = c.made[cat];
    const ran = m && (m.plannedBatches > 0 || m.packs > 0 || m.bags > 0);
    const pay = c.lineLabour[cat] ?? 0;
    if (!ran && pay > 0) {
      removed += pay;
      flags.push({ code: "line_pay_removed", line: cat, message: `${cat} staff were rostered but the line wasn't in the planner — their hours left out` });
    }
  }

  if (c.ignoredUnapproved > 0) {
    flags.push({ code: "unapproved_ignored", message: `${c.ignoredUnapproved} shift${c.ignoredUnapproved === 1 ? " was" : "s were"} never approved in Planday — left out` });
  }

  const labourCost = Math.max(0, c.labourCostTotal - removed);

  let valueMadeNet = 0;
  const packsByLine: Record<string, number> = {};
  let eightPackBags = 0;
  for (const [cat, m] of Object.entries(c.made)) {
    valueMadeNet += m.gross * (1 - discount(s, cat)) + m.bagGross * s.eightPackFactor;
    packsByLine[cat] = Math.round(m.packs);
    eightPackBags += m.bags;
  }
  let valueDespatchedNet = 0;
  let packsDespatched = 0;
  for (const [cat, d] of Object.entries(c.despatched)) {
    valueDespatchedNet += d.gross * (1 - discount(s, cat)) + d.bagGross * s.eightPackFactor;
    packsDespatched += d.packs + d.bagPacks;
  }
  const valueCredited = creditedValue(valueMadeNet, valueDespatchedNet, s.despatchShare);

  let status: DayStatus = "ok";
  let ratio: number | null = labourCost > 0 ? valueCredited / labourCost : null;
  if (c.pendingShifts > 0) {
    status = "pending";
    ratio = null;
    flags.unshift({ code: "pending_approval", message: `Waiting for ${c.pendingShifts} shift${c.pendingShifts === 1 ? "" : "s"} to be approved in Planday` });
  } else if (labourCost <= 0) {
    status = "no_labour";
    flags.push({ code: "no_labour", message: "No approved production hours on this day" });
  } else if (excluded) {
    status = "excluded";
  }

  const efficiencyPct = status === "ok" && ratio != null && s.standardRatio > 0
    ? (ratio / s.standardRatio) * 100
    : null;

  return {
    status,
    excluded: status !== "ok",
    flags,
    packsByLine,
    eightPackBags,
    packsDespatched: Math.round(packsDespatched),
    valueMadeNet,
    valueDespatchedNet,
    valueCredited,
    labourCost,
    ratio,
    efficiencyPct,
  };
}
