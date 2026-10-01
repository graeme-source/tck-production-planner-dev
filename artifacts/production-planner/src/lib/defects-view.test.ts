import { describe, it, expect } from "vitest";
import { barWidth, dayText, defectHeadline, orderRefList, pctText, rangeText, stationText } from "./defects-view";

describe("defectHeadline", () => {
  it("reads as defects · % of packs made", () => {
    expect(defectHeadline({ defects: 14, packsMade: 1180, pct: 1.2 })).toBe("14 defects · 1.2% of 1,180 packs");
    expect(defectHeadline({ defects: 1, packsMade: 1, pct: 100 })).toBe("1 defect · 100.0% of 1 pack");
  });
  it("never shows 0% when nothing was made", () => {
    expect(defectHeadline({ defects: 8, packsMade: 0, pct: null })).toBe("8 defects · no packs made");
    expect(pctText(null)).toBe("—");
  });
});

describe("labels", () => {
  it("station keys become names; unknown text is shown as typed", () => {
    expect(stationText("wrapping", { wrapping: "Wrapping" })).toBe("Wrapping");
    expect(stationText("Despatch bench", {})).toBe("Despatch bench");
    expect(stationText(null, {})).toBe("Not recorded");
  });
  it("days and ranges", () => {
    expect(dayText("2026-09-30", "2026-10-01")).toMatch(/^Wed 30 Sept?$/); // ICU versions differ on "Sep" / "Sept"
    expect(dayText("2025-12-31", "2026-10-01")).toContain("2025");
    expect(rangeText("2026-10-01", "2026-10-01", "2026-10-01")).toBe("Thu 1 Oct");
  });
  it("order refs are split and given a #", () => {
    expect(orderRefList("#136117, 136112")).toEqual(["#136117", "#136112"]);
    expect(orderRefList(null)).toEqual([]);
  });
  it("bars", () => {
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(10, 10)).toBe(100);
    expect(barWidth(1, 1000)).toBe(4);
  });
});
