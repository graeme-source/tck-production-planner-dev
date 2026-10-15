/**
 * Running ("expected") ingredient stock — pure maths, no database.
 * (Graeme approved 15 Oct 2026; Objective B. docs/RUNNING_STOCK.md.)
 *
 *   expected = last real count + goods received since − usage since
 *
 * Nothing here writes stock. The figure is computed on read from what the
 * app already records: counts (people), receipts (goods-in), and usage
 * (prep tins ticked, mixing/building batches, recorded waste). It starts
 * from each ingredient's most recent real count, so there is no special
 * "count day" — the first count after go-live is the starting point.
 *
 * It is NEVER shown at the stations or on a stock-check screen (blind
 * counts: "I don't want people to just go 'yeah, that sounds right'"). It
 * is for managers: the Stock accuracy page and the Orders page.
 *
 * lib/stock-ledger-data.ts gathers the events; this file only does sums.
 */

/** A stock_entries note written by the system rather than a person. Rows
 *  with these notes are movements (goods-in, undo, transfers) — every other
 *  ingredient row is a count somebody typed (stock checks at the prep
 *  stations, the Orders page box, Stock Control). Exactly the notes written
 *  by routes/deliveries.ts and routes/stock-transfers.ts. */
const SYSTEM_NOTE = /^(Delivery from PO #|Undo delivery PO #|Transfer (in|out) )/;

export function isSystemStockNote(notes: string | null | undefined): boolean {
  return notes != null && SYSTEM_NOTE.test(notes);
}

export type UsageSource = "prep" | "mixing" | "build" | "subRecipe" | "waste";

export const USAGE_SOURCE_LABEL: Record<UsageSource, string> = {
  prep: "Prep tins ticked",
  mixing: "Added at mixing",
  build: "Added at building",
  subRecipe: "In bases, sauces, dough & other sub-recipes (estimated from batches made with them)",
  waste: "Recorded waste",
};

export interface CountEvent {
  /** Epoch ms. */
  at: number;
  qty: number;
}

/** A goods-in movement, signed (an undone delivery is negative). */
export interface ReceiptEvent {
  at: number;
  qty: number;
}

export interface UsageEvent {
  at: number;
  qty: number;
  source: UsageSource;
  /** The production plan the usage belongs to (null for waste). */
  planId: number | null;
}

/** How much of an ingredient's usage the app can see.
 *  tracked   — every recipe use is a prep tin, a mixing or a building line;
 *  estimated — some use is inside a sub-recipe, estimated from batches;
 *  untracked — no recipe uses it (packaging, cleaning …): only deliveries
 *              are known, so an "expected" figure would only ever grow. */
export type UsageCoverage = "tracked" | "estimated" | "untracked";

export const COVERAGE_LABEL: Record<UsageCoverage, string> = {
  tracked: "Tracked — prep, mixing and building usage is recorded",
  estimated: "Partly tracked — some usage (bases, sauces, dough, sub-recipes) is estimated from batches made",
  untracked: "Usage not tracked — the app only sees deliveries",
};

export interface IngredientLedger {
  counts: CountEvent[];
  receipts: ReceiptEvent[];
  usage: UsageEvent[];
  coverage: UsageCoverage;
}

/** Two counts this close together are one count recorded twice (the prep
 *  station writes daily_stock_checks AND a stock_entries row). */
const SAME_COUNT_MS = 2 * 60_000;

/** Counts oldest first, near-duplicates collapsed to the later one. */
export function mergeCounts(counts: CountEvent[]): CountEvent[] {
  const sorted = [...counts].filter(c => Number.isFinite(c.qty) && Number.isFinite(c.at)).sort((a, b) => a.at - b.at);
  const out: CountEvent[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.at - last.at <= SAME_COUNT_MS) out[out.length - 1] = c;
    else out.push(c);
  }
  return out;
}

export type UsageBySource = Partial<Record<UsageSource, number>>;

export interface RollForward {
  receipts: number;
  usage: number;
  usageBySource: UsageBySource;
  /** Usage per production plan — the Orders page adds back the selected
   *  plan's share, because its requirement already counts it. */
  usageByPlan: Record<number, number>;
}

/** Receipts and usage in the window (fromMs, toMs]. A tin ticked at or
 *  before a count is inside that count (the outstanding-prep rule). */
