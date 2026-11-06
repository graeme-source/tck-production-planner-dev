// A finished month's net operating profit from the QuickBooks Profit and Loss
// report, read only. Uses the company's own accounting method, so it matches
// the report he sees in QuickBooks. Held for half an hour: it's a slow call and
// the bonus page asks for several months.
import { qboReport } from "./qbo";
import { netOperatingProfit, type ProfitAndLossReport } from "./qbo-profit-rules";
import { monthDays } from "../bonus-month-revenue";

const KEEP_MS = 30 * 60 * 1000;
const WAIT_MS = 8000;
const held = new Map<string, { value: number | null; at: number }>();

export async function qboProfitForMonth(month: string, today: string): Promise<number | null> {
  const hit = held.get(month);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const { from, to } = monthDays(month, today);
  const report = await Promise.race([
    qboReport<ProfitAndLossReport>("ProfitAndLoss", { start_date: from, end_date: to }),
    new Promise<never>((_, fail) => { setTimeout(() => fail(new Error("QuickBooks took too long")), WAIT_MS).unref(); }),
  ]);
  const value = netOperatingProfit(report);
  held.set(month, { value, at: Date.now() });
  return value;
}
