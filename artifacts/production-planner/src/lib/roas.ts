/**
 * New-customer ROAS — the maths behind the Numbers page tiles.
 *
 * ROAS here is the definition the "New Customer ROAS" tile has always used:
 *
 *     ROAS = new-customer revenue ÷ ad spend
 *
 * shown as a percentage, so £600 of spend returning £2,000 of new-customer
 * revenue reads 333%. Nothing here invents a new measure — the seven-day
 * figure is the same division, with both sides summed over the window.
 *
 * The whole reason this lives in its own file with its own tests is the
 * "we don't know" case. A ROAS of 0% is a claim: *the ads made nothing*.
 * "—" is a different and far weaker claim: *nobody has told us what we
 * spent*. Printing the first when we mean the second would have Graeme
 * switching off ads that are working, so every path that cannot divide
 * honestly returns `unavailable` with a reason, and never a number.
 *
 * Ad spend reaches us two ways — typed in on the panel, or synced from the
 * Meta Marketing API — and the maths treats them identically. `source` only
 * records provenance; a pound is a pound.
 */

/** A calendar day in London, YYYY-MM-DD. */
export type DayString = string;

const LONDON_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The London calendar day an instant falls on, YYYY-MM-DD. */
export function londonDayString(ts: number | Date): DayString {
  return LONDON_DAY_FORMATTER.format(ts instanceof Date ? ts : new Date(ts));
}

/** Add (or subtract) whole calendar days to a YYYY-MM-DD string.
 *  Done in UTC on a date-only value, so it never drifts across a BST change. */
export function addDays(date: DayString, days: number): DayString {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${date}`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive. Empty when `from` is after `to`. */
export function daysBetween(from: DayString, to: DayString): DayString[] {
  const out: DayString[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 400) break; // paranoia: never loop away on bad input
  }
  return out;
}

export interface RoasWindow {
  /** First day of the window, inclusive. */
  from: DayString;
  /** Last day of the window, inclusive — always yesterday. */
  to: DayString;
  /** Every day in the window, oldest first. */
  days: DayString[];
  /** How many days the window is meant to contain. */
  dayCount: number;
}

/**
 * The rolling window: the N FULL London days ending yesterday.
 *
 * Today is deliberately excluded. Today is half-finished — its orders are
 * still arriving and Meta has only reported part of the day's spend — so
 * including it would drag the figure down every morning and up every
 * evening, and the number would say more about the time of day than about
 * the advertising.
 */
export function rollingWindow(now: number | Date, dayCount = 7): RoasWindow {
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new Error(`dayCount must be a positive whole number, got ${dayCount}`);
  }
  const to = addDays(londonDayString(now), -1);
  const from = addDays(to, -(dayCount - 1));
  return { from, to, days: daysBetween(from, to), dayCount };
}

/** Yesterday in London, YYYY-MM-DD. */
export function yesterdayLondon(now: number | Date): DayString {
  return addDays(londonDayString(now), -1);
}

export type RoasResult =
  | {
      available: true;
      /** revenue ÷ spend, e.g. 3.33 */
      ratio: number;
      /** The same figure as a whole percentage, e.g. 333 */
      percent: number;
      revenue: number;
      spend: number;
    }
  | {
      available: false;
      /** Short, plain-English line to show under the "—". */
      reason: string;
    };

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * One day's ROAS.
 *
 * `spend` of null means "no figure recorded for that day" — not zero.
 * A recorded spend of exactly £0 is a real figure, but it still cannot be
 * divided by, so it also returns unavailable rather than Infinity.
 */
export function dayRoas(revenue: number | null | undefined, spend: number | null | undefined): RoasResult {
  const rev = finiteOrNull(revenue);
  const sp = finiteOrNull(spend);
  if (sp === null) return { available: false, reason: "No ad spend recorded for this day" };
  if (sp <= 0) return { available: false, reason: "No ad spend on this day — nothing to divide by" };
  if (rev === null) return { available: false, reason: "Waiting on the day's orders" };
  const ratio = rev / sp;
  return { available: true, ratio, percent: Math.round(ratio * 100), revenue: rev, spend: sp };
}

export interface WindowSpendDay {
  date: DayString;
  /** null when nothing has been recorded for that day. */
  amount: number | null;
}

/**
 * The window's ROAS: total new-customer revenue ÷ total ad spend.
 *
 * Graeme's rule, and it is the honest one: this is only shown when EVERY
 * day in the window has a spend figure. Summing five days of spend against
 * seven days of revenue and calling it a seven-day ROAS would flatter the
 * number by however much is missing, and nothing on screen would say so.
 * When days are missing it reports how many, so the wait is visible.
 */
export function windowRoas(input: {
  window: RoasWindow;
  /** Total new-customer revenue across the whole window. */
  revenue: number | null | undefined;
  /** Whatever spend rows we have. Days outside the window are ignored,
   *  duplicates keep the first, and days absent from the list count missing. */
  spendDays: WindowSpendDay[];
}): RoasResult {
  const { window: win, revenue, spendDays } = input;

  const byDate = new Map<DayString, number>();
  for (const row of spendDays) {
    const amount = finiteOrNull(row.amount);
    if (amount === null) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, amount);
  }

  const missing = win.days.filter((d) => !byDate.has(d));
  if (missing.length > 0) {
    return {
      available: false,
      reason: `Waiting on ${missing.length} day${missing.length === 1 ? "" : "s"} of spend`,
    };
  }

  const spend = win.days.reduce((sum, d) => sum + (byDate.get(d) ?? 0), 0);
  if (spend <= 0) {
    return { available: false, reason: `No ad spend in these ${win.dayCount} days — nothing to divide by` };
  }

  const rev = finiteOrNull(revenue);
  if (rev === null) return { available: false, reason: "Waiting on the window's orders" };

  const ratio = rev / spend;
  return { available: true, ratio, percent: Math.round(ratio * 100), revenue: rev, spend };
}
