/**
 * Sales drivers — findings and plain-English notes from the stored daily
 * facts and the changelog. Pure (unit-tested). Objective I.
 *
 * Wording rule (Graeme, 2026-10-16): suggest, with a likelihood, never
 * claim. Every sentence carries its numbers and how many days it rests on.
 */
import {
  leadTimeFindings, weekdayProfile, changeImpact, describeLikelihood, usualLeadByWeekday,
  weekdayOf, type DayFacts, type Comparison, type WeekdayRow,
} from "./analysis";

export interface DailyRow {
  day: string;
  sessions: number | null;
  /** Fraction, Shopify's own online-store conversion rate. */
  conversionRate: number | null;
  orders: number | null;
  newCustomerOrders: number | null;
  revenue: number | null;
  leadDays: number | null;
  nextDayAvailable: boolean | null;
  /** zapiet_1pm | zapiet_check | orders_estimate | null */
  leadSource: string | null;
  sampleOrders: number | null;
}

export interface ChangeRow {
  id: number;
  effectiveAt: string;
  category: string;
  title: string;
  detail: string | null;
  source: string;
}

/** Converting sessions per day: Shopify's rate × sessions, so the analysis
 *  uses Shopify's own definition of a conversion. */
export function toDayFacts(rows: DailyRow[]): DayFacts[] {
  return rows.map(r => ({
    day: r.day,
    sessions: r.sessions,
    orders: r.sessions != null && r.conversionRate != null ? Math.round(r.sessions * r.conversionRate) : null,
    // A one-order morning can't say what was bookable — leave it out.
    leadDays: r.leadSource === "orders_estimate" && (r.sampleOrders ?? 0) < 2 ? null : r.leadDays,
  }));
}

const pctText = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const signedPct = (x: number) => `${x < 0 ? "−" : "+"}${Math.round(Math.abs(x) * 100)}%`;

export function describeComparison(c: Comparison, subject: string): string {
  if (!c.enoughData || c.effect == null) {
    return `${subject}: not enough days yet to judge (${c.exposedDays} such day${c.exposedDays === 1 ? "" : "s"} with a same-weekday comparison so far).`;
  }
  const likely = describeLikelihood(c.probabilityLower);
  if (likely === "no clear difference") {
    return `${subject}: no clear difference in conversion (${signedPct(c.effect)}, range ${signedPct(c.low!)} to ${signedPct(c.high!)}; ${c.exposedDays} days vs ${c.comparisonDays}).`;
  }
  const dir = c.effect < 0 ? "lower" : "higher";
  const sure = Math.round(100 * (c.effect < 0 ? c.probabilityLower! : 1 - c.probabilityLower!));
  return `${subject}: conversion was ${likely.replace(` ${dir}`, "")} ${dir} — about ${pctText(c.effect)} (likely range ${signedPct(c.low!)} to ${signedPct(c.high!)}), compared with the same weekday at its usual wait. Based on ${c.exposedDays} days vs ${c.comparisonDays}; ${sure}% of resamples agree on the direction.`;
}

export interface Findings {
  lead: Array<{ label: string; extraDays: number; comparison: Comparison; sentence: string }>;
  weekday: WeekdayRow[];
  weekendNote: string | null;
  daysAnalysed: number;
  exactLeadDays: number;
  estimatedLeadDays: number;
}

