/**
 * QuickBooks "Profit and Loss by Month" — turning the ProfitAndLoss report
 * (summarize_column_by=Month) into rows the founder P&L page can draw
 * (Graeme, 18 Nov 2026; Objective I, finance & reporting). Pure; the fetch
 * is in qbo-pnl-by-month-load.ts.
 *
 * His custom report in QuickBooks is the standard Profit and Loss with
 * months as columns, accrual basis. Custom reports can't be read through
 * the API, so we ask for the standard report with the same settings — the
 * figures are the same.
 *
 * Report shape (QuickBooks Reports API): Columns.Column[0] is the account
 * column, then one Money column per month, then "Total". Rows nest:
 * a Section has a Header (its name, plus the parent account's OWN amounts
 * when it has sub-accounts), Rows, and a Summary ("Total for …"). Data rows
 * are single accounts. Top-level sections carry a `group` (Income,
 * COGS, GrossProfit, Expenses, NetOperatingIncome, OtherIncome,
 * OtherExpenses, NetOtherIncome, NetIncome).
 */

interface ColData { value?: string; id?: string }
export interface QboReportRow {
  type?: string;
  group?: string;
  ColData?: ColData[];
  Header?: { ColData?: ColData[] };
  Rows?: { Row?: QboReportRow[] };
  Summary?: { ColData?: ColData[] };
}
export interface QboPnlReport {
  Header?: { StartPeriod?: string; EndPeriod?: string; ReportBasis?: string; Time?: string };
  Columns?: { Column?: Array<{ ColTitle?: string; ColType?: string; MetaData?: Array<{ Name?: string; Value?: string }> }> };
  Rows?: { Row?: QboReportRow[] };
}

export interface PnlMonth {
  key: string;   // "2026-10"
  label: string; // "Oct 2026"
}

export interface PnlLine {
  /** Stable within a report: the path of names, e.g. "Expenses/Dues and Subscriptions". */
  key: string;
  name: string;
  /** QuickBooks account id, when the line is an account. */
  accountId: string | null;
  depth: number;
  /** "section" lines have children; "account" lines don't; "total" is a
   *  bold summary line (Gross Profit, Net Income…). */
  kind: "section" | "account" | "total";
  /** The top-level group this line sits under (Income, COGS, Expenses…). */
  group: string | null;
  /** One amount per month, then the range total. Section lines carry their
   *  TOTAL (the "Total for …" line), so a collapsed section still adds up. */
  amounts: number[];
  total: number;
  /** Sub-lines. When a parent account also posts directly, those own
   *  amounts come first, under the parent's name. */
  children: PnlLine[];
}

export interface PnlByMonth {
  months: PnlMonth[];
  lines: PnlLine[];
  basis: string | null;
  generatedAt: string | null;
}

