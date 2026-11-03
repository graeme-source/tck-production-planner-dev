import { describe, it, expect } from "vitest";
import { SHEET_ROWS_2026_11, sheetRowNote, sheetRowPosted, sheetRowDedupeHash } from "./backlog-reset-2026-11";

describe("3 Nov 2026 Outstanding Transactions sheet", () => {
  it("has every row from the sheet, with valid dates and amounts", () => {
    expect(SHEET_ROWS_2026_11).toHaveLength(53);
    for (const r of SHEET_ROWS_2026_11) {
      expect(r.date).toMatch(/^2026-(0[6-9]|1[0-2])-\d{2}$/);
      expect(r.value).toMatch(/^-?\d+\.\d{2}$/);
      expect(Number(r.value)).not.toBe(0);
    }
    const total = SHEET_ROWS_2026_11.reduce((s, r) => s + Math.round(Number(r.value) * 100), 0) / 100;
    expect(total).toBe(6025.15);
  });

  it("gives the sheet's exact twins their own lines", () => {
    const hashes = SHEET_ROWS_2026_11.map(sheetRowDedupeHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("keeps the sheet's status, category, emailed date and note together", () => {
    expect(sheetRowNote({ supplier: "Google Ads", ref: "3465", date: "2026-09-01", value: "185.44", teamMember: "Graeme", sheetStatus: "Emailed to accounts email address", emailedOn: "09/10/2026", note: "Not posted" }))
      .toBe("Emailed to accounts email address 09/10/2026 · Not posted");
    expect(sheetRowNote({ supplier: "Google Ads", ref: "3465", date: "2026-09-22", value: "500.00", teamMember: "Graeme", emailedOn: "09/10/2026", note: "Not posted" }))
      .toBe("Emailed 09/10/2026 · Not posted");
    expect(sheetRowNote({ supplier: "Railway", ref: "9275", date: "2026-07-02", value: "15.14", teamMember: "Graeme", category: "Dues and subs", note: "KC posted" }))
      .toBe("Dues and subs · KC posted");
    expect(sheetRowNote({ supplier: "Capcut", ref: "3465", date: "2026-10-15", value: "21.99", teamMember: "Graeme" })).toBeNull();
  });
});

describe("sheetRowPosted", () => {
  const row = (note?: string) => ({ supplier: "X", ref: "3465", date: "2026-09-01", value: "1.00", teamMember: "Graeme", note });
  it("reads the sheet's posted notes", () => {
    expect(sheetRowPosted(row("Posted as previous need invoice"))).toBe(true);
    expect(sheetRowPosted(row("KC posted to Dues & Subs - no VAT need invoice"))).toBe(true);
    expect(sheetRowPosted(row("Not posted"))).toBe(false);
    expect(sheetRowPosted(row())).toBe(false);
  });
  it("marks 20 of the 53 sheet rows as posted", () => {
    expect(SHEET_ROWS_2026_11.filter(sheetRowPosted)).toHaveLength(20);
  });
});
