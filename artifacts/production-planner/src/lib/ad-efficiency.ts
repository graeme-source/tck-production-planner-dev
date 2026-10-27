/**
 * Advertising efficiency — the maths behind the three ROAS cards on the
 * Numbers page's At a Glance row (Graeme, 2026-10-11). Objective I.
 *
 * Graeme follows the Hammersley Brothers programme. His sheet tracks, per
 * day, total sales, first-customer sales and ad cost, and the number he
 * steers by is the ROLLING 7-DAY new-customer ROAS:
 *
 *     sum of 7 days' new-customer sales ÷ sum of 7 days' ad spend
 *
 * (the sheet's =SUM(F7:F13)/SUM(L7:L13)). Sums ÷ sums, never an average of
 * daily percentages.
 *
 * Nothing here is a new definition. Every window figure goes through
 * windowRoas() in lib/roas.ts — the same function the Order Analysis ROAS
 * tile uses — so "new-customer revenue", "spend" and the "we don't know"
 * rules are identical:
 *   - new-customer revenue = net revenue of orders tagged "new-customer"
 *     (server lib/order-revenue.ts, via the trend series);
 *   - a window only gets a number when EVERY day in it has a spend figure;
 *     a missing day is "—, waiting on N days of spend", never a flattered %.
 *
 * Windows (all London days, all COMPLETE days — today is still running,
 * its orders still arriving and Meta's spend only part-reported):
 *   last 7     the 7 days ending yesterday (the sheet's 7-day block)
 *   this month the 1st of this month to yesterday (empty on the 1st)
 *   last 30    the 30 days ending yesterday (the Numbers "Last 30 days")
 *
 * Every threshold comes from the founder's settings (ad_efficiency_settings,
 * migration 0168). Pure — tested in ad-efficiency.test.ts.
 */
import { addDays, daysBetween, startOfMonth, windowRoas, type DayString, type RoasResult, type RoasWindow } from "./roas";
import type { KpiBand } from "./station-kpi-bands";

/** One London day's figures, as the server sends them. */
export interface AdDay {
  date: DayString;
  /** Net revenue of every countable order (the Total Sales tile's rule). */
  revenue: number;
  /** Net revenue of orders tagged new-customer. */
  newCustomerRevenue: number;
  /** Recorded ad spend; null when nothing has been recorded for the day. */
  spend: number | null;
}

export interface AdEfficiencySettings {
  ncRoas7dTargetPct: number;
  ncRoasMtdTargetPct: number;
  totalRoas30dTargetPct: number;
  /** How far under target (as % of target) is still amber. */
  amberWidthPct: number;
  /** ± band around the 7-day target in which the advice is "hold". */
  holdBandPct: number;
  raiseSpendMinPct: number;
  raiseSpendMaxPct: number;
  /** £ of spend over the 7 days below which the advice is softened. */
  smallSampleSpend: number;
}

export type Measure = "newCustomer" | "total";

/** A window from..to inclusive, in the shape windowRoas expects. */
export function windowOf(from: DayString, to: DayString): RoasWindow {
  const days = daysBetween(from, to);
  return { from, to, days, dayCount: days.length };
}

export interface AdWindows {
  last7: RoasWindow;
  monthToDate: RoasWindow;
  last30: RoasWindow;
}

/** The three card windows, given the last complete day (yesterday). */
export function adWindows(lastCompleteDay: DayString): AdWindows {
  const today = addDays(lastCompleteDay, 1);
  return {
    last7: windowOf(addDays(lastCompleteDay, -6), lastCompleteDay),
    // From the 1st of TODAY's month: on the 1st this is empty ("no complete
    // days this month yet") rather than quietly showing last month.
    monthToDate: windowOf(startOfMonth(today), lastCompleteDay),
    last30: windowOf(addDays(lastCompleteDay, -29), lastCompleteDay),
  };
}

/** The first day the server must send so every card and sparkline can be
 *  drawn: 30 sparkline points of a rolling 30-day figure reach back 59 days. */
