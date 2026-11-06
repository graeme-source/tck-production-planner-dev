import { describe, expect, it } from "vitest";
import { netOperatingProfit } from "./qbo-profit-rules";

const money = (value: string) => ({ Summary: { ColData: [{ value: "Label" }, { value }] } });

describe("netOperatingProfit", () => {
  const report = { Rows: { Row: [
    { group: "Income", ...money("129000.00") },
    { group: "GrossProfit", ...money("80000.00") },
    { group: "Expenses", ...money("71000.00") },
    { group: "NetOperatingIncome", ...money("9000.55") },
    { group: "NetIncome", ...money("8500.00") },
  ] } };

  it("reads net operating income, not net income", () => {
    expect(netOperatingProfit(report)).toBe(9000.55);
  });

  it("reads a loss", () => {
    expect(netOperatingProfit({ Rows: { Row: [{ group: "NetOperatingIncome", ...money("-1200.00") }] } })).toBe(-1200);
  });

  it("finds it inside a nested section", () => {
    expect(netOperatingProfit({ Rows: { Row: [{ Rows: { Row: [{ group: "NetOperatingIncome", ...money("10") }] } }] } })).toBe(10);
  });

  it("gives nothing rather than guessing", () => {
    expect(netOperatingProfit({ Rows: { Row: [{ group: "NetIncome", ...money("8500.00") }] } })).toBeNull();
    expect(netOperatingProfit({ Rows: { Row: [{ group: "NetOperatingIncome", ...money("") }] } })).toBeNull();
    expect(netOperatingProfit({})).toBeNull();
  });
});
