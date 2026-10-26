import { describe, it, expect } from "vitest";
import { capsForDate, type DptScheduleRow } from "./dpt-schedule-rules";

const r = (id: number, recipeId: number, startsOn: string, endsOn: string | null, extra = 2, endedAt: string | null = null): DptScheduleRow =>
  ({ id, recipeId, startsOn, endsOn, extraBatches: extra, reason: "leaving", endedAt });

describe("scheduled DPT rules by plan date", () => {
  const rows = [r(1, 26, "2026-11-02", null), r(2, 5, "2026-11-02", "2026-11-04", 1), r(3, 9, "2026-10-01", "2026-10-19", 2, "2026-10-20T10:00:00Z")];
  it("a Monday plan made the Thursday before follows Monday's rule", () => {
    expect(capsForDate(rows, "2026-11-02").get(26)?.extraBatches).toBe(2);
    expect(capsForDate(rows, "2026-10-30").has(26)).toBe(false);
  });
  it("end dates and 'ended early' are honoured", () => {
    expect(capsForDate(rows, "2026-11-04").has(5)).toBe(true);
    expect(capsForDate(rows, "2026-11-05").has(5)).toBe(false);
    expect(capsForDate(rows, "2026-11-02").has(9)).toBe(false);
    expect(capsForDate(rows, "2026-10-15").get(9)?.extraBatches).toBe(2); // a plan made while it ran
  });
  it("overlapping rules: the later start wins", () => {
    const m = capsForDate([r(1, 26, "2026-11-02", null, 2), r(4, 26, "2026-11-09", null, 0)], "2026-11-10");
    expect(m.get(26)?.extraBatches).toBe(0);
  });
});