export function earliestDayNeeded(lastCompleteDay: DayString, sparkPoints = SPARK_POINTS): DayString {
  const rolling30 = addDays(lastCompleteDay, -(30 + sparkPoints - 2));
  const monthStart = adWindows(lastCompleteDay).monthToDate.from;
  return rolling30 < monthStart ? rolling30 : monthStart;
}

/** Sparkline length for the rolling cards. */
export const SPARK_POINTS = 30;

function byDate(days: AdDay[]): Map<DayString, AdDay> {
  const map = new Map<DayString, AdDay>();
  for (const d of days) if (!map.has(d.date)) map.set(d.date, d);
  return map;
}

/**
 * One window's ROAS for one measure — windowRoas, fed the window's summed
 * revenue and its spend rows. Revenue is unknown (null) when any day in the
 * window wasn't sent, so a short read can't pass for a quiet week.
 */
export function measureWindow(days: AdDay[], win: RoasWindow, measure: Measure): RoasResult {
  const map = byDate(days);
  let revenue: number | null = 0;
  for (const d of win.days) {
    const row = map.get(d);
    if (!row) { revenue = null; break; }
    revenue += measure === "newCustomer" ? row.newCustomerRevenue : row.revenue;
  }
  // Sum in pence so seven days of pounds-and-pence can't drift.
  const rounded = revenue == null ? null : Math.round(revenue * 100) / 100;
  return windowRoas({
    window: win,
    revenue: rounded,
    spendDays: win.days.map((date) => ({ date, amount: map.get(date)?.spend ?? null })),
  });
}

/** Days in the window whose recorded spend is exactly £0 — a real figure,
 *  but if ads were running it means the spend is missing. */
export function zeroSpendDays(days: AdDay[], win: RoasWindow): DayString[] {
  const map = byDate(days);
  return win.days.filter((d) => {
    const s = map.get(d)?.spend;
    return s != null && Math.round(s * 100) === 0;
  });
}

export interface SparkPoint {
  date: DayString;
  /** The card's figure as at the end of this day; null = a gap. */
  percent: number | null;
}

/** The rolling figure (e.g. 7-day) for each of the last `points` days. */
export function rollingSeries(days: AdDay[], measure: Measure, windowDays: number, lastCompleteDay: DayString, points = SPARK_POINTS): SparkPoint[] {
  const out: SparkPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const end = addDays(lastCompleteDay, -i);
    const r = measureWindow(days, windowOf(addDays(end, -(windowDays - 1)), end), measure);
    out.push({ date: end, percent: r.available ? r.percent : null });
  }
  return out;
}

/** The month-to-date figure as it stood at the end of each day this month. */
export function monthToDateSeries(days: AdDay[], measure: Measure, lastCompleteDay: DayString): SparkPoint[] {
  const { monthToDate } = adWindows(lastCompleteDay);
  return monthToDate.days.map((end) => {
    const r = measureWindow(days, windowOf(monthToDate.from, end), measure);
    return { date: end, percent: r.available ? r.percent : null };
  });
}

// ── Traffic lights ─────────────────────────────────────────────────────────

const EPS = 1e-9;

/**
 * Colour relative to target: green at or above it, amber up to
 * `amberWidthPct` under it, red below that; neutral when there's no figure
 * or no target. Judged on the whole % the card SHOWS, so a card reading
 * 210% against 210% is never amber.
 */
export function roasBand(percent: number | null | undefined, targetPct: number, amberWidthPct: number): KpiBand {
  if (percent == null || !Number.isFinite(percent) || !(targetPct > 0)) return "neutral";
  const ratio = percent / targetPct;
  if (ratio + EPS >= 1) return "green";
  if (ratio + EPS >= 1 - amberWidthPct / 100) return "amber";
  return "red";
}

// ── Shade scale (Graeme, 2026-10-12) ─────────────────────────────────────
// "The greens are just telling me that everything's great all the time… I
// don't know how great." One continuous scale from dark red (way under
// target) through yellow and brand green to a deep platinum teal (way over),
// cut into ROAS_SHADE_STEPS + 1 shades so the colour alone says roughly how
// far above or below target a figure is.

/** Number of steps between the worst and best shade (31 shades in all). */
export const ROAS_SHADE_STEPS = 30;