export function rollForward(ledger: Pick<IngredientLedger, "receipts" | "usage">, fromMs: number, toMs: number): RollForward {
  let receipts = 0;
  for (const r of ledger.receipts) if (r.at > fromMs && r.at <= toMs) receipts += r.qty;
  let usage = 0;
  const usageBySource: UsageBySource = {};
  const usageByPlan: Record<number, number> = {};
  for (const u of ledger.usage) {
    if (u.at <= fromMs || u.at > toMs) continue;
    usage += u.qty;
    usageBySource[u.source] = (usageBySource[u.source] ?? 0) + u.qty;
    if (u.planId != null) usageByPlan[u.planId] = (usageByPlan[u.planId] ?? 0) + u.qty;
  }
  return { receipts, usage, usageBySource, usageByPlan };
}

export interface ExpectedStock extends RollForward {
  /** The real count it is based on. */
  basedOn: CountEvent;
  /** Count + receipts − usage. Can go below zero (that itself says a
   *  delivery wasn't booked in, or usage is over-estimated). */
  expected: number;
}

/** Expected stock at `atMs` from the latest count at or before it. Null
 *  when the ingredient has never been counted (no starting point). */
export function expectedAt(ledger: IngredientLedger, atMs: number): ExpectedStock | null {
  const counts = mergeCounts(ledger.counts);
  let base: CountEvent | null = null;
  for (const c of counts) if (c.at <= atMs) base = c;
  if (!base) return null;
  const roll = rollForward(ledger, base.at, atMs);
  return { ...roll, basedOn: base, expected: base.qty + roll.receipts - roll.usage };
}

export interface CountVariance {
  /** The count being checked. */
  at: number;
  counted: number;
  /** What the ledger expected at that moment, from the previous count. */
  expected: number;
  previousCount: CountEvent;
  receipts: number;
  usage: number;
  /** counted − expected: negative = less on the shelf than expected. */
  diff: number;
  /** diff ÷ expected, as a fraction; null when expected ≤ 0. */
  pct: number | null;
  /** diff ÷ the bigger of expected and the usage in between — how far off
   *  the ledger was relative to what it was tracking. Small daily-bought
   *  items sit near zero stock, where "% of expected" explodes (0.2 kg
   *  expected, 0 counted = −100%); this stays meaningful. Null when both
   *  are 0. Used for flags and the accuracy figure. */
  gap: number | null;
}

/** The gap measure for one comparison (see CountVariance.gap). */
export function relativeGap(diff: number, expected: number, usage: number): number | null {
  const scale = Math.max(expected, usage);
  return scale > 0 ? diff / scale : null;
}

/** Each count (after the first) compared with what was expected just
 *  before it was made. Oldest first. */
export function countVariances(ledger: IngredientLedger): CountVariance[] {
  const counts = mergeCounts(ledger.counts);
  const out: CountVariance[] = [];
  for (let i = 1; i < counts.length; i++) {
    const prev = counts[i - 1];
    const cur = counts[i];
    const roll = rollForward(ledger, prev.at, cur.at);
    const expected = prev.qty + roll.receipts - roll.usage;
    const diff = cur.qty - expected;
    out.push({
      at: cur.at,
      counted: cur.qty,
      expected,
      previousCount: prev,
      receipts: roll.receipts,
      usage: roll.usage,
      diff,
      pct: expected > 0 ? diff / expected : null,
      gap: relativeGap(diff, expected, roll.usage),
    });
  }
  return out;
}

export type VarianceFlagKind = "big-gap" | "repeated-shortfall" | "repeated-surplus" | "goes-negative";

export interface VarianceFlag {
  kind: VarianceFlagKind;
  message: string;
}

/** A gap this big (either way) on one count is worth a look. */
export const BIG_GAP_PCT = 0.25;
/** Gaps at least this big, mostly the same way, are a pattern. */
const PATTERN_GAP_PCT = 0.1;

/** Flags for the Stock accuracy page from the recent variances (oldest
 *  first). Wording says what it might mean — it can't know which. */
