/**
 * Website A/B test results (Graeme, 2026-10-24) — the numbers Shopify
 * Rollouts doesn't give: revenue, revenue per session, new subscriptions.
 * Pure, so the maths is tested; routes/ab-tests.ts loads the data.
 *
 * Where the numbers come from:
 *   sessions / add-to-carts  ab_hits, reported by the theme snippet once per
 *                            browser session (tck-theme snippets/tck-ab.liquid)
 *   orders / revenue         the orders cache: an order belongs to the theme
 *                            whose id is in its _tck_ab_theme cart attribute
 *
 * Which orders count: not cancelled/voided, and not a subscription renewal
 * or wholesale — those aren't decided by what a visitor saw. Revenue is net
 * of refunds, the same as Numbers (lib/order-revenue.ts).
 *
 * "Chance it beats control" is the normal approximation to the difference
 * of two means — for conversion that's two proportions, for revenue per
 * session every session counts, the ones that didn't buy at £0.
 */
import {
  getNetRevenue, isCountableOrder, isPaidOrder, orderHasTag, NEW_CUSTOMER_TAG, NEW_SUB_TAG, RECURRING_SUB_TAG, WHOLESALE_TAG,
  type RevenueOrder,
} from "./order-revenue";

export const AB_THEME_ATTRIBUTE = "_tck_ab_theme";

export interface AbVariant { label: string; themeId: number; themeName: string | null; split: number | null }

export type AbOrder = RevenueOrder & {
  created_at: string;
  note_attributes?: { name: string; value: string }[] | null;
};

export interface VariantHits { visits: number; addToCart: number }

export interface VariantResult {
  label: string;
  themeId: number;
  themeName: string | null;
  split: number | null;
  sessions: number;
  addToCartSessions: number;
  addToCartRate: number | null;
  orders: number;
  conversionRate: number | null;
  revenue: number;
  revenuePerSession: number | null;
  averageOrderValue: number | null;
  newSubscriptions: number;
  newSubscriptionRate: number | null;
  newCustomers: number;
  /** vs the first variant (control); null on the control itself. */
  vsControl: null | {
    conversionLift: number | null;
    conversionChanceBetter: number | null;
    revenuePerSessionLift: number | null;
    revenuePerSessionChanceBetter: number | null;
    newSubscriptionChanceBetter: number | null;
  };
}

export interface AbResults {
  variants: VariantResult[];
  /** Orders in the window with no theme stamp (placed before the snippet, or another route in). */
  untaggedOrders: number;
}