export function buildFindings(rows: DailyRow[]): Findings {
  const facts = toDayFacts(rows);
  const lead = leadTimeFindings(facts).map(f => ({ ...f, sentence: describeComparison(f.comparison, f.label) }));
  const weekday = weekdayProfile(facts);
  const midweek = weekday.filter(w => ["Tuesday", "Wednesday", "Thursday"].includes(w.weekday) && w.conversion != null);
  const weekend = weekday.filter(w => ["Saturday", "Sunday"].includes(w.weekday) && w.conversion != null);
  let weekendNote: string | null = null;
  if (midweek.length && weekend.length) {
    const mid = midweek.reduce((s, w) => s + (w.conversion as number), 0) / midweek.length;
    const wk = weekend.reduce((s, w) => s + (w.conversion as number), 0) / weekend.length;
    const gap = (wk - mid) / mid;
    const usualWeekendWait = weekend.map(w => w.usualLead).filter((x): x is number => x != null);
    weekendNote =
      `Weekend conversion runs about ${pctText(gap)} ${gap < 0 ? "below" : "above"} Tue–Thu on normal weeks. ` +
      (usualWeekendWait.length
        ? `Weekends always carry a longer wait (usually ${Math.min(...usualWeekendWait)}+ days to the next delivery), so weekday habit and wait can't be separated for weekends from this data alone — compare it with the weekday lead-time finding above.`
        : "");
  }
  return {
    lead, weekday, weekendNote,
    daysAnalysed: facts.filter(f => f.sessions != null && f.orders != null).length,
    exactLeadDays: rows.filter(r => r.leadSource?.startsWith("zapiet")).length,
    estimatedLeadDays: rows.filter(r => r.leadSource === "orders_estimate").length,
  };
}

export interface ChangeWithImpact extends ChangeRow {
  impact: (Comparison & { leadShift: number | null; likelihood: string }) | null;
}

/** Fortnight-before vs fortnight-after for each change (same-weekday). */
export function withImpacts(changes: ChangeRow[], rows: DailyRow[]): ChangeWithImpact[] {
  const facts = toDayFacts(rows);
  return changes.map(c => {
    const day = c.effectiveAt.slice(0, 10);
    const r = changeImpact(facts, day);
    return { ...c, impact: r.enoughData ? { ...r, likelihood: describeLikelihood(r.probabilityLower) } : null };
  });
}

/**
 * Notes for the spend advice (Numbers → "What to do"): what else was going
 * on in the window that could move the 7-day ROAS besides the ads. Only
 * says what the data shows, with likelihoods.
 */
export function contextNotes(rows: DailyRow[], changes: ChangeRow[], from: string, to: string, findings: Findings): string[] {
  const notes: string[] = [];
  const all = toDayFacts(rows);
  const usual = usualLeadByWeekday(all);
  const window = rows.filter(r => r.day >= from && r.day <= to);
  const slow = window.filter(r => {
    const u = usual[weekdayOf(r.day)];
    return r.leadDays != null && u != null && r.leadDays > u;
  });
  if (slow.length > 0) {
    const worst = Math.max(...slow.map(r => r.leadDays as number));
    const f = findings.lead[0];
    const evidence = f?.comparison.enoughData && f.comparison.effect != null && describeLikelihood(f.comparison.probabilityLower) !== "no clear difference"
      ? ` On past days with a longer-than-usual wait, conversion was ${describeLikelihood(f.comparison.probabilityLower)} by about ${pctText(f.comparison.effect)} (${f.comparison.exposedDays} days of history), so a weaker week may be the wait rather than the ads.`
      : " There isn't yet enough history to say how much that usually costs.";
    notes.push(`Delivery wait was longer than usual on ${slow.length} of the ${window.length} days (earliest delivery up to ${worst} days away).${evidence}`);
  }
  const inWindow = changes.filter(c => c.effectiveAt.slice(0, 10) >= from && c.effectiveAt.slice(0, 10) <= to);
  const emails = inWindow.filter(c => c.category === "email");
  const site = inWindow.filter(c => c.category !== "email");
  if (emails.length > 0) {
    notes.push(`${emails.length} email${emails.length === 1 ? "" : "s"} sent in these days. Emails bring returning customers that broad ad sets can also claim, so total ROAS may read higher than the ads alone earned.`);
  }
  if (site.length > 0) {
    const named = site.slice(-3).map(c => `“${c.title.slice(0, 70)}”`).join(", ");
    notes.push(`${site.length} website/offer change${site.length === 1 ? "" : "s"} in these days (latest: ${named}). See the changelog in Sales & Marketing.`);
  }
  return notes;
}
