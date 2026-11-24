import { describe, expect, it } from "vitest";
import { attributeChecklistMisses, attendancePct, minutesLate, defaultPeriod, median, rateStat, shiftMonths, suggestions, REPORT_VERSION, type PerformanceReport } from "./index";

function base(): PerformanceReport {
  return {
    version: REPORT_VERSION,
    person: { userId: 1, name: "Sam", jobTitle: null, plandayLinked: true },
    period: { from: "2026-05-24", to: "2026-11-24", lastReviewDate: null },
    generatedAt: "2026-11-24T12:00:00Z",
    improvements: { completed: 0, credits: 0, teamAverage: null, shiftsKnown: true, monthly: [], list: [] },
    training: { stations: [], matrices: [] },
    lean: { weeksAssigned: 0, weeksCompleted: 0, completed: [], missed: [], selfPaced: 0 },
    speed: { building: null, wrapping: null, packing: null },
    attendance: { known: false, shiftsWorked: 0, sickDays: 0, sickInstances: 0, lates: 0, otherAbsence: 0, attendancePct: null, sickSpells: [], lateDates: [] },
    records: { disciplinary: [], attendanceOrTimekeeping: [], praise: [], returnToWorkForms: 0 },
    contributions: { factoryReports: 0, appReports: 0, sopsWritten: 0, todos: { assigned: 0, done: 0, onTime: 0, late: 0, open: 0 } },
  };
}

describe("small maths", () => {
  it("median, attendance %, months back", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(attendancePct(95, 5)).toBe(95);
    expect(attendancePct(0, 0)).toBeNull();
    expect(shiftMonths("2026-08-31", -6)).toBe("2026-02-28");
  });
  it("defaults to since the last review when within a year, else six months", () => {
    expect(defaultPeriod("2026-11-24", "2026-06-10")).toEqual({ from: "2026-06-10", to: "2026-11-24" });
    expect(defaultPeriod("2026-11-24", "2025-06-10")).toEqual({ from: "2026-05-24", to: "2026-11-24" });
    expect(defaultPeriod("2026-11-24", null).from).toBe("2026-05-24");
  });
});

describe("rateStat", () => {
  it("gives the whole-period rate, typical day and range; short days don't set a rate", () => {
    const s = rateStat({
      unit: "packs an hour", how: "x", teamOverall: 110, standard: 115, stretch: 135,
      days: [
        { date: "2026-11-02", amount: 240, minutes: 120 }, // 120/h
        { date: "2026-11-03", amount: 200, minutes: 120 }, // 100/h
        { date: "2026-11-04", amount: 10, minutes: 5 },    // too short to count
      ],
    })!;
    expect(s.overall).toBe(110);
    expect([s.min, s.max, s.median, s.days]).toEqual([100, 120, 110, 2]);
    expect(s.total).toBe(450);
  });
  it("with 5+ days the range is the usual 10th–90th percentile, so one odd day doesn't set it", () => {
    const days = [100, 102, 104, 106, 108, 110, 112, 114, 116, 290].map((r, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, amount: r, minutes: 60 }));
    const s = rateStat({ unit: "u", how: "x", days, teamOverall: null, standard: null, stretch: null })!;
    expect(s.max).toBeLessThan(140);
    expect(s.min).toBeGreaterThan(100);
  });
  it("is null with no work", () => {
    expect(rateStat({ unit: "u", how: "x", days: [], teamOverall: null, standard: null, stretch: null })).toBeNull();
  });
});

