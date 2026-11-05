/**
 * How the Orders page talks about running ("expected") stock — Graeme,
 * 15 Oct 2026; docs/RUNNING_STOCK.md. The server (api lib/order-line-stock)
 * decides the figure; this only words it. Manager screens only: the
 * expected figure is never shown at a station or on a stock-check screen.
 */

export type StockBasis = "count" | "last-check" | "expected" | "not-counted";

export interface ExpectedStock {
  qty: number;
  basedOnCountQty: number;
  basedOnCountAt: string;
  receiptsSince: number;
  usageSince: number;
  coverage: "tracked" | "estimated" | "untracked";
  coverageLabel: string;
}

const num = (n: number) => String(Number(n.toFixed(2)));

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}

/** "Expected ~4.2 kg" (with "approx." when some usage is estimated). */
export function expectedStockHeadline(e: ExpectedStock, unit: string): string {
  return `Expected ~${num(e.qty)} ${unit}${e.coverage === "estimated" ? " (approx.)" : ""}`;
}

/** "last counted 12 Oct, + deliveries − usage" */
export function expectedStockBasisLine(e: ExpectedStock): string {
  return `last counted ${shortDate(e.basedOnCountAt)}, + deliveries − usage`;
}

/** Tooltip: the sum written out. */
export function expectedStockTooltip(e: ExpectedStock, unit: string): string {
  return [
    `Last counted ${num(e.basedOnCountQty)} ${unit} on ${shortDate(e.basedOnCountAt)}`,
    `+ ${num(e.receiptsSince)} ${unit} delivered since`,
    `− ${num(e.usageSince)} ${unit} used since`,
    `= ${num(e.qty)} ${unit} expected now (never below 0)`,
    e.coverageLabel,
    "Counted weekly, so the order uses this until the next count. Record a stock check to use that instead.",
  ].join("\n");
}

/** "expected 4.2" — shown quietly next to today's count. */
export function expectedAtCountLabel(expected: number): string {
  return `expected ${num(expected)}`;
}

const LONDON = "Europe/London";
const londonDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LONDON });

/** "Yesterday 14:05", or "Mon 2 Nov 14:05" further back. */
export function lastCheckWhen(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: LONDON });
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (londonDay(at) === londonDay(now)) return `Today ${time}`;
  if (londonDay(at) === londonDay(yesterday)) return `Yesterday ${time}`;
  return `${at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: LONDON })} ${time}`;
}

/** The value of the last real count, always on show on Orders (Graeme,
 *  5 Nov 2026): without it the expected figure can't be questioned. */
export function lastCheckValue(e: ExpectedStock, unit: string): string {
  return `${num(e.basedOnCountQty)} ${unit}`;
}

/** The stock an order uses from the last check (the server's sum, in
 *  chooseOrderStock): usage stays out, but what's been delivered since is
 *  really on the shelf and ordering it again would over-order. */
export function stockFromLastCheck(e: ExpectedStock): number {
  return Math.max(0, e.basedOnCountQty + e.receiptsSince);
}

/** "Ordering from 15.5 kg", only when a delivery makes that differ from the
 *  last check itself. */
export function orderingFromLabel(e: ExpectedStock, unit: string): string | null {
  return e.receiptsSince !== 0 ? `Ordering from ${num(stockFromLastCheck(e))} ${unit}` : null;
}

/** "+5 kg delivered since", when anything has been. */
export function deliveredSinceLabel(e: ExpectedStock, unit: string): string | null {
  return e.receiptsSince > 0 ? `+${num(e.receiptsSince)} ${unit} delivered since` : null;
}

interface StockBoxLine {
  stockCounted?: boolean;
  stockBasis?: StockBasis;
  stockDirty: boolean;
}

/** The stock box starts EMPTY when its figure isn't today's count — the last
 *  check, an expected figure or a never-counted kanban — so nobody saves it as
 *  one by tabbing through, and the blue button stays. Typing a number records
 *  a real count, as ever. */
export function stockBoxStartsBlank(line: StockBoxLine): boolean {
  if (line.stockDirty) return false;
  return line.stockCounted === false || line.stockBasis === "expected" || line.stockBasis === "last-check";
}

/** Kanban items nobody stock-checks get no "Record stock check" button on
 *  Orders — the kanban card drives the order (Graeme, 20 Oct 2026, #336:
 *  "No button at all. We don't need to stock check kanban items"). Kanban
 *  items that ARE stock-checked keep it. The same goes for a standing
 *  weekly order (#348): the day drives the order, not a count. */
export function showsStockCheckButton(line: { isKanban?: boolean; stockCounted?: boolean; standingOrder?: unknown }): boolean {
  return !((line.isKanban || !!line.standingOrder) && line.stockCounted !== true);
}

/** Leaving the box saves a count — except when nothing was typed into a
 *  box that started blank (that would record a made-up 0 or the expected
 *  figure as if someone had counted it). */
export function shouldSaveStockOnBlur(line: StockBoxLine): boolean {
  return line.stockDirty || !stockBoxStartsBlank(line);
}
