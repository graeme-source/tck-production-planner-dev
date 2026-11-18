import { describe, it, expect } from "vitest";
import { defaultPnlMonths, flattenLines, monthRangeDates, monthsBetween, parsePnlByMonth, reportMonths, type QboPnlReport } from "./qbo-pnl-by-month";

// Shaped like the QuickBooks ProfitAndLoss report (summarize_column_by=Month),
// with real Apr–May 2026 figures from Graeme's expanded export.
const money = (...v: string[]) => v.map(value => ({ value }));
const report: QboPnlReport = {
  Header: { ReportBasis: "Accrual", Time: "2026-11-18T04:02:00-08:00" },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Account" },
      { ColTitle: "Apr 2026", ColType: "Money", MetaData: [{ Name: "StartDate", Value: "2026-04-01" }, { Name: "EndDate", Value: "2026-04-30" }] },
      { ColTitle: "May 2026", ColType: "Money", MetaData: [{ Name: "StartDate", Value: "2026-05-01" }, { Name: "EndDate", Value: "2026-05-31" }] },
      { ColTitle: "Total", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      {
        type: "Section", group: "Income",
        Header: { ColData: [{ value: "Income" }, ...money("", "", "")] },
        Rows: { Row: [
          { type: "Data", ColData: [{ value: "Discounts given", id: "86" }, ...money("-276.70", "-794.05", "-1070.75")] },
          {
            type: "Section",
            Header: { ColData: [{ value: "TCK Delivered", id: "100" }, ...money("", "", "")] },
            Rows: { Row: [
              { type: "Data", ColData: [{ value: "Wholesale", id: "120" }, ...money("2310.00", "3478.00", "5788.00")] },
            ] },
            Summary: { ColData: [{ value: "Total for TCK Delivered" }, ...money("2310.00", "3478.00", "5788.00")] },
          },
        ] },
        Summary: { ColData: [{ value: "Total Income" }, ...money("2033.30", "2683.95", "4717.25")] },
      },
      {
        type: "Section", group: "Expenses",
        Header: { ColData: [{ value: "Expenses" }, ...money("", "", "")] },
        Rows: { Row: [
          {
            type: "Section",
            // A parent account that also posts directly: its own amounts ride in the Header.
            Header: { ColData: [{ value: "Dues and Subscriptions", id: "40" }, ...money("2726.00", "2614.00", "5340.00")] },
            Rows: { Row: [
              { type: "Data", ColData: [{ value: "Shopify Apps & Subscriptions", id: "41" }, ...money("922.00", "1005.00", "1927.00")] },
            ] },
            Summary: { ColData: [{ value: "Total for Dues and Subscriptions" }, ...money("3648.00", "3619.00", "7267.00")] },
          },
          { type: "Data", ColData: [{ value: "Rent", id: "50" }, ...money("2725.00", "2725.00", "5450.00")] },
        ] },
        Summary: { ColData: [{ value: "Total Expenses" }, ...money("6373.00", "6344.00", "12717.00")] },
      },
      { type: "Section", group: "NetIncome", Summary: { ColData: [{ value: "Net Income" }, ...money("-4339.70", "-3660.05", "-7999.75")] } },
    ],
  },
};

describe("parsePnlByMonth", () => {
  const p = parsePnlByMonth(report);

  it("reads the month columns, leaving out Total", () => {
    expect(p.months).toEqual([{ key: "2026-04", label: "Apr 2026" }, { key: "2026-05", label: "May 2026" }]);
    expect(p.basis).toBe("Accrual");
  });

  it("keeps the top-level groups in order, sections carrying their totals", () => {
    expect(p.lines.map(l => [l.name, l.kind, l.group, l.amounts, l.total])).toEqual([
      ["Income", "section", "Income", [2033.3, 2683.95], 4717.25],
      ["Expenses", "section", "Expenses", [6373, 6344], 12717],
      ["Net Income", "total", "NetIncome", [-4339.7, -3660.05], -7999.75],
    ]);
  });

  it("nests sub-accounts and keeps account ids", () => {
    const income = p.lines[0]!;
    expect(income.children.map(c => [c.name, c.kind, c.depth, c.accountId])).toEqual([
      ["Discounts given", "account", 1, "86"],
      ["TCK Delivered", "section", 1, "100"],
    ]);
    expect(income.children[1]!.children[0]).toMatchObject({ name: "Wholesale", depth: 2, amounts: [2310, 3478], group: "Income" });
  });

  it("shows a parent account's own postings as its first child", () => {
    const dues = p.lines[1]!.children[0]!;
    expect(dues).toMatchObject({ name: "Dues and Subscriptions", kind: "section", amounts: [3648, 3619] });
    expect(dues.children.map(c => [c.name, c.amounts])).toEqual([
      ["Dues and Subscriptions", [2726, 2614]],
      ["Shopify Apps & Subscriptions", [922, 1005]],
    ]);
  });

  it("flattens depth-first", () => {
    expect(flattenLines(p.lines).map(l => l.name)).toEqual([
      "Income", "Discounts given", "TCK Delivered", "Wholesale",
      "Expenses", "Dues and Subscriptions", "Dues and Subscriptions", "Shopify Apps & Subscriptions", "Rent",
      "Net Income",
    ]);
  });

  it("falls back to the column title when a month has no StartDate", () => {
    expect(reportMonths({ Columns: { Column: [{ ColTitle: "" }, { ColTitle: "Oct 2026" }, { ColTitle: "Total" }] } }))
      .toEqual([{ key: "2026-10", label: "Oct 2026" }]);
  });

  it("copes with an empty report", () => {
    expect(parsePnlByMonth({})).toEqual({ months: [], lines: [], basis: null, generatedAt: null });
  });
});

describe("monthRangeDates", () => {
  it("runs from the 1st of the first month to the last day of the last", () => {
    expect(monthRangeDates("2026-01", "2026-02")).toEqual({ start: "2026-01-01", end: "2026-02-28" });
    expect(monthRangeDates("2025-11", "2026-10")).toEqual({ start: "2025-11-01", end: "2026-10-31" });
  });
});

describe("default months", () => {
  it("is January to the last complete month", () => {
    expect(defaultPnlMonths("2026-11-18")).toEqual({ fromMonth: "2026-01", toMonth: "2026-10" });
  });
  it("in January, shows the whole of last year", () => {
    expect(defaultPnlMonths("2027-01-05")).toEqual({ fromMonth: "2026-01", toMonth: "2026-12" });
  });
  it("counts months inclusively", () => {
    expect(monthsBetween("2026-01", "2026-10")).toBe(10);
    expect(monthsBetween("2025-11", "2026-02")).toBe(4);
    expect(monthsBetween("2026-03", "2026-02")).toBe(0);
  });
});