/** Anchor colours by ratio of figure ÷ target; shades are interpolated
 *  between them. Below the first ratio is the darkest red, above the last
 *  the deepest platinum. */
export const ROAS_SHADE_ANCHORS: ReadonlyArray<{ ratio: number; hex: string }> = [
  { ratio: 0.7, hex: "#7f1d1d" },  // dark red — 30% or more under target
  { ratio: 0.85, hex: "#e11d48" }, // red
  { ratio: 0.95, hex: "#facc15" }, // yellow — just under
  { ratio: 1.0, hex: "#7cb342" },  // brand green — on target
  { ratio: 1.25, hex: "#059669" }, // emerald — well above
  { ratio: 1.5, hex: "#0f5f59" },  // deep platinum teal — 50% or more over
];

export interface RoasShade {
  /** 0 = worst (dark red) … ROAS_SHADE_STEPS = best (deep platinum). */
  step: number;
  hex: string;
  /** True when white text reads better than dark text on this shade. */
  darkBackground: boolean;
}

const hexToRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb: number[]) => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Colour of the shade at a ratio, snapped to one of the 31 shades. */
export function shadeAtRatio(ratio: number): RoasShade {
  const first = ROAS_SHADE_ANCHORS[0]!;
  const last = ROAS_SHADE_ANCHORS[ROAS_SHADE_ANCHORS.length - 1]!;
  const t = Math.min(1, Math.max(0, (ratio - first.ratio) / (last.ratio - first.ratio)));
  const step = Math.round(t * ROAS_SHADE_STEPS);
  const r = first.ratio + (step / ROAS_SHADE_STEPS) * (last.ratio - first.ratio);
  let i = 0;
  while (i < ROAS_SHADE_ANCHORS.length - 2 && r > ROAS_SHADE_ANCHORS[i + 1]!.ratio) i++;
  const a = ROAS_SHADE_ANCHORS[i]!;
  const b = ROAS_SHADE_ANCHORS[i + 1]!;
  const f = Math.min(1, Math.max(0, (r - a.ratio) / (b.ratio - a.ratio)));
  const ca = hexToRgb(a.hex);
  const cb = hexToRgb(b.hex);
  const rgb = ca.map((v, k) => v + (cb[k]! - v) * f);
  // Relative luminance (sRGB) — white text below ~0.4.
  const lum = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lum[0]! + 0.7152 * lum[1]! + 0.0722 * lum[2]!;
  return { step, hex: rgbToHex(rgb), darkBackground: L < 0.4 };
}

/** Shade for a ROAS figure against its target; null when there's no figure. */
export function roasShade(percent: number | null | undefined, targetPct: number): RoasShade | null {
  if (percent == null || !Number.isFinite(percent) || !(targetPct > 0)) return null;
  return shadeAtRatio(percent / targetPct);
}

/** Header verdict, finer than the band: "Well above target" from 25% over. */
export function roasVerdict(percent: number | null | undefined, targetPct: number, amberWidthPct: number): string {
  const band = roasBand(percent, targetPct, amberWidthPct);
  if (band === "green" && percent! / targetPct >= 1.25 - EPS) return ROAS_BAND_WORDS.platinum;
  return ROAS_BAND_WORDS[band];
}

export const ROAS_BAND_WORDS: Record<KpiBand, string> = {
  platinum: "Well above target",
  green: "On or above target",
  amber: "Just under target",
  red: "Below target",
  neutral: "Not enough data",
};

// ── What to do ─────────────────────────────────────────────────────────────

export type RecommendationTone = "raise" | "hold" | "trim" | "unknown";

