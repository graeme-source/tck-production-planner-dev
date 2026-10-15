/**
 * Predicted factory number after a production plan — the UPPER limit
 * (Graeme, 15 Oct 2026). Objective C: never run out (the lower limit is
 * @workspace/plan-margin), and nothing goes out of date or into the freezer.
 *
 * "We don't really want to go much more than 1,000 packs in the fridge. We
 * never want to go over 1,500 … at 1,500 you start having to freeze. I like
 * to sit around 800; 800–1,000 is a good range. We could survive at 500 for a
 * couple of days."
 *
 * Factory number after the plan = calzone packs in the fridge at the end of
 * the plan day, after its production is wrapped in and its despatch has gone:
 *
 *   per recipe: stock at plan start + made − 8-pack bags − that day's known
 *               despatch orders − predicted late orders (late-orders.ts)
 *
 * clamped at zero per recipe (one flavour running out doesn't take packs off
 * another). The late orders are split across recipes by their share of the
 * last 7 days' sales. Pure — the Create / Edit Plan screens run it live as
 * batches change.
 */
import type { LateTotal } from "./late-orders";

export const FACTORY_FORECAST_SETTING_KEYS = {
  targetLow: "factory_forecast_target_low",
  targetHigh: "factory_forecast_target_high",
  warnAt: "factory_forecast_warn_at",
  maxAt: "factory_forecast_max_at",
  lowAmber: "factory_forecast_low_amber",
  lowRed: "factory_forecast_low_red",
} as const;

export interface FactoryThresholds {
  /** Comfortable range, bottom (default 800). */
  targetLow: number;
  /** Comfortable range, top (default 1,000) — recommendations aim here. */
  targetHigh: number;
  /** Orange warning at or above (default 1,250). */
  warnAt: number;
  /** Freezing stock at or above (default 1,500) — saving needs a second tap. */
  maxAt: number;
  /** Amber "running low" below (default 600). */
  lowAmber: number;
  /** Red "too low" below (default 500). */
  lowRed: number;
}

export const DEFAULT_FACTORY_THRESHOLDS: FactoryThresholds = {
  targetLow: 800,
  targetHigh: 1000,
  warnAt: 1250,
  maxAt: 1500,
  lowAmber: 600,
  lowRed: 500,
};

/** Parse app_settings values, falling back per field to the defaults for
 *  anything missing or nonsensical, then forcing a sensible order
 *  (lowRed ≤ lowAmber ≤ targetLow ≤ targetHigh ≤ warnAt ≤ maxAt). */
