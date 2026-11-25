import { describe, it, expect } from "vitest";
import { roomHoursCutoff, paidHoursUpTo, closeDownOutstanding, recipesStillToWrap } from "./shift-close-down";

const shift = (start: string, end: string, breaks: Array<{ isPaid: boolean; duration: number; amount: number; start?: string; end?: string }> = []) =>
  ({ salary: 0, start, end, breaks });

describe("roomHoursCutoff", () => {
  it("is undefined (whole shifts) with no now and no close-down", () => {
    expect(roomHoursCutoff(undefined, undefined)).toBeUndefined();
  });
  it("takes the close-down on a stored day", () => {
    expect(roomHoursCutoff(undefined, "2026-11-24T14:32:00")).toBe("2026-11-24T14:32:00");
  });
  it("takes now when there is no close-down", () => {
    expect(roomHoursCutoff("2026-11-24T11:00:00", undefined)).toBe("2026-11-24T11:00:00");
  });
  it("takes the earlier of the two", () => {
    expect(roomHoursCutoff("2026-11-24T16:00:00", "2026-11-24T14:32:00")).toBe("2026-11-24T14:32:00");
    expect(roomHoursCutoff("2026-11-24T13:00:00", "2026-11-24T14:32:00")).toBe("2026-11-24T13:00:00");
  });
});

describe("paidHoursUpTo", () => {
  const s = shift("2026-11-24T07:00:00", "2026-11-24T15:30:00", [
    { isPaid: false, duration: 0.5, amount: 0, start: "2026-11-24T12:00:00", end: "2026-11-24T12:30:00" },
  ]);
  it("no close-down: the whole shift less unpaid breaks", () => {
    expect(paidHoursUpTo(s, undefined)).toBe(8);
  });
  it("shift entirely before the close-down counts in full", () => {
    expect(paidHoursUpTo(s, "2026-11-24T16:00:00")).toBe(8);
  });
  it("shift straddling the close-down counts up to it, break already taken off", () => {
    expect(paidHoursUpTo(s, "2026-11-24T14:00:00")).toBe(6.5);
  });
  it("close-down before the break: the break isn't taken off", () => {
    expect(paidHoursUpTo(s, "2026-11-24T11:00:00")).toBe(4);
  });
  it("a break with no times (Planday payroll) is taken off pro rata", () => {
    const p = shift("2026-11-24T07:00:00", "2026-11-24T15:00:00", [{ isPaid: false, duration: 0.5, amount: 0 }]);
    expect(paidHoursUpTo(p, "2026-11-24T11:00:00")).toBe(3.75);
  });
  it("shift entirely after the close-down counts nothing", () => {
    const late = shift("2026-11-24T15:00:00", "2026-11-24T18:00:00");
    expect(paidHoursUpTo(late, "2026-11-24T14:32:00")).toBe(0);
  });
});

describe("closeDownOutstanding", () => {
  it("is empty when everything is done", () => {
    expect(closeDownOutstanding({ ordersToPack: 0, recipesToWrap: 0, missingChecks: [] })).toEqual([]);
  });
  it("lists what's left in plain words", () => {
    expect(closeDownOutstanding({
      ordersToPack: 3,
      recipesToWrap: 1,
      missingChecks: [
        { stationType: "wrapping", category: "closing" },
        { stationType: "wrapping", category: "closing" },
        { stationType: "packing", category: "opening" },
      ],
    })).toEqual([
      "3 orders still to pack",
      "1 recipe still to wrap",
      "Packing opening checklist: 1 item left",
      "Wrapping closing checklist: 2 items left",
    ]);
  });
  it("ignores other stations' checklists", () => {
    expect(closeDownOutstanding({ ordersToPack: 0, recipesToWrap: 0, missingChecks: [{ stationType: "ovens", category: "closing" }] })).toEqual([]);
  });
  it("blocks when the orders can't be read rather than assuming they're packed", () => {
    expect(closeDownOutstanding({ ordersToPack: null, recipesToWrap: 0, missingChecks: [] })).toHaveLength(1);
  });
});

describe("recipesStillToWrap", () => {
  it("counts recipes not marked wrapping complete", () => {
    expect(recipesStillToWrap([{ wrappingComplete: true }, { wrappingComplete: false }])).toBe(1);
    expect(recipesStillToWrap([])).toBe(0);
  });
});
