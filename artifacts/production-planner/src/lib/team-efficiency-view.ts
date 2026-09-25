/**
 * Team efficiency page — pure shaping and wording (Objective I). No fetching,
 * no React: the page and chart call these, the tests pin them.
 *
 * The server decides what each viewer may see; these helpers only ever read
 * the fields that arrived (founder-only ones are optional here).
 */

export type RangeKey = "30d" | "3m" | "6m" | "12m";
export const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: "30d", label: "30 days" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "12m", label: "12 months" },
];

export type DayStatus = "ok" | "pending" | "excluded" | "no_labour";

export interface EffFlag { code: string; line?: string; message: string }

export interface EffDay {
  date: string;
  status: DayStatus;
  flags: EffFlag[];
  packsByLine: Record<string, number>;
  eightPackBags: number;
  ordersDespatched: number;
  packsDespatched: number;
  efficiencyPct: number | null;
  rollingPct: number | null;
  // founder only
  ratio?: number | null;
  valueCredited?: number;
  labourCost?: number;
}

export interface EffPeriod {
  period: string;
  pct: number | null;
  countedDays: number;
  flaggedDays: number;
  packs: number;
  orders: number;
  // founder only
  ratio?: number | null;
  valueCredited?: number;
  labourCost?: number;
}

export interface EffHeadline {
  /** "rolling7" = last 7 counted days vs the 7 before; "range" = the chosen range vs the same-length period before. */
  kind?: "rolling7" | "range";
  pct: number | null;
  previousPct: number | null;
  changePts: number | null;
  from: string | null;
  to: string | null;
  previousFrom?: string | null;
  previousTo?: string | null;
}

// ── Bands ─────────────────────────────────────────────────────────────────

/** 110% and up is great; under 90% is below standard. */
export const GREAT_PCT = 110;
export const BELOW_PCT = 90;

export type Band = "great" | "on" | "below" | "none";

export function band(pct: number | null | undefined): Band {
  if (pct == null || !Number.isFinite(pct)) return "none";
  if (pct >= GREAT_PCT) return "great";
  if (pct < BELOW_PCT) return "below";
  return "on";
}

export const BAND_LABEL: Record<Band, string> = {
  great: "Great",
  on: "On standard",
  below: "Below standard",
  none: "Not counted",
};

export function pctLabel(pct: number | null | undefined): string {
  return pct == null || !Number.isFinite(pct) ? "—" : `${Math.round(pct)}%`;
}

export type Trend = "up" | "down" | "flat" | "none";

/** Arrow for the headline: within ±1 point reads as flat. */
export function trend(changePts: number | null | undefined): Trend {
  if (changePts == null || !Number.isFinite(changePts)) return "none";
  if (changePts >= 1) return "up";
  if (changePts <= -1) return "down";
  return "flat";
}

/** `before` names the comparison period, e.g. "the 7 days before". */
export function changeLabel(changePts: number | null | undefined, before = "the 7 days before"): string {
  if (changePts == null || !Number.isFinite(changePts)) return `Nothing counted in ${before} to compare with`;
  const n = Math.round(changePts);
  if (n === 0) return `Same as ${before}`;
  return `${n > 0 ? "+" : "−"}${Math.abs(n)} points on ${before}`;
}

// ── Date range choice (kept in the URL) ───────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: string | null): s is string => !!s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export type RangeChoice =
  | { kind: "preset"; range: RangeKey }
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_CHOICE: RangeChoice = { kind: "preset", range: "3m" };

/** Read ?from=&to= (custom) or ?range= (preset) from a URL query string.
 *  Anything malformed falls back to the default 3 months. */
export function parseRangeQuery(search: string): RangeChoice {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const from = q.get("from");
  const to = q.get("to");
  if (isIsoDate(from) && isIsoDate(to) && to >= from) return { kind: "custom", from, to };
  const range = q.get("range");
  if (range && RANGES.some(r => r.key === range)) return { kind: "preset", range: range as RangeKey };
  return DEFAULT_CHOICE;
}

/** The query string for a choice — the page URL and the API use the same one. */
export function rangeQuery(choice: RangeChoice): string {
  return choice.kind === "custom" ? `from=${choice.from}&to=${choice.to}` : `range=${choice.range}`;
}