function num(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function amountsOf(cols: ColData[] | undefined, monthCount: number): { amounts: number[]; total: number } {
  const vals = (cols ?? []).slice(1).map(c => num(c.value));
  const amounts = Array.from({ length: monthCount }, (_, i) => vals[i] ?? 0);
  const total = vals.length > monthCount ? (vals[monthCount] ?? 0) : amounts.reduce((s, n) => s + n, 0);
  return { amounts, total };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The month columns, keyed from their StartDate (falling back to the title). */
export function reportMonths(report: QboPnlReport): PnlMonth[] {
  const cols = (report.Columns?.Column ?? []).slice(1);
  const out: PnlMonth[] = [];
  for (const c of cols) {
    if ((c.ColTitle ?? "").trim().toLowerCase() === "total") continue;
    const start = c.MetaData?.find(m => m.Name === "StartDate")?.Value;
    let key: string | null = start ? start.slice(0, 7) : null;
    if (!key) {
      const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec((c.ColTitle ?? "").trim());
      const idx = m ? MONTHS.indexOf(m[1]!.slice(0, 3)) : -1;
      if (m && idx >= 0) key = `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
    }
    if (!key) continue;
    const [y, mo] = key.split("-").map(Number);
    out.push({ key, label: `${MONTHS[mo! - 1]} ${y}` });
  }
  return out;
}

function parseRows(rows: QboReportRow[] | undefined, depth: number, parentKey: string, group: string | null, monthCount: number): PnlLine[] {
  const out: PnlLine[] = [];
  for (const row of rows ?? []) {
    const isSection = row.type === "Section" || !!row.Rows || !!row.Header || !!row.Summary;
    if (!isSection) {
      const cols = row.ColData;
      const name = (cols?.[0]?.value ?? "").trim();
      if (!name) continue;
      const { amounts, total } = amountsOf(cols, monthCount);
      out.push({
        key: `${parentKey}/${name}`, name, accountId: cols?.[0]?.id ?? null, depth, kind: "account",
        group, amounts, total, children: [],
      });
      continue;
    }

    const g = depth === 0 ? (row.group ?? null) : group;
    const headerCols = row.Header?.ColData;
    const headerName = (headerCols?.[0]?.value ?? "").trim();
    const summaryCols = row.Summary?.ColData;
    const summaryName = (summaryCols?.[0]?.value ?? "").trim();

    // A top-level line with only a Summary is a computed total (Gross
    // Profit, Net Operating Income, Net Income…).
    if (!row.Header && !row.Rows && row.Summary) {
      const { amounts, total } = amountsOf(summaryCols, monthCount);
      out.push({ key: `${parentKey}/${summaryName}`, name: summaryName, accountId: null, depth, kind: "total", group: g, amounts, total, children: [] });
      continue;
    }

    const name = headerName || summaryName.replace(/^Total (for )?/i, "") || (row.group ?? "");
    const key = `${parentKey}/${name}`;
    const children = parseRows(row.Rows?.Row, depth + 1, key, g, monthCount);

    // The parent account's own postings sit in the Header's money columns.
    if (headerCols && headerCols.slice(1).some(c => num(c.value) !== 0)) {
      const own = amountsOf(headerCols, monthCount);
      children.unshift({
        key: `${key}/(own)`, name, accountId: headerCols[0]?.id ?? null, depth: depth + 1, kind: "account",
        group: g, amounts: own.amounts, total: own.total, children: [],
      });
    }

    const sum = summaryCols
      ? amountsOf(summaryCols, monthCount)
      : {
          amounts: Array.from({ length: monthCount }, (_, i) => children.reduce((s, c) => s + (c.amounts[i] ?? 0), 0)),
          total: children.reduce((s, c) => s + c.total, 0),
        };
    out.push({
      key, name, accountId: headerCols?.[0]?.id ?? null, depth, kind: "section", group: g,
      amounts: sum.amounts, total: sum.total, children,
    });
  }
  return out;
}

/** The whole report as nested lines, months as columns. */
export function parsePnlByMonth(report: QboPnlReport): PnlByMonth {
  const months = reportMonths(report);
  return {
    months,
    lines: parseRows(report.Rows?.Row, 0, "", null, months.length),
    basis: report.Header?.ReportBasis ?? null,
    generatedAt: report.Header?.Time ?? null,
  };
}

/** Every line, flattened depth-first — for searching and for later mapping. */
export function flattenLines(lines: readonly PnlLine[]): PnlLine[] {
  const out: PnlLine[] = [];
  const walk = (ls: readonly PnlLine[]) => { for (const l of ls) { out.push(l); walk(l.children); } };
  walk(lines);
  return out;
}

/** Whole months from fromMonth to toMonth (YYYY-MM) as report dates. */
export function monthRangeDates(fromMonth: string, toMonth: string): { start: string; end: string } {
  const [y, m] = toMonth.split("-").map(Number);
  const end = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  return { start: `${fromMonth}-01`, end };
}

/** The default view: January of the last complete month's year through
 *  that month — Jan–Oct on 18 Nov, as his report is usually run. */
export function defaultPnlMonths(today: string): { fromMonth: string; toMonth: string } {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  return { fromMonth: `${last.slice(0, 4)}-01`, toMonth: last };
}

/** Months from a to b inclusive (YYYY-MM). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number) as [number, number];
  const [by, bm] = b.split("-").map(Number) as [number, number];
  return (by - ay) * 12 + (bm - am) + 1;
}