export function parseFactoryThresholds(raw: Partial<Record<keyof FactoryThresholds, string | number | null | undefined>>): FactoryThresholds {
  const num = (v: unknown, fallback: number) => {
    if (v == null || String(v).trim() === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
  };
  const t = {} as FactoryThresholds;
  for (const k of Object.keys(DEFAULT_FACTORY_THRESHOLDS) as Array<keyof FactoryThresholds>) {
    t[k] = num(raw[k], DEFAULT_FACTORY_THRESHOLDS[k]);
  }
  return thresholdsInOrder(t) ? t : { ...DEFAULT_FACTORY_THRESHOLDS };
}

export function thresholdsInOrder(t: FactoryThresholds): boolean {
  return t.lowRed <= t.lowAmber && t.lowAmber <= t.targetLow && t.targetLow <= t.targetHigh
    && t.targetHigh <= t.warnAt && t.warnAt <= t.maxAt;
}

export type FactoryBand = "too-low" | "low" | "under" | "target" | "above" | "warning" | "freeze";

export function factoryBand(packs: number, t: FactoryThresholds = DEFAULT_FACTORY_THRESHOLDS): FactoryBand {
  if (packs < t.lowRed) return "too-low";
  if (packs < t.lowAmber) return "low";
  if (packs < t.targetLow) return "under";
  if (packs <= t.targetHigh) return "target";
  if (packs < t.warnAt) return "above";
  if (packs < t.maxAt) return "warning";
  return "freeze";
}

export interface FactoryForecastRow {
  key: string;
  recipeName: string;
  included: boolean;
  plannedBatches: number;
  packsPerBatch: number;
  /** Packs in the fridge at the start of the plan day (the screen's factory
   *  number, already net of expiring packs). */
  startStockPacks: number;
  /** 2-pack equivalents going out as 8-pack bags from this plan. */
  bagPacks: number;
  /** Known orders for the plan day's own despatch (the D2 column). */
  despatchPacks: number;
  /** This recipe's share of recent sales (0–1) — its slice of late orders. */
  salesShare: number;
  /** Fewest batches this recipe may have (orders + safety margin, from
   *  @workspace/plan-margin). Recommendations never go below it. */
  floorBatches: number;
}

export interface RecipeFactoryForecast {
  key: string;
  recipeName: string;
  /** End of plan day on known orders only. */
  knownEnd: number;
  predictedLate: number;
  predictedEnd: number;
}

export interface FactoryForecast {
  /** Sum of every recipe's end on known orders only (what the maths said before). */
  knownEnd: number;
  /** Packs on known orders out of the fridge before the end of the plan day. */
  knownOrders: number;
  latePacks: number;
  predictedEnd: number;
  /** 80% range for predictedEnd. */
  low: number;
  high: number;
  band: FactoryBand;
  perRecipe: RecipeFactoryForecast[];
}

/** Late packs per row by sales share; rows with no share get none. If no row
 *  has a share, split by the day's known despatch instead. */
export function splitLatePacks(rows: readonly FactoryForecastRow[], latePacks: number): number[] {
  const shares = rows.map(r => Math.max(0, r.salesShare || 0));
  let total = shares.reduce((s, x) => s + x, 0);
  let weights = shares;
  if (total <= 0) {
    weights = rows.map(r => Math.max(0, r.despatchPacks || 0));
    total = weights.reduce((s, x) => s + x, 0);
  }
  if (total <= 0) return rows.map(() => 0);
  return weights.map(w => latePacks * w / total);
}

function rowKnownEnd(r: FactoryForecastRow, batches: number): number {
  const made = r.included ? batches * r.packsPerBatch : 0;
  return Math.max(0, (r.startStockPacks || 0) + made - (r.bagPacks || 0) - (r.despatchPacks || 0));
}

export function forecastFactoryNumber(
  rows: readonly FactoryForecastRow[],
  late: LateTotal,
  t: FactoryThresholds = DEFAULT_FACTORY_THRESHOLDS,
  batchesOverride?: ReadonlyMap<string, number>,
): FactoryForecast {
  const lateByRow = splitLatePacks(rows, late.latePacks);
  const perRecipe = rows.map((r, i) => {
    const batches = batchesOverride?.get(r.key) ?? r.plannedBatches;
    const knownEnd = rowKnownEnd(r, batches);
    return {
      key: r.key,
      recipeName: r.recipeName,
      knownEnd: Math.round(knownEnd),
      predictedLate: Math.round(lateByRow[i]),
      predictedEnd: Math.max(0, knownEnd - lateByRow[i]),
    };
  });
  const knownEnd = perRecipe.reduce((s, r) => s + r.knownEnd, 0);
  const predictedEnd = Math.round(perRecipe.reduce((s, r) => s + r.predictedEnd, 0));
  for (const r of perRecipe) r.predictedEnd = Math.round(r.predictedEnd);
  return {
    knownEnd,
    knownOrders: Math.round(rows.reduce((s, r) => s + (r.despatchPacks || 0), 0)),
    latePacks: late.latePacks,
    predictedEnd,
    // More late orders → lower fridge, so the range flips.
    low: Math.max(0, predictedEnd - (late.high - late.latePacks)),
    high: predictedEnd + (late.latePacks - late.low),
    band: factoryBand(predictedEnd, t),
    perRecipe,
  };
}

export interface BatchChange {
  key: string;
  recipeName: string;
  from: number;
  to: number;
}

export interface FactoryRecommendation {
  /** "fewer" when over the comfortable range, "more" when below the low warning. */
  direction: "fewer" | "more";
  /** Total batches to take off / add. */
  batches: number;
  changes: BatchChange[];
  /** The predicted factory number once applied. */
  landsOn: number;
  /** The number aimed for (targetHigh when over, targetLow when under). */
  aim: number;
  /** True when the floors (or capacity) stopped it short of the aim. */
  limited: boolean;
}

/**
 * Over the top of the comfortable range → take batches off, one at a time,
 * from the recipe with the most cover (predicted packs left ÷ its share of
 * sales — the most days' worth), never below its orders + margin floor and
 * never past zero predicted end, until the forecast is at or under targetHigh.
 *
 * Below the low warning → add batches to the recipe with the least cover
 * until targetLow, within `maxTotalBatches` (the day's capacity) if given.
 * Otherwise null.
 */
export function recommendBatchChange(
  rows: readonly FactoryForecastRow[],
  late: LateTotal,
  t: FactoryThresholds = DEFAULT_FACTORY_THRESHOLDS,
  opts: { maxTotalBatches?: number } = {},
): FactoryRecommendation | null {
  const batches = new Map(rows.map(r => [r.key, Math.max(0, Math.round(r.plannedBatches || 0))]));
  const start = forecastFactoryNumber(rows, late, t, batches);
  const over = start.predictedEnd > t.targetHigh;
  const under = start.predictedEnd < t.lowAmber;
  if (!over && !under) return null;

  const lateByRow = splitLatePacks(rows, late.latePacks);
  const endOf = (i: number) => rowKnownEnd(rows[i], batches.get(rows[i].key)!) - lateByRow[i];
  const coverOf = (i: number) => endOf(i) / Math.max(0.005, rows[i].salesShare || 0);
  let current = start.predictedEnd;
  let limited = false;
  const totalBatches = () => rows.reduce((s, r) => s + (r.included ? batches.get(r.key)! : 0), 0);

  for (let guard = 0; guard < 1000; guard++) {
    if (over ? current <= t.targetHigh : current >= t.targetLow) break;
    let best = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.included || !(r.packsPerBatch > 0)) continue;
      const b = batches.get(r.key)!;
      if (over) {
        if (b <= Math.max(0, r.floorBatches || 0)) continue;
        // Never take a recipe's predicted end below zero — that's running out.
        if (endOf(i) - r.packsPerBatch < 0) continue;
        if (best < 0 || coverOf(i) > coverOf(best)) best = i;
      } else {
        if (!((r.salesShare || 0) > 0)) continue;
        if (best < 0 || coverOf(i) < coverOf(best)) best = i;
      }
    }
    if (best < 0) { limited = true; break; }
    if (!over && opts.maxTotalBatches != null && totalBatches() >= opts.maxTotalBatches) { limited = true; break; }
    const key = rows[best].key;
    batches.set(key, batches.get(key)! + (over ? -1 : 1));
    current = forecastFactoryNumber(rows, late, t, batches).predictedEnd;
  }

  const changes: BatchChange[] = rows
    .filter(r => batches.get(r.key)! !== Math.max(0, Math.round(r.plannedBatches || 0)))
    .map(r => ({ key: r.key, recipeName: r.recipeName, from: Math.max(0, Math.round(r.plannedBatches || 0)), to: batches.get(r.key)! }))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.recipeName.localeCompare(b.recipeName));
  const moved = changes.reduce((s, c) => s + Math.abs(c.to - c.from), 0);
  if (moved === 0) return null;
  return {
    direction: over ? "fewer" : "more",
    batches: moved,
    changes,
    landsOn: current,
    aim: over ? t.targetHigh : t.targetLow,
    limited,
  };
}

/** Saving needs a deliberate second tap at or above maxAt. */
export function needsFreezeConfirmation(f: Pick<FactoryForecast, "predictedEnd">, t: FactoryThresholds = DEFAULT_FACTORY_THRESHOLDS): boolean {
  return f.predictedEnd >= t.maxAt;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** One plain line: how the number was worked out. */
export function describeFactoryForecast(f: FactoryForecast, opts: { byWhen?: string; emails?: number } = {}): string {
  const by = opts.byWhen ? ` by ${opts.byWhen}` : "";
  const em = opts.emails ? ` incl. ${opts.emails} email${opts.emails === 1 ? "" : "s"}` : "";
  return `Known orders leave ${fmt(f.knownEnd)} − predicted ${fmt(f.latePacks)} more packs ordered${by}${em} = ~${fmt(f.predictedEnd)}`;
}