export interface Recommendation {
  tone: RecommendationTone;
  headline: string;
  /** Caveats, each a plain sentence; most important first. */
  notes: string[];
  /** True when spend is too small to judge and the advice was softened. */
  softened: boolean;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const pct = (n: number) => `${Math.round(n * 10) / 10}`;

function shortDate(d: DayString): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d.slice(8, 10))} ${months[Number(d.slice(5, 7)) - 1]}`;
}

/**
 * The plain-English "What to do" line, from the 7-day new-customer ROAS
 * against its target (the Hammersley rule):
 *
 *   at or above target × (1 + hold band)  → raise spend (probably under-spending)
 *   below target × (1 − hold band)        → trim spend (probably over-spending)
 *   in between                            → hold steady
 *
 * with data-driven caveats: overall 30-day ROAS below its target when the
 * advice is to raise, £0 spend days in the window, and too little spend to
 * judge (softened).
 */
export function recommend(input: {
  days: AdDay[];
  windows: AdWindows;
  settings: AdEfficiencySettings;
}): Recommendation {
  const { days, windows, settings } = input;
  const last7 = measureWindow(days, windows.last7, "newCustomer");
  const total30 = measureWindow(days, windows.last30, "total");
  const notes: string[] = [];

  const zeros = zeroSpendDays(days, windows.last7);
  if (zeros.length > 0) {
    notes.push(
      `${zeros.length} day${zeros.length === 1 ? "" : "s"} in the last 7 show £0 ad spend (${zeros.map(shortDate).join(", ")}). ` +
        `If ads were running, that spend is missing and this number is incomplete.`,
    );
  }

  if (!last7.available) {
    return {
      tone: "unknown",
      headline: `No advice yet — the 7-day number is incomplete: ${last7.reason.charAt(0).toLowerCase()}${last7.reason.slice(1)}.`,
      notes,
      softened: false,
    };
  }

  const target = settings.ncRoas7dTargetPct;
  const ratio = last7.percent / target;
  const hold = settings.holdBandPct / 100;
  const tone: RecommendationTone = ratio + EPS >= 1 + hold ? "raise" : ratio + EPS < 1 - hold ? "trim" : "hold";
  const softened = last7.spend < settings.smallSampleSpend;
  const raiseRange = `~${pct(settings.raiseSpendMinPct)}–${pct(settings.raiseSpendMaxPct)}%`;

  let headline: string;
  if (tone === "raise") {
    headline = softened
      ? `Early sign you're beating your new-customer target — spend is still small, so raise it gently (~${pct(settings.raiseSpendMinPct)}%) and watch the 7-day number.`
      : `You're beating your new-customer target — you're probably not spending enough. Consider raising ad spend ${raiseRange} and watch the 7-day number.`;
  } else if (tone === "trim") {
    headline = softened
      ? "Early sign you're below target — spend is still small, so give it a few more days before cutting, then trim the weakest ads."
      : "Below target — you're probably spending too much for the new customers you're getting. Trim spend or pause the weakest ads.";
  } else {
    headline = "On target — hold spend steady.";
  }

  if (tone === "raise") {
    if (total30.available) {
      if (total30.percent < settings.totalRoas30dTargetPct) {
        notes.unshift(
          `…but overall ROAS is ${total30.percent}% over the last 30 days, below your ${pct(settings.totalRoas30dTargetPct)}% target — check returning-customer sales before scaling.`,
        );
      }
    } else {
      notes.unshift(`Overall 30-day ROAS can't be checked (${total30.reason.toLowerCase()}) — look at returning-customer sales before scaling.`);
    }
  }

  if (softened) {
    notes.push(
      `Only ${gbp(last7.spend)} spent on ads in the last 7 days (under ${gbp(settings.smallSampleSpend)}) — too little to judge reliably, so treat this as a hint, not a verdict.`,
    );
  }

  return { tone, headline, notes, softened };
}

// ── Which spend is counted ─────────────────────────────────────────────────
// The line under the "What to do" card. Ad spend is Meta (synced or typed
// by hand) plus Google Ads once its script has sent anything (the server
// combines them: api-server lib/ad-spend-channels.ts). This only SAYS which
// channels are in and flags gaps — the figures are already totals.

