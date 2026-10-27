/**
 * Labour and profit per recipe batch (Graeme, 27 Oct 2026 — product
 * decisions on profit per batch AFTER labour: premium recipes vs simpler,
 * cheaper ones; Objectives C and I). Pure.
 *
 *   prep minutes / batch   = Σ over the recipe's prep items of
 *                            amount per batch (lib/prep-usage.ts) ×
 *                            that item's measured rate (lib/prep-timing.ts)
 *   line minutes / batch   = build seconds per batch for ONE builder ÷ the
 *                            builders working in parallel ÷ 60 — measured on
 *                            the building station when there's enough history
 *                            (lib/timing-suggestions.ts), else the recipe's
 *                            target build time
 *   gross £ / batch        = (list price − cost per pack incl. packaging)
 *                            × packs per batch — the recipe page's own
 *                            figures (routes/recipes.ts computeCosts)
 *   prep labour £ / batch  = prep minutes × prep crew × £/hour ÷ 60
 *                            (prep is one person per item)
 *   line labour £ / batch  = line minutes × line crew × £/hour ÷ 60
 *                            (the whole line — dough sheeter, two builders,
 *                            ovens — is there for every batch it runs)
 *   profit after labour    = gross − line labour − prep labour
 *   profit per line-minute = profit after labour ÷ line minutes — the line is
 *                            the scarce resource
 * The rate and crew sizes are settings (app_settings, LABOUR_SETTING_KEYS)
 * with defaults, never constants in the maths. Prep items with no timings
 * yet add nothing and are listed, so prep minutes are "what we've measured
 * so far", never a guess.
 */
import type { PrepUsage } from "./prep-usage";
import type { Confidence, ItemTiming } from "./prep-timing";

export interface LabourSettings {
  /** £ per person-hour, loaded: pay + NI + pension + having someone in the building. */
  ratePerHour: number;
  /** People on a prep item while it's being prepped. */
  prepCrew: number;
  /** People on the production line for every batch while it runs. */
  lineCrew: number;
  /** Builders building at once — the line makes a batch every build ÷ this. */
  lineBuilders: number;
}

/** Graeme's figures, 27 Oct 2026: £17.05 an hour; prep is one person; the
 *  line is four (dough sheeter, two builders, ovens) with two builders. */
export const DEFAULT_LABOUR_SETTINGS: Readonly<LabourSettings> = {
  ratePerHour: 17.05,
  prepCrew: 1,
  lineCrew: 4,
  lineBuilders: 2,
};

/** Where each setting lives in app_settings. */
export const LABOUR_SETTING_KEYS: Readonly<Record<keyof LabourSettings, string>> = {
  ratePerHour: "batch_labour_rate_per_hour",
  prepCrew: "batch_labour_prep_crew",
  lineCrew: "batch_labour_line_crew",
  lineBuilders: "batch_labour_line_builders",
};

const SETTING_MAX: Readonly<Record<keyof LabourSettings, number>> = {
  ratePerHour: 200,
  prepCrew: 20,
  lineCrew: 30,
  lineBuilders: 10,
};

/** The stored settings, each falling back to its default when missing or
 *  unusable (not a number, ≤ 0, or absurdly large); `defaulted` names them. */
export function parseLabourSettings(stored: Partial<Record<keyof LabourSettings, string | null | undefined>>): {
  settings: LabourSettings;
  defaulted: Array<keyof LabourSettings>;
} {
  const settings = { ...DEFAULT_LABOUR_SETTINGS };
  const defaulted: Array<keyof LabourSettings> = [];
  for (const key of Object.keys(DEFAULT_LABOUR_SETTINGS) as Array<keyof LabourSettings>) {
    const raw = stored[key];
    const n = raw == null || String(raw).trim() === "" ? Number.NaN : Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= SETTING_MAX[key]) settings[key] = n;
    else defaulted.push(key);
  }
  return { settings, defaulted };
}

/** Line minutes per batch from one builder's build seconds; null when unknown. */
export function lineMinutesPerBatch(buildSecondsOneBuilder: number | null | undefined, builders: number): number | null {
  const s = Number(buildSecondsOneBuilder);
  if (!Number.isFinite(s) || s <= 0 || !(builders > 0)) return null;
  return s / builders / 60;
}

/** Minutes × people × £/hour. */
export function labourCost(minutes: number, crew: number, ratePerHour: number): number {
  return (minutes / 60) * crew * ratePerHour;
}

