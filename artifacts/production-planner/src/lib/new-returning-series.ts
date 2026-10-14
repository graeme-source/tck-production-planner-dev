/**
 * The "New customers, % of orders" trend graph's extra lines (Objective I):
 * the % new line plus the new and returning ORDER COUNTS behind it, each
 * switched on and off by a chip (Graeme, 2026-10-14 — the % can fall while
 * new orders rise, because returning orders spiked).
 *
 * Pure helpers only: which lines are on, how the choice is remembered, and
 * the two axes (% on the left, orders on the right). Both axes always have
 * the same number of evenly spaced ticks starting at 0, so their gridlines
 * land on the same rows and one set of gridlines serves both.
 */
import type { ChartPoint } from "./sales-trend-view";

export type SplitSeriesId = "share" | "new" | "returning";

export interface SplitSeries {
  id: SplitSeriesId;
  /** The chip and legend wording. */
  label: string;
  /** Which axis the line is measured against. */
  axis: "percent" | "orders";
}

export const SPLIT_SERIES: SplitSeries[] = [
  { id: "share", label: "% new", axis: "percent" },
  { id: "new", label: "New orders", axis: "orders" },
  { id: "returning", label: "Returning orders", axis: "orders" },
];

export type SplitVisibility = Record<SplitSeriesId, boolean>;

export const DEFAULT_SPLIT_VISIBILITY: SplitVisibility = { share: true, new: true, returning: true };

/** Where the choice is remembered on this device. */
export const SPLIT_VISIBILITY_STORAGE_KEY = "tck.numbers.newReturningLines.v1";

/**
 * A remembered choice read back from storage. Anything unreadable, or a
 * choice with every line off, falls back to all three on — the graph is
 * never empty.
 */
export function parseSplitVisibility(raw: string | null | undefined): SplitVisibility {
  if (!raw) return { ...DEFAULT_SPLIT_VISIBILITY };
  try {
    const v = JSON.parse(raw) as Partial<Record<SplitSeriesId, unknown>>;
    if (!v || typeof v !== "object") return { ...DEFAULT_SPLIT_VISIBILITY };
    const out: SplitVisibility = {
      share: typeof v.share === "boolean" ? v.share : true,
      new: typeof v.new === "boolean" ? v.new : true,
      returning: typeof v.returning === "boolean" ? v.returning : true,
    };
    return anyOn(out) ? out : { ...DEFAULT_SPLIT_VISIBILITY };
  } catch {
    return { ...DEFAULT_SPLIT_VISIBILITY };
  }
}

function anyOn(v: SplitVisibility): boolean {
  return v.share || v.new || v.returning;
}

/** Is this the only line still on? (Its chip can't be switched off.) */
export function isLastOn(v: SplitVisibility, id: SplitSeriesId): boolean {
  return v[id] && SPLIT_SERIES.filter(s => v[s.id]).length === 1;
}

/** Flip one line. The last line on stays on, so the graph is never empty. */
export function toggleSplitSeries(v: SplitVisibility, id: SplitSeriesId): SplitVisibility {
  if (isLastOn(v, id)) return v;
  return { ...v, [id]: !v[id] };
}

/** Evenly spaced steps from 0 on both axes — 4 steps = 5 gridlines. */
export const AXIS_STEPS = 4;

const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

export interface NiceAxis {
  max: number;
  ticks: number[];
}

/**
 * A 0-based axis with AXIS_STEPS equal steps whose top is at or above
 * `dataMax`. Steps come from 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ; for whole
 * numbers (order counts, whole percentages) the step is a whole number too,
 * so every tick label is exact.
 */
export function niceAxis(dataMax: number, wholeSteps = true): NiceAxis {
  const top = Number.isFinite(dataMax) && dataMax > 0 ? dataMax : 0;
  const raw = top / AXIS_STEPS;
  let step = 1;
  if (raw > 0) {
    const mag = 10 ** Math.floor(Math.log10(raw));
    step = 10 * mag;
    for (const n of NICE) {
      const s = n * mag;
      if (wholeSteps && !Number.isInteger(s)) continue;
      if (s >= raw - 1e-9) { step = s; break; }
    }
    if (wholeSteps) step = Math.max(1, step);
  }
  const ticks = Array.from({ length: AXIS_STEPS + 1 }, (_, i) => round(step * i));
  return { max: ticks[ticks.length - 1], ticks };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * The left (%) axis: from 0 to a nice top over the drawn % (a share of
 * 100% or less never gets a top above 100%). No % yet: 0–100%.
 */
export function percentAxis(points: ChartPoint[]): NiceAxis {
  const vals = points.map(p => p.value).filter((v): v is number => v != null && Number.isFinite(v));
  return niceAxis(vals.length === 0 ? 100 : Math.max(...vals));
}

/**
 * The right (orders) axis, scaled to the count lines that are ON — switch
 * returning orders off and new orders fill the height. null when neither
 * count line is on (the axis is hidden).
 */
export function countAxis(points: ChartPoint[], v: SplitVisibility): NiceAxis | null {
  if (!v.new && !v.returning) return null;
  let max = 0;
  for (const p of points) {
    if (v.new && p.newLine != null) max = Math.max(max, p.newLine);
    if (v.returning && p.returningLine != null) max = Math.max(max, p.returningLine);
  }
  return niceAxis(max);
}
