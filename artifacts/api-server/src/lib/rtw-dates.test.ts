import { describe, it, expect } from "vitest";
import { checkAbsenceDates } from "./rtw-dates";

const TODAY = "2026-09-25";

describe("checkAbsenceDates", () => {
  it("accepts a past single day or range, and today", () => {
    expect(checkAbsenceDates("2026-09-14", null, TODAY)).toBeNull();
    expect(checkAbsenceDates("2026-09-14", "2026-09-16", TODAY)).toBeNull();
    expect(checkAbsenceDates("2026-09-25", "2026-09-25", TODAY)).toBeNull();
  });

  it("refuses an end before the start", () => {
    expect(checkAbsenceDates("2026-09-16", "2026-09-14", TODAY)).toMatch(/before the first/);
  });

  it("refuses the future", () => {
    expect(checkAbsenceDates("2026-09-26", null, TODAY)).toMatch(/future/);
    expect(checkAbsenceDates("2026-09-20", "2026-09-30", TODAY)).toMatch(/future/);
  });

  it("refuses dates that don't exist", () => {
    expect(checkAbsenceDates("2026-02-30", null, TODAY)).toMatch(/real date/);
    expect(checkAbsenceDates("2026-09-01", "2026-13-01", TODAY)).toMatch(/real date/);
  });
});
