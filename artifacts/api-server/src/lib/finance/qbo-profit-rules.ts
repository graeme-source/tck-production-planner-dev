// Net operating profit off a QuickBooks Profit and Loss report (Graeme, 6 Nov
// 2026). Pure, tested; the fetch is in qbo-profit.ts.

interface ReportRow {
  group?: string;
  Summary?: { ColData?: Array<{ value?: string }> };
  Rows?: { Row?: ReportRow[] };
}
export interface ProfitAndLossReport { Rows?: { Row?: ReportRow[] } }

function findGroup(rows: ReportRow[] | undefined, group: string): ReportRow | null {
  for (const row of rows ?? []) {
    if (row.group === group) return row;
    const inner = findGroup(row.Rows?.Row, group);
    if (inner) return inner;
  }
  return null;
}

/** The report's Net Operating Income line. Null when the report has no such
 *  line, so the figure is left for typing rather than guessed from another. */
export function netOperatingProfit(report: ProfitAndLossReport): number | null {
  const cols = findGroup(report.Rows?.Row, "NetOperatingIncome")?.Summary?.ColData;
  const value = cols?.[cols.length - 1]?.value;
  const n = value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}
