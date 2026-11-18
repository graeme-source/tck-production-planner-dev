// Read QuickBooks' Profit and Loss by Month for the founder P&L page, read
// only (Objective I). Accrual basis, months as columns — the same settings as
// Graeme's custom "Profit and Loss by Month" report. Held for half an hour per
// range: it's a slow call, and the books for past months rarely move. The
// page's Refresh asks again.
import { qboReport } from "./qbo";
import { monthRangeDates, parsePnlByMonth, type PnlByMonth, type QboPnlReport } from "./qbo-pnl-by-month";

const KEEP_MS = 30 * 60 * 1000;
const WAIT_MS = 25_000;
const held = new Map<string, { value: PnlByMonth; at: number }>();

export async function loadPnlByMonth(fromMonth: string, toMonth: string, opts: { fresh?: boolean } = {}): Promise<PnlByMonth & { fetchedAt: string }> {
  const key = `${fromMonth}..${toMonth}`;
  const hit = held.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < KEEP_MS) return { ...hit.value, fetchedAt: new Date(hit.at).toISOString() };
  const { start, end } = monthRangeDates(fromMonth, toMonth);
  const report = await Promise.race([
    qboReport<QboPnlReport>("ProfitAndLoss", {
      start_date: start,
      end_date: end,
      summarize_column_by: "Month",
      accounting_method: "Accrual",
    }),
    new Promise<never>((_, fail) => { setTimeout(() => fail(new Error("QuickBooks took too long — try Refresh")), WAIT_MS).unref(); }),
  ]);
  const value = parsePnlByMonth(report);
  const at = Date.now();
  held.set(key, { value, at });
  return { ...value, fetchedAt: new Date(at).toISOString() };
}
