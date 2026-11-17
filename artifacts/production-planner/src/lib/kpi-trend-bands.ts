/**
 * One trend graph for every KPI (Graeme, 17 Nov 2026: "I like the line graph
 * on the TCK run rate ... Can we have this on all KPI windows?"). Pure rules:
 * the points in date order with a 7-day rolling average, each day's colour
 * band against the KPI's targets, and clean axis ticks. The chart itself is
 * components/kpis/kpi-trend-chart.tsx.
 */

export type TrendBand = "platinum" | "green" | "amber" | "red" | "neutral";

/** A KPI's targets, higher is better. `close` is where yellow starts (null =
 *  no yellow band: under the standard is red). `stretch` null = no platinum. */
export interface TrendBands {
  stretch: number | null;
  standard: number;
  close: number | null;
}

export interface TrendRow {
  date: string;
  value: number | null;
  /** Extra words for that day's hover, e.g. "412 orders". */
  note?: string;
}

export interface TrendPoint extends TrendRow {
  /** Average of the last `window` days that have a figure, up to this day. */
  rolling: number | null;
  band: TrendBand;
}

export function trendBand(value: number | null, bands: TrendBands | null): TrendBand {
  if (value == null || !Number.isFinite(value) || !bands) return "neutral";
  if (bands.stretch != null && value >= bands.stretch) return "platinum";
  if (value >= bands.standard) return "green";
  if (bands.close != null && value >= bands.close) return "amber";
  return "red";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Oldest first, one point per date, with the rolling average. */
export function trendPoints(rows: readonly TrendRow[], bands: TrendBands | null, window = 7): TrendPoint[] {
  const byDate = new Map<string, TrendRow>();
  for (const r of rows) byDate.set(r.date, r);
  const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const recent: number[] = [];
  return sorted.map(r => {
    const v = r.value != null && Number.isFinite(r.value) ? r.value : null;
    if (v != null) {
      recent.push(v);
      if (recent.length > window) recent.shift();
    }
    const rolling = recent.length ? round1(recent.reduce((s, x) => s + x, 0) / recent.length) : null;
    return { ...r, value: v, rolling: v == null && recent.length === 0 ? null : rolling, band: trendBand(v, bands) };
  });
}

/** A tidy step: 1, 2, 2.5 or 5 × a power of ten, giving about `target` gaps. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * pow;
}

/** A freak day (a few minutes logged, so a silly rate) shouldn't squash every
 *  other day into a line: past this many times the typical high, the axis
 *  stops and that day sits on the top edge (its real figure in the hover). */
const FREAK_RATIO = 1.6;

/** The figures the axis has to show: all of them, unless one or two are freaks. */
export function axisValues(values: readonly number[]): { keep: number[]; cap: number | null } {
  if (values.length < 5) return { keep: [...values], cap: null };
  const sorted = [...values].sort((a, b) => a - b);
  const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)];
  const cap = p90 > 0 ? p90 * FREAK_RATIO : null;
  if (cap == null || sorted[sorted.length - 1] <= cap) return { keep: sorted, cap: null };
  return { keep: sorted.filter(v => v <= cap), cap };
}

/** The y axis: every figure and every target line in view (freak days on the
 *  top edge), ticks on a tidy step. */
export function trendAxis(points: readonly TrendPoint[], bands: TrendBands | null): { lo: number; hi: number; ticks: number[]; capped: boolean } {
  const { keep, cap } = axisValues(points.map(p => p.value).filter((v): v is number => v != null));
  const vals = [...keep, ...points.map(p => p.rolling).filter((v): v is number => v != null && (cap == null || v <= cap))];
  const marks = bands ? [bands.standard, bands.stretch, bands.close].filter((v): v is number => v != null) : [];
  const all = [...vals, ...marks];
  if (!all.length) return { lo: 0, hi: 1, ticks: [0, 1], capped: false };
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  const step = niceStep(max - min + pad * 2);
  const lo = Math.max(0, Math.floor((min - pad) / step) * step);
  const hi = Math.ceil((max + pad) / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { lo, hi, ticks, capped: cap != null };
}

/** "Up 4.2 over the range" style change between the first and last average. */
export function trendChange(points: readonly TrendPoint[]): number | null {
  const withAvg = points.filter(p => p.rolling != null);
  if (withAvg.length < 2) return null;
  return round1(withAvg[withAvg.length - 1].rolling! - withAvg[0].rolling!);
}