/** timed: a measured rate × the amount.
 *  quick_only: only ever completed inside 30 s (ready-made or check-only) —
 *    counts as no prep time, and as covered.
 *  not_measured: no timing yet (or only completions made without opening).
 *  no_matching_amount: timed, but in a different measure from the recipe's
 *    amount (pieces vs kg), so it can't be priced. */
export type LineStatus = "timed" | "quick_only" | "not_measured" | "no_matching_amount";

export interface RecipePrepLine {
  itemKey: string;
  minutes: number | null;
  status: LineStatus;
  confidence: Confidence | null;
}

export interface RecipePrepMinutes {
  minutes: number;
  lines: RecipePrepLine[];
  timedItems: number;
  totalItems: number;
  /** The weakest confidence among items carrying ≥ 10% of the minutes. */
  confidence: Confidence | null;
}

const RANK: Record<Confidence, number> = { needs_more_data: 0, settling: 1, confident: 2 };

export function recipePrepMinutes(usage: ReadonlyArray<PrepUsage>, timings: ReadonlyMap<string, ItemTiming>): RecipePrepMinutes {
  const lines: RecipePrepLine[] = usage.map(u => {
    const t = timings.get(u.itemKey);
    if (!t || (t.sessions === 0 && t.quickCompletions === 0)) {
      return { itemKey: u.itemKey, minutes: null, status: "not_measured", confidence: null };
    }
    if (t.sessions === 0) return { itemKey: u.itemKey, minutes: 0, status: "quick_only", confidence: null };
    if (u.grams != null && t.rate.minutesPerKg != null) {
      return { itemKey: u.itemKey, minutes: (u.grams / 1000) * t.rate.minutesPerKg, status: "timed", confidence: t.confidence };
    }
    if (u.count != null && t.rate.minutesPerCount != null && t.rate.countUnit === u.countUnit) {
      return { itemKey: u.itemKey, minutes: u.count * t.rate.minutesPerCount, status: "timed", confidence: t.confidence };
    }
    return { itemKey: u.itemKey, minutes: null, status: "no_matching_amount", confidence: t.confidence };
  });
  const minutes = lines.reduce((n, l) => n + (l.minutes ?? 0), 0);
  let confidence: Confidence | null = null;
  for (const l of lines) {
    if (l.status !== "timed" || l.confidence == null || l.minutes == null) continue;
    if (minutes > 0 && l.minutes < minutes * 0.1) continue;
    if (confidence == null || RANK[l.confidence] < RANK[confidence]) confidence = l.confidence;
  }
  return {
    minutes,
    lines,
    timedItems: lines.filter(l => l.status === "timed" || l.status === "quick_only").length,
    totalItems: lines.length,
    confidence,
  };
}

export interface BatchCosting {
  /** List price of one pack. */
  rrp: number;
  /** Ingredient cost of one pack. */
  packIngredientCost: number;
  /** Packaging cost of one pack. */
  packagingCost: number;
  packsPerBatch: number;
}

/** (list price − cost per pack incl. packaging) × packs per batch. */
export function grossPerBatch(c: BatchCosting): number {
  return (c.rrp - c.packIngredientCost - c.packagingCost) * c.packsPerBatch;
}

export interface BatchProfit {
  gross: number;
  /** Prep minutes × prep crew at the rate. */
  prepLabour: number;
  /** Line minutes × line crew at the rate; null when the line time isn't known. */
  lineLabour: number | null;
  /** Gross − line labour − prep labour (an unknown line time counts nothing,
   *  so check lineLabour before trusting it). */
  profitAfterLabour: number;
  /** Profit after labour per minute of line time; null without a line time. */
  profitPerLineMinute: number | null;
  /** Line + prep labour as a share of gross (0.12 = 12%); null when gross ≤ 0. */
  labourShareOfGross: number | null;
}

export function batchProfit(
  costing: BatchCosting,
  minutes: { prep: number; line: number | null },
  s: LabourSettings,
): BatchProfit {
  const gross = grossPerBatch(costing);
  const prepLabour = labourCost(minutes.prep, s.prepCrew, s.ratePerHour);
  const lineLabour = minutes.line != null ? labourCost(minutes.line, s.lineCrew, s.ratePerHour) : null;
  const profitAfterLabour = gross - prepLabour - (lineLabour ?? 0);
  return {
    gross,
    prepLabour,
    lineLabour,
    profitAfterLabour,
    profitPerLineMinute: minutes.line != null && minutes.line > 0 ? profitAfterLabour / minutes.line : null,
    labourShareOfGross: gross > 0 ? (prepLabour + (lineLabour ?? 0)) / gross : null,
  };
}
