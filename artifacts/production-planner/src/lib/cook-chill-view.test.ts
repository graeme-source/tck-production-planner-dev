import { describe, it, expect } from "vitest";
import { recordsForStation, cookMet, minutesText, clockText, type CookChillRecordView } from "./cook-chill-view";

function rec(id: number, stage: CookChillRecordView["stage"], cookedAt: string): CookChillRecordView {
  return {
    id, subRecipeId: 1, subRecipeName: `R${id}`, cookTempC: 75, cookHeldForSeconds: 30,
    cookedByName: "Jane", cookedAt, chillStartAt: stage === "cooked" ? null : cookedAt,
    chillStartByName: null, chillEndAt: stage === "chilled" ? cookedAt : null, chillEndByName: null,
    chilledVia: null, stage,
  };
}

describe("recordsForStation", () => {
  const all = [
    rec(1, "chilled", "2026-10-22T08:00:00Z"),
    rec(2, "cooked", "2026-10-22T09:00:00Z"),
    rec(3, "chilling", "2026-10-22T10:00:00Z"),
    rec(4, "chilling", "2026-10-22T07:00:00Z"),
  ];
  it("prep sees everything, chilling first, then cooked, then done", () => {
    expect(recordsForStation(all, "prep").map(r => r.id)).toEqual([4, 3, 2, 1]);
  });
  it("wrapping never sees a batch that hasn't gone into the chiller", () => {
    expect(recordsForStation(all, "wrapping").map(r => r.id)).toEqual([4, 3, 1]);
  });
});

describe("cookMet uses the FSA table, not a fixed 75°C", () => {
  it("70°C held 2 minutes passes; 74°C for 10 seconds doesn't", () => {
    expect(cookMet({ cookTempC: 70, cookHeldForSeconds: 120 })).toBe(true);
    expect(cookMet({ cookTempC: 74, cookHeldForSeconds: 10 })).toBe(false);
    expect(cookMet({ cookTempC: 58, cookHeldForSeconds: 9999 })).toBe(false);
  });
});

describe("minutesText / clockText", () => {
  it("reads minutes and hours", () => {
    expect(minutesText("2026-10-22T10:00:00Z", "2026-10-22T10:45:00Z")).toBe("45 min");
    expect(minutesText("2026-10-22T10:00:00Z", "2026-10-22T11:20:00Z")).toBe("1 h 20 min");
    expect(minutesText("2026-10-22T10:00:00Z", "2026-10-22T12:00:00Z")).toBe("2 h");
    expect(minutesText("2026-10-22T10:00:00Z", "2026-10-22T09:00:00Z")).toBe("0 min");
  });
  it("shows London time", () => {
    expect(clockText("2026-10-22T13:05:00Z")).toBe("14:05");
  });
});
