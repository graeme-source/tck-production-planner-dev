/**
 * Loads a month's revenue sent out (rules: sent-out-revenue.ts) from the
 * Shopify orders mirror plus the app's and APC's dispatch records — the
 * same loader as the month-end deferred income (payroll/month-end-load.ts).
 * READ-ONLY towards Shopify. Objective I.
 */
import { LOOKBACK_DAYS, monthEndCutoff } from "./payroll/month-end";
import { loadDispatchOrders, type LoadOptions } from "./payroll/month-end-load";
import { londonDateString, londonDayStartUtc } from "./london-time";
import { sentOutRevenue, type SentOutRevenue } from "./sent-out-revenue";

/** Orders paid up to LOOKBACK_DAYS before the month starts are looked at —
 *  orders are placed days to weeks ahead of their delivery date. */
export async function loadSentOutRevenue(month: string, opts: LoadOptions = {}, today = londonDateString()): Promise<SentOutRevenue> {
  const start = londonDayStartUtc(`${month}-01`);
  const fromUtc = new Date(start.getTime() - LOOKBACK_DAYS * 86_400_000);
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  const { rows, orders, warnings } = await loadDispatchOrders(fromUtc, monthEndCutoff(monthEnd), opts);
  const result = sentOutRevenue(month, rows.map((r, i) => ({
    payload: r.payload,
    appFulfilledAt: orders[i]?.appFulfilledAt ?? null,
    apcCollectionDate: orders[i]?.apcCollectionDate ?? null,
  })), today);
  result.warnings.push(...warnings);
  return result;
}
