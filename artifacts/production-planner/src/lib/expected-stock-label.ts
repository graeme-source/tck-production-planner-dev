/**
 * How the Orders page talks about running ("expected") stock — Graeme,
 * 15 Oct 2026; docs/RUNNING_STOCK.md. The server (api lib/order-line-stock)
 * decides the figure; this only words it. Manager screens only: the
 * expected figure is never shown at a station or on a stock-check screen.
 */

export type StockBasis = "count" | "expected" | "not-counted";

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
    "No count today, so the order uses this. Type a count to use the real figure instead.",
  ].join("\n");
}

/** "expected 4.2" — shown quietly next to today's count. */
export function expectedAtCountLabel(expected: number): string {
  return `expected ${num(expected)}`;
}

interface StockBoxLine {
  stockCounted?: boolean;
  stockBasis?: StockBasis;
  stockDirty: boolean;
}

/** The stock box starts EMPTY when its figure isn't a count — an expected
 *  figure or a never-counted kanban — so nobody saves it as one by tabbing
 *  through. Typing a number records a real count, as ever. */
export function stockBoxStartsBlank(line: StockBoxLine): boolean {
  if (line.stockDirty) return false;
  return line.stockCounted === false || line.stockBasis === "expected";
}

/** Kanban items nobody stock-checks get no "Record stock check" button on
 *  Orders — the kanban card drives the order (Graeme, 20 Oct 2026, #336:
 *  "No button at all. We don't need to stock check kanban items"). Kanban
 *  items that ARE stock-checked keep it. */
export function showsStockCheckButton(line: { isKanban?: boolean; stockCounted?: boolean }): boolean {
  return !(line.isKanban && line.stockCounted !== true);
}

/** Leaving the box saves a count — except when nothing was typed into a
 *  box that started blank (that would record a made-up 0 or the expected
 *  figure as if someone had counted it). */
export function shouldSaveStockOnBlur(line: StockBoxLine): boolean {
  return line.stockDirty || !stockBoxStartsBlank(line);
}