export interface SpendSourceRow {
  date: DayString;
  /** The Meta channel's source: 'meta' (synced) or 'manual' (typed). */
  source: string | null;
  /** Which channel the day is missing, when its total is unknown. */
  missing?: "meta" | "google" | null;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "5 Oct" from 2026-10-05. */
export const shortDay = (d: DayString) => `${Number(d.slice(8, 10))} ${SHORT_MONTHS[Number(d.slice(5, 7)) - 1]}`;

function dayList(days: DayString[], max = 5): string {
  const shown = days.slice(0, max).map(shortDay).join(", ");
  return days.length > max ? `${shown} and ${days.length - max} more` : shown;
}

/**
 * One plain sentence: which channels the ROAS figures divide by.
 * `googleFirstDate` is the first day Google Ads ever sent (null = never),
 * so "Google Ads isn't connected" disappears as soon as it has.
 */
export function spendSourceLine(rows: SpendSourceRow[], googleFirstDate: DayString | null): string {
  const synced = rows.some((r) => r.source === "meta");
  const typed = rows.filter((r) => r.source === "manual").map((r) => r.date);
  const parts = [`Ad spend counted: Meta ads${synced ? " (synced)" : ""}`];
  if (typed.length > 0) parts.push(`${typed.length} Meta day${typed.length === 1 ? "" : "s"} typed by hand (${dayList(typed)})`);
  if (googleFirstDate == null) {
    return `${parts.join(" · ")}. Google Ads isn't connected, so its spend is not included.`;
  }
  parts.push(`Google Ads, from ${shortDay(googleFirstDate)}`);
  const gaps = rows.filter((r) => r.missing === "google").map((r) => r.date);
  const gapNote = gaps.length > 0
    ? ` No Google Ads figure for ${dayList(gaps)} yet, so the ROAS for those days shows "—" until the script sends them.`
    : "";
  return `${parts.join(" · ")}.${gapNote}`;
}

// ── 90-day history summary (Graeme, 2026-10-14) ──────────────────────────
// How consistently the 7-day new-customer ROAS stays on target: days on or
// above target (rolling and single-day), the longest run of rolling days on
// target, and the run we're in now (on target, or below). Days with no
// figure are skipped, never counted as misses.

export interface RoasHistorySummary {
  avgDays: number;
  avgOnTarget: number;
  dayDays: number;
  dayOnTarget: number;
  longestRun: number;
  /** Days on target in a row, ending with the most recent day with a figure. */
  currentRun: number;
  /** Days below target in a row, ending with the most recent day with a figure. */
  currentBelow: number;
}

export function summariseRoasHistory(avg7: SparkPoint[], daily: SparkPoint[], targetPct: number): RoasHistorySummary {
  const on = (v: number) => v + EPS >= targetPct;
  const avgVals = avg7.map(p => p.percent).filter((v): v is number => v != null && Number.isFinite(v));
  const dayVals = daily.map(p => p.percent).filter((v): v is number => v != null && Number.isFinite(v));
  let longestRun = 0;
  let run = 0;
  for (const v of avgVals) {
    run = on(v) ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
  }
  let currentRun = 0;
  let currentBelow = 0;
  for (let i = avgVals.length - 1; i >= 0; i--) {
    const hit = on(avgVals[i]!);
    if (i === avgVals.length - 1) { if (hit) currentRun = 1; else currentBelow = 1; continue; }
    if (hit && currentRun > 0) currentRun++;
    else if (!hit && currentBelow > 0) currentBelow++;
    else break;
  }
  return {
    avgDays: avgVals.length,
    avgOnTarget: avgVals.filter(on).length,
    dayDays: dayVals.length,
    dayOnTarget: dayVals.filter(on).length,
    longestRun,
    currentRun,
    currentBelow,
  };
}

// ── Today's new-customer ROAS (Graeme, 2026-10-27) ──────────────────────────
// On the "New customers today" tile, under the sales, as big as them:
// today's new-customer sales ÷ today's ad spend so far (Meta syncs through
// the day; both are partial until the day ends), coloured green / yellow /
// red against the new-customer ROAS target.

/** % — null when there's no spend recorded for today yet. */
export function todayNcRoasPercent(newCustomerRevenue: number, spend: number | null | undefined): number | null {
  if (spend == null || !(spend > 0) || !Number.isFinite(newCustomerRevenue)) return null;
  return (newCustomerRevenue / spend) * 100;
}

/** The figure's text colour per band — readable on the white tile. */
export const ROAS_FIGURE_CLASS: Record<KpiBand, string> = {
  platinum: "text-teal-600",
  green: "text-[#7cb342]",
  amber: "text-amber-500",
  red: "text-rose-600",
  neutral: "text-muted-foreground",
};
