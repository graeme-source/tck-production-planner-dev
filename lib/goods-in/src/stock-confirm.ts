/**
 * The "these go into stock" confirmation at goods-in (Graeme, 28 Oct 2026):
 * a delivery marked received at the ordered quantities without anyone
 * checking (Tuesday's 300 g of basil) puts stock in the books that isn't on
 * the shelf, and the next order is short. Before saving, the receiver sees
 * every item and what it adds to stock, and confirms it all arrived. Pure —
 * unit-tested.
 */
import { formatReportQty } from "./index";

export const STOCK_CONFIRM_TITLE = "Check what's going into stock";
export const STOCK_CONFIRM_WARNING = "Saving adds these quantities to stock. Check each one really arrived — if something is missing or short, go back and change it.";
export const STOCK_CONFIRM_BUTTON = "Yes, these all arrived — add to stock";

export interface StockConfirmInput {
  lineId: number;
  name: string;
  unit: string;
  nativeUnit?: string | null;
  packWeight?: number | null;
  stockInPacks?: boolean;
  quantityOrdered: number;
  /** What was saved as received before this save (0 on a first receive). */
  previousReceived: number;
  /** What this save records as received (0 for Not received). */
  newReceived: number;
}

export interface StockConfirmLine {
  lineId: number;
  name: string;
  /** "+300 g", "−50 g", or "Nothing" when this save adds nothing. */
  changeText: string;
  /** "300 g received of 300 g ordered" / "Not received — 300 g ordered". */
  detail: string;
  kind: "add" | "remove" | "none";
  /** Received less than ordered (but some). */
  short: boolean;
}

export function stockConfirmLines(lines: StockConfirmInput[]): StockConfirmLine[] {
  return lines.map(l => {
    const fmt = (q: number) => formatReportQty(q, l);
    const ordered = Number(l.quantityOrdered) || 0;
    const got = Number(l.newReceived) || 0;
    const change = Math.round((got - (Number(l.previousReceived) || 0)) * 10000) / 10000;
    const kind = change > 0 ? "add" : change < 0 ? "remove" : "none";
    return {
      lineId: l.lineId,
      name: l.name,
      changeText: kind === "add" ? `+${fmt(change)}` : kind === "remove" ? `−${fmt(-change)}` : "Nothing",
      detail: got > 0 ? `${fmt(got)} received of ${fmt(ordered)} ordered` : `Not received — ${fmt(ordered)} ordered`,
      kind,
      short: got > 0 && got < ordered,
    };
  });
}
