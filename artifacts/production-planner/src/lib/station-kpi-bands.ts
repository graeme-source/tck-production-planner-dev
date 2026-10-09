/**
 * Live KPI colour for the dashboard's Core Production tiles (Graeme,
 * 2026-10-09): each tile's header shows how its station is doing against
 * its own standard, so a glance from across the room says what's going
 * well and what's slow (Objective G).
 *
 * ONE banding rule for every station, relative to that station's standard:
 *   platinum  ≥ 110%  — way ahead ("you're doing amazing")
 *   green     ≥ 100%  — on standard
 *   amber     ≥  90%  — just under
 *   red       <  90%  — going too slow
 *   neutral           — no KPI agreed yet, or not enough data to judge
 * For the 20 batches/hr run rate that is ≥22 / ≥20 / 18–<20 / <18.
 *
 * Mixing, Sheeting, Building and Ovens are one production line — they all
 * come off building — so they all take the building run rate's colour.
 * Wrapping and Packing have their own KPIs; Dough Prep and Prepping For
 * have none yet.
 */
import { BUILDING_TARGET_BATCHES_PER_HOUR } from "@workspace/production-schedule";

export type KpiBand = "platinum" | "green" | "amber" | "red" | "neutral";

/** Ratio of rate ÷ standard at or above which each band starts. */
export const BAND_RATIOS = { platinum: 1.1, green: 1.0, amber: 0.9 } as const;

/** Too early to judge: a station needs this many ACTIVE minutes (breaks
 *  and idle gaps already excluded by the server) before it's coloured.
 *  30 minutes = ~10 batches at the run-rate standard; any less and one
 *  slow first batch would paint the line red at 7am. */
export const MIN_ACTIVE_MINUTES = 30;

/** Wrapping standard: a 24-stack every 8 minutes. Derived from 2 weeks of
 *  live data (5–19 Aug 2026: median 163, p75 212). Shared with the wrapping
 *  station's pace strip so the two can never disagree. */
export const WRAPPING_STANDARD_PACKS_PER_HOUR = 180;

/** Packing orders/hr has NO agreed standard yet (packing-station.tsx says
 *  the same) — so Packing stays neutral until Graeme sets one. */
export const PACKING_STANDARD_ORDERS_PER_HOUR: number | null = null;

export const RUN_RATE_STANDARD = BUILDING_TARGET_BATCHES_PER_HOUR;

export interface KpiReading {
  /** Live rate (units/hr); null/0 when nothing measurable yet. */
  rate: number | null | undefined;
  /** Active minutes behind the rate; null when unknown. */
  activeMinutes: number | null | undefined;
}

/** The one banding function. Neutral when there's no standard, no rate, or
 *  fewer than `minActiveMinutes` of work behind it — never red for "early". */
export function kpiBand(
  reading: KpiReading | null | undefined,
  standard: number | null | undefined,
  minActiveMinutes: number = MIN_ACTIVE_MINUTES,
): KpiBand {
  if (!standard || standard <= 0 || !reading) return "neutral";
  const { rate, activeMinutes } = reading;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "neutral";
  if (activeMinutes == null || activeMinutes < minActiveMinutes) return "neutral";
  // Ratio, not standard × factor: 20 × 1.1 is 22.000000000000004 in floating
  // point, which would make exactly 22/hr miss platinum.
  const ratio = rate / standard;
  const EPS = 1e-9;
  if (ratio + EPS >= BAND_RATIOS.platinum) return "platinum";
  if (ratio + EPS >= BAND_RATIOS.green) return "green";
  if (ratio + EPS >= BAND_RATIOS.amber) return "amber";
  return "red";
}

// ── Core Production tiles ────────────────────────────────────────────────

export type CoreTileKey =
  | "dough_prep" | "prep" | "packing" | "wrapping"
  | "mixing" | "dough_sheeting" | "building" | "ovens";

/** Top row: the stations with their own (or no) KPI — Packing and Wrapping
 *  together. Bottom row: the production line in flow order, all coloured by
 *  the building run rate. Four per row on iPad. */
export const CORE_TILE_ORDER: readonly CoreTileKey[] = [
  "dough_prep", "prep", "packing", "wrapping",
  "mixing", "dough_sheeting", "building", "ovens",
];

export type KpiSource = "run_rate" | "wrapping" | "packing";