describe("suggestions", () => {
  it("flags missed Lean weeks and untrained SOPs where they work, as objectives", () => {
    const r = base();
    r.lean = { weeksAssigned: 10, weeksCompleted: 6, completed: [], missed: [{ weekStart: "2026-10-05", title: null }, { weekStart: "2026-10-12", title: null }, { weekStart: "2026-10-19", title: null }, { weekStart: "2026-10-26", title: null }], selfPaced: 0 };
    r.training.stations = [{ station: "wrapping", worksThere: true, sopCount: 5, trained: 3, refresher: 1, untrained: 1, missing: [] }];
    const s = suggestions(r);
    expect(s.find(x => x.area === "lean")?.tone).toBe("focus");
    expect(s.find(x => x.area === "training")?.headline).toContain("2 SOPs");
  });
  it("recognises strengths: above-standard speed and lots of improvements", () => {
    const r = base();
    r.improvements = { ...r.improvements, completed: 6, teamAverage: 2, scorePct: 105 };
    r.speed.wrapping = rateStat({ unit: "packs an hour", how: "x", teamOverall: 110, standard: 115, stretch: 135, days: [1, 2, 3].map(d => ({ date: `2026-11-0${d}`, amount: 260, minutes: 120 })) });
    const s = suggestions(r);
    expect(s.filter(x => x.tone === "strength").map(x => x.area).sort()).toEqual(["improvements", "speed"]);
  });
  it("flags checklist items left unticked on their station days, and credits a clean run", () => {
    const r = base();
    r.checklists = { known: true, stationDays: 20, missed: 3, missedDays: 2, ticked: 50, cantDo: 2, byStation: [], missedList: [] };
    expect(suggestions(r).find(x => x.area === "checklists")).toMatchObject({ tone: "focus", headline: expect.stringContaining("3 items on 2 days") });
    r.checklists = { ...r.checklists, missed: 0, missedDays: 0 };
    expect(suggestions(r).find(x => x.area === "checklists")?.tone).toBe("strength");
  });
  it("leads with the current 30-day score, not the whole period", () => {
    const r = base();
    r.improvements = { ...r.improvements, completed: 20, scorePct: 40, current: { from: "2026-10-26", to: "2026-11-24", scorePct: 105, credits: 21, improvements: 20, shifts: 20, teamAveragePct: 60 } };
    const s = suggestions(r).find(x => x.area === "improvements")!;
    expect(s.tone).toBe("strength");
    expect(s.headline).toContain("current score (last 30 days): 105%");
    expect(s.detail).toContain("Over the whole period: 40%");
  });
  it("judges improvements on the score when it's known", () => {
    const r = base();
    r.improvements = { ...r.improvements, completed: 2, credits: 2, scorePct: 5, teamScorePct: 20, teamAverage: 2 };
    expect(suggestions(r).find(x => x.area === "improvements")).toMatchObject({ tone: "focus", headline: "Improvement score over the period: 5% — the aim is 100%", detail: expect.stringContaining("one improvement every shift") });
    r.improvements = { ...r.improvements, scorePct: 110 };
    expect(suggestions(r).find(x => x.area === "improvements")?.tone).toBe("strength");
  });
  it("never says anything about disciplinary records being absent", () => {
    const s = suggestions(base());
    expect(JSON.stringify(s)).not.toMatch(/disciplinar/i);
  });
});

describe("attributeChecklistMisses", () => {
  const resolve = (s: string) => ({ building_2: "building_1", prep_meat: "prep" } as Record<string, string>)[s] ?? s;
  const templateStations = new Set(["building_1", "building_2", "prep", "wrapping"]);
  const missing = [
    { planDate: "2026-11-02", stationType: "building_1", title: "Clean iPad", category: "closing" },
    { planDate: "2026-11-02", stationType: "building_2", title: "B2 only item", category: "closing" },
    { planDate: "2026-11-02", stationType: "wrapping", title: "Wrap item", category: "opening" },
    { planDate: "2026-11-03", stationType: "prep", title: "Prep item", category: "opening" },
  ];
  it("counts only their stations' items on days they were on them", () => {
    const r = attributeChecklistMisses({
      known: true, from: "2026-11-01", to: "2026-11-30", templateStations, resolve, missing, ticked: 9, cantDo: 1,
      stationDays: new Map([["2026-11-02", new Set(["building_1"])], ["2026-11-03", new Set(["prep_meat"])]]),
    });
    // Building 1 builder: Building 1's item yes, Building 2's own item no, wrapping no; raw meat → prep checklist yes
    expect(r.missedList.map(m => m.title)).toEqual(["Prep item", "Clean iPad"]);
    expect([r.missed, r.missedDays, r.stationDays]).toEqual([2, 2, 2]);
  });
  it("a Building 2 builder also covers the shared Building 1 checklist", () => {
    const r = attributeChecklistMisses({
      known: true, from: "2026-11-01", to: "2026-11-30", templateStations, resolve, missing, ticked: 0, cantDo: 0,
      stationDays: new Map([["2026-11-02", new Set(["building_2"])]]),
    });
    expect(r.missedList.map(m => m.title).sort()).toEqual(["B2 only item", "Clean iPad"]);
    expect(r.stationDays).toBe(1);
  });
  it("isn't known without rostered station days", () => {
    expect(attributeChecklistMisses({ known: true, from: "2026-11-01", to: "2026-11-30", templateStations, resolve, missing, ticked: 0, cantDo: 0, stationDays: new Map() }).known).toBe(false);
  });
});

describe("minutesLate", () => {
  it("is clocked-in minus rostered start, never below zero", () => {
    expect(minutesLate({ startDateTime: "2026-11-02T07:04:00", shiftStartDateTime: "2026-11-02T07:00:00" })).toEqual({ minutes: 4, clockedIn: "07:04", rostered: "07:00" });
    expect(minutesLate({ startDateTime: "2026-11-02T06:55:00", shiftStartDateTime: "2026-11-02T07:00:00" }).minutes).toBe(0);
  });
  it("is unknown without a rostered start", () => {
    expect(minutesLate({ startDateTime: "2026-11-02T07:04:00", shiftStartDateTime: null })).toEqual({ minutes: null, clockedIn: "07:04", rostered: null });
  });
});
