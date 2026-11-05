/**
 * Reading the saved revenue targets (default minimum in app_settings, per-month
 * stretch in revenue_targets, per-month minimum in revenue_month_minimums —
 * migrations 0149 and 0359). One reader, used by the
 * targets API and the Sales & Marketing pulse, so they can't disagree.
 */
import { pool } from "@workspace/db";
import { MINIMUM_SETTING_KEY, minimumFromSetting, type TargetsState } from "@workspace/revenue-targets";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };

export async function loadRevenueTargetsState(q: Queryable = pool): Promise<TargetsState> {
  const min = await q.query(`SELECT value FROM app_settings WHERE key = $1`, [MINIMUM_SETTING_KEY]);
  const rows = await q.query(`SELECT month, stretch_target::float8 AS stretch FROM revenue_targets ORDER BY month`);
  const minimums = await q.query(`SELECT month, minimum_target::float8 AS minimum FROM revenue_month_minimums ORDER BY month`);
  return {
    minimum: minimumFromSetting(min.rows[0]?.value ?? null),
    minimums: minimums.rows.map((r: { month: string; minimum: number }) => ({ month: r.month, minimum: Number(r.minimum) })),
    rows: rows.rows.map((r: { month: string; stretch: number }) => ({ month: r.month, stretch: Number(r.stretch) })),
  };
}