export interface DateBounds { min: string | null; max: string | null }

function clampDate(d: string, b: DateBounds): string {
  if (b.min && d < b.min) return b.min;
  if (b.max && d > b.max) return b.max;
  return d;
}

/** Apply one date picker edit: stays inside the computed history, and the
 *  other end moves along so the end is never before the start. An empty or
 *  invalid value leaves the range as it was. */
export function editCustomRange(
  current: { from: string; to: string }, field: "from" | "to", value: string, bounds: DateBounds,
): { from: string; to: string } {
  if (!isIsoDate(value)) return current;
  const v = clampDate(value, bounds);
  if (field === "from") return { from: v, to: current.to < v ? v : current.to };
  return { from: current.from > v ? v : current.from, to: v };
}

/** Where "Custom range" starts when first picked: the range on screen, kept
 *  inside the computed history. */
export function startingCustomRange(shown: { from: string; to: string } | null | undefined, bounds: DateBounds, today: string): { from: string; to: string } {
  const to = clampDate(shown?.to ?? today, bounds);
  const from = clampDate(shown?.from ?? today, bounds);
  return from <= to ? { from, to } : { from: to, to };
}

/** Calendar days in a range, both ends included. */
export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** "the 31 days before (1 – 31 Jul)" — what a custom range is compared with. */
export function previousRangeLabel(h: EffHeadline): string {
  if (!h.from || !h.to) return "the period before";
  const n = rangeDays(h.from, h.to);
  const span = h.previousFrom && h.previousTo ? ` (${shortDate(h.previousFrom)} – ${shortDate(h.previousTo)})` : "";
  return `the ${n === 1 ? "day" : `${n} days`} before${span}`;
}

function shortDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// ── Chart ─────────────────────────────────────────────────────────────────

export interface ChartPoint {
  date: string;
  /** Epoch ms, for a time axis. */
  t: number;
  daily: number | null;
  rolling: number | null;
}

/** One point per production day. Days that aren't counted have no dot, but
 *  the rolling line carries on through them. */
export function chartPoints(days: EffDay[]): ChartPoint[] {
  return days.map(d => ({
    date: d.date,
    t: Date.parse(`${d.date}T12:00:00Z`),
    daily: d.status === "ok" ? d.efficiencyPct : null,
    rolling: d.rollingPct,
  }));
}

/** Y-axis domain that always shows the 90/100/110 lines and every point,
 *  rounded out to tens. */
export function yDomain(points: ChartPoint[]): [number, number] {
  const vals = points.flatMap(p => [p.daily, p.rolling]).filter((v): v is number => v != null && Number.isFinite(v));
  const lo = Math.min(BELOW_PCT - 10, ...vals);
  const hi = Math.max(GREAT_PCT + 10, ...vals);
  return [Math.floor(lo / 10) * 10, Math.ceil(hi / 10) * 10];
}

// ── Table ─────────────────────────────────────────────────────────────────

/** Lines in a stable order: most packs across the period first. */
export function lineOrder(days: Array<{ packsByLine: Record<string, number> }>): string[] {
  const totals = new Map<string, number>();
  for (const d of days) for (const [k, v] of Object.entries(d.packsByLine)) totals.set(k, (totals.get(k) ?? 0) + v);
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

export function totalPacks(d: { packsByLine: Record<string, number> }): number {
  return Object.values(d.packsByLine).reduce((a, b) => a + b, 0);
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function weekLabel(weekStart: string): string {
  return `w/c ${new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`;
}

export function monthLabel(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function gbp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

// ── Settings inputs ───────────────────────────────────────────────────────

/** "22" or "22%" → 0.22; null when not a percentage between 0 and max. */
export function parsePercentInput(raw: string, maxPct = 95): number | null {
  const n = Number(raw.trim().replace(/%$/, ""));
  if (!Number.isFinite(n) || n < 0 || n > maxPct) return null;
  return Math.round(n * 100) / 10000;
}

/** 0.22 → "22", 0.039 → "3.9". */
export function percentInputValue(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "";
  return String(Math.round(rate * 1000) / 10);
}