export function varianceFlags(variances: CountVariance[], latestExpected: number | null = null): VarianceFlag[] {
  const flags: VarianceFlag[] = [];
  // A re-count minutes after a count (nothing moved) says nothing.
  const meaningful = variances.filter(v => v.usage > 0 || v.receipts !== 0);
  const recent = meaningful.slice(-4);
  const short = recent.filter(v => v.gap != null && v.gap <= -PATTERN_GAP_PCT).length;
  const over = recent.filter(v => v.gap != null && v.gap >= PATTERN_GAP_PCT).length;
  if (recent.length >= 3 && short >= 3) {
    flags.push({
      kind: "repeated-shortfall",
      message: `Counts keep coming in below expected (${short} of the last ${recent.length}) — waste, generous portions, or usage the app doesn't see.`,
    });
  } else if (recent.length >= 3 && over >= 3) {
    flags.push({
      kind: "repeated-surplus",
      message: `Counts keep coming in above expected (${over} of the last ${recent.length}) — recipe amounts or yields set too high, or stock arriving without being booked in.`,
    });
  }
  const last = meaningful[meaningful.length - 1];
  if (last && last.gap != null && Math.abs(last.gap) >= BIG_GAP_PCT && flags.length === 0) {
    flags.push({
      kind: "big-gap",
      message: last.diff < 0
        ? "Last count was well below expected — a miscount, waste, or something used that wasn't recorded?"
        : "Last count was well above expected — a miscount, or a delivery that wasn't booked in?",
    });
  }
  if (latestExpected != null && latestExpected < 0) {
    flags.push({
      kind: "goes-negative",
      message: "Expected stock has gone below zero — a delivery probably wasn't booked in, or usage is over-estimated. A count will reset it.",
    });
  }
  return flags;
}

/** Typical accuracy: median |gap| (see CountVariance.gap) over the
 *  variances with some usage in between (a re-count minutes later proves
 *  nothing). Null when there are none. */
export function medianAbsGap(variances: CountVariance[]): number | null {
  const xs = variances.filter(v => v.usage > 0).map(v => v.gap).filter((p): p is number => p != null).map(Math.abs).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ── Orders page ─────────────────────────────────────────────────────────

export type OrderStockBasis = "count" | "expected" | "not-counted";

export interface OrderStockInput {
  /** What the Orders page has always read: the newest stock row or daily
   *  check (a count, plus any delivery appended after it). */
  snapshotStock: number;
  stockCheckEnabled: boolean;
  /** London date (YYYY-MM-DD) of the latest real count; null = never. */
  lastCountDate: string | null;
  /** Today's London date. */
  today: string;
  /** Expected stock now; null when never counted. */
  expected: ExpectedStock | null;
  coverage: UsageCoverage;
  /** The plan being ordered for: its usage since the count is added back,
   *  because the order's requirement already covers that whole plan. */
  selectedPlanId: number;
}

export interface OrderStockChoice {
  basis: OrderStockBasis;
  stockOnHand: number;
  /** True when the figure is the expected one: ticked tins are then already
   *  off the stock, so "still to prep" must count only UNticked tins (pass
   *  "now" as the ingredient's checked-at to computeOutstandingPrepRaw). */
  outstandingPrepFromNow: boolean;
}

/**
 * Which stock figure the order uses (Graeme, 15 Oct 2026):
 *  - counted today (any item) → that count, exactly as before;
 *  - otherwise, with a count to start from and usage the app can see →
 *    the EXPECTED figure (last count + deliveries − usage), clamped at 0;
 *  - otherwise as before: the stale count for stock-checked items, and
 *    "not counted" for kanban items nobody checks.
 * A count from an earlier day has had usage since that the expected figure
 * takes off, so "fresh" means today, whatever the check frequency.
 */
export function chooseOrderStock(input: OrderStockInput): OrderStockChoice {
  if (input.lastCountDate != null && input.lastCountDate === input.today) {
    return { basis: "count", stockOnHand: input.snapshotStock, outstandingPrepFromNow: false };
  }
  if (input.expected && input.coverage !== "untracked") {
    const addBack = input.expected.usageByPlan[input.selectedPlanId] ?? 0;
    return {
      basis: "expected",
      stockOnHand: Math.max(0, input.expected.expected + addBack),
      outstandingPrepFromNow: true,
    };
  }
  return {
    basis: input.stockCheckEnabled ? "count" : "not-counted",
    stockOnHand: input.snapshotStock,
    outstandingPrepFromNow: false,
  };
}

/** Round for display/storage in the API payload (2 dp). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