export function orderThemeId(o: Pick<AbOrder, "note_attributes">): number | null {
  const a = (o.note_attributes ?? []).find(x => x?.name === AB_THEME_ATTRIBUTE);
  const n = a ? Number(String(a.value).trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Orders a theme could have won: real, and not a renewal or wholesale. */
export function countsForTest(o: AbOrder): boolean {
  // £0 resends/replacements aren't a basket anyone chose to buy.
  if (!isCountableOrder(o) || !isPaidOrder(o)) return false;
  return !orderHasTag(o, RECURRING_SUB_TAG) && !orderHasTag(o, WHOLESALE_TAG);
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** P(B's true mean > A's), from each side's mean, variance and count. */
export function chanceBetter(a: { mean: number; variance: number; n: number }, b: { mean: number; variance: number; n: number }): number | null {
  if (a.n < 2 || b.n < 2) return null;
  const se = Math.sqrt(a.variance / a.n + b.variance / b.n);
  if (!(se > 0)) return b.mean === a.mean ? 0.5 : b.mean > a.mean ? 1 : 0;
  return normalCdf((b.mean - a.mean) / se);
}

function proportion(successes: number, n: number) {
  const p = n > 0 ? successes / n : 0;
  return { mean: p, variance: p * (1 - p), n };
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const lift = (b: number | null, a: number | null) => (a != null && b != null && a > 0 ? b / a - 1 : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

export function computeAbResults(args: {
  variants: AbVariant[];
  hits: Map<number, VariantHits>;
  orders: AbOrder[];
  from: Date;
  to: Date;
}): AbResults {
  const { variants, hits, from, to } = args;
  const inWindow = args.orders.filter(o => {
    const t = new Date(o.created_at).getTime();
    return t >= from.getTime() && t <= to.getTime() && countsForTest(o);
  });
  const ids = new Set(variants.map(v => v.themeId));
  let untaggedOrders = 0;
  const byTheme = new Map<number, AbOrder[]>();
  for (const o of inWindow) {
    const id = orderThemeId(o);
    if (id == null || !ids.has(id)) { if (id == null) untaggedOrders++; continue; }
    const list = byTheme.get(id) ?? [];
    list.push(o);
    byTheme.set(id, list);
  }

  type Raw = { v: AbVariant; sessions: number; atc: number; orders: AbOrder[]; revenues: number[]; newSubs: number; newCustomers: number };
  const raws: Raw[] = variants.map(v => {
    const h = hits.get(v.themeId) ?? { visits: 0, addToCart: 0 };
    const orders = byTheme.get(v.themeId) ?? [];
    return {
      v, sessions: h.visits, atc: Math.min(h.addToCart, h.visits || h.addToCart), orders,
      revenues: orders.map(o => getNetRevenue(o)),
      newSubs: orders.filter(o => orderHasTag(o, NEW_SUB_TAG)).length,
      newCustomers: orders.filter(o => orderHasTag(o, NEW_CUSTOMER_TAG)).length,
    };
  });

  // Revenue per session as a mean over sessions (non-buyers at £0).
  const perSession = (r: Raw) => {
    const n = Math.max(r.sessions, r.orders.length);
    const sum = r.revenues.reduce((s, x) => s + x, 0);
    const sumSq = r.revenues.reduce((s, x) => s + x * x, 0);
    const mean = n > 0 ? sum / n : 0;
    const variance = n > 1 ? (sumSq - n * mean * mean) / (n - 1) : 0;
    return { mean, variance, n };
  };

  const control = raws[0];
  const results = raws.map((r, i): VariantResult => {
    const revenue = round2(r.revenues.reduce((s, x) => s + x, 0));
    const conversionRate = ratio(r.orders.length, r.sessions);
    const rps = r.sessions > 0 ? revenue / r.sessions : null;
    let vsControl: VariantResult["vsControl"] = null;
    if (i > 0 && control) {
      const cConv = ratio(control.orders.length, control.sessions);
      const cRps = control.sessions > 0 ? control.revenues.reduce((s, x) => s + x, 0) / control.sessions : null;
      vsControl = {
        conversionLift: lift(conversionRate, cConv),
        conversionChanceBetter: chanceBetter(proportion(control.orders.length, control.sessions), proportion(r.orders.length, r.sessions)),
        revenuePerSessionLift: lift(rps, cRps),
        revenuePerSessionChanceBetter: chanceBetter(perSession(control), perSession(r)),
        newSubscriptionChanceBetter: chanceBetter(proportion(control.newSubs, control.sessions), proportion(r.newSubs, r.sessions)),
      };
    }
    return {
      label: r.v.label, themeId: r.v.themeId, themeName: r.v.themeName, split: r.v.split,
      sessions: r.sessions,
      addToCartSessions: r.atc,
      addToCartRate: ratio(r.atc, r.sessions),
      orders: r.orders.length,
      conversionRate,
      revenue,
      revenuePerSession: rps == null ? null : round2(rps),
      averageOrderValue: r.orders.length ? round2(revenue / r.orders.length) : null,
      newSubscriptions: r.newSubs,
      newSubscriptionRate: ratio(r.newSubs, r.sessions),
      newCustomers: r.newCustomers,
      vsControl,
    };
  });
  return { variants: results, untaggedOrders };
}