/** Which KPI colours each tile. null = no KPI yet. */
export const TILE_KPI_SOURCE: Record<CoreTileKey, KpiSource | null> = {
  dough_prep: null,
  prep: null,
  packing: "packing",
  wrapping: "wrapping",
  mixing: "run_rate",
  dough_sheeting: "run_rate",
  building: "run_rate",
  ovens: "run_rate",
};

const SOURCE_STANDARD: Record<KpiSource, number | null> = {
  run_rate: RUN_RATE_STANDARD,
  wrapping: WRAPPING_STANDARD_PACKS_PER_HOUR,
  packing: PACKING_STANDARD_ORDERS_PER_HOUR,
};

const SOURCE_UNIT: Record<KpiSource, { unit: string; decimals: number; name: string }> = {
  run_rate: { unit: "/hr", decimals: 1, name: "Line run rate" },
  wrapping: { unit: " packs/hr", decimals: 0, name: "Wrapping pace" },
  packing: { unit: " orders/hr", decimals: 1, name: "Packing pace" },
};

export const BAND_WORDS: Record<KpiBand, string> = {
  platinum: "Way ahead",
  green: "On standard",
  amber: "Just under standard",
  red: "Going too slow",
  neutral: "No KPI yet",
};

export interface TileKpiStatus {
  band: KpiBand;
  /** Accessible label / tooltip, e.g. "On standard — 20.4/hr vs 20/hr". */
  label: string;
}

/** Round to what the tile shows, so "22.0/hr" is never amber-ish green. */
function shown(rate: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(rate * f) / f;
}

/** Status for every Core Production tile from the three live readings. */
export function coreTileStatuses(readings: Partial<Record<KpiSource, KpiReading | null>>): Record<CoreTileKey, TileKpiStatus> {
  const bySource = {} as Record<KpiSource, TileKpiStatus>;
  for (const source of Object.keys(SOURCE_STANDARD) as KpiSource[]) {
    const standard = SOURCE_STANDARD[source];
    const { unit, decimals, name } = SOURCE_UNIT[source];
    const r = readings[source];
    if (standard == null) {
      bySource[source] = { band: "neutral", label: `${name}: no standard agreed yet` };
      continue;
    }
    const rate = r?.rate != null && r.rate > 0 ? shown(r.rate, decimals) : null;
    const band = kpiBand(r ? { rate, activeMinutes: r.activeMinutes } : null, standard);
    const vs = `${rate != null ? rate.toFixed(decimals) : "—"}${unit} vs ${standard}${unit}`;
    bySource[source] = band === "neutral"
      ? { band, label: `${name}: not enough data yet (needs ${MIN_ACTIVE_MINUTES} active minutes) — ${vs}` }
      : { band, label: `${BAND_WORDS[band]} — ${vs}` };
  }
  const out = {} as Record<CoreTileKey, TileKpiStatus>;
  for (const key of CORE_TILE_ORDER) {
    const source = TILE_KPI_SOURCE[key];
    out[key] = source ? bySource[source] : { band: "neutral", label: "No KPI yet for this station" };
  }
  return out;
}

/** Header classes per band. All keep white text ≥4.5:1 contrast:
 *  platinum emerald-700→teal-700→cyan-800 (≥5.4), green = Fresh Basil
 *  deepened to #587f2f (4.7 — the brand #7cb342 itself is only 2.5 with
 *  white), amber-700 (5.0), rose-700 (6.3), neutral slate-blue #4c5c9e
 *  (6.3; bluer and deeper than Today's Admin slate-500). */
export const BAND_HEADER_CLASS: Record<KpiBand, string> = {
  platinum: "bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
  green: "bg-[#587f2f]",
  amber: "bg-amber-700",
  red: "bg-rose-700",
  neutral: "bg-[#4c5c9e]",
};

/** Legend order and wording (dashboard). */
export const BAND_LEGEND: { band: KpiBand; label: string; hint: string }[] = [
  { band: "platinum", label: "Platinum", hint: "10%+ ahead" },
  { band: "green", label: "Green", hint: "on standard" },
  { band: "amber", label: "Amber", hint: "up to 10% under" },
  { band: "red", label: "Red", hint: "over 10% under" },
  { band: "neutral", label: "No KPI yet", hint: "or too early to tell" },
];
