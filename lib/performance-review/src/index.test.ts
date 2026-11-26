import { describe, expect, it } from "vitest";
import { applyExclusions, roomSummary, forSavedCopy, rosteredStartFromHistory, minutesLateAgainst, noteAsText, itemKey, type ReportNote, attributeChecklistMisses, attendancePct, minutesLate, defaultPeriod, median, rateStat, shiftMonths, suggestions, REPORT_VERSION, type PerformanceReport } from "./index";

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

describe("applyExclusions", () => {
  it("takes unticked items out and redoes the figures", () => {
    const r = base();
    r.checklists = { known: true, stationDays: 10, missed: 2, missedDays: 2, ticked: 0, cantDo: 0,
      byStation: [{ station: "prep", days: 10, missed: 2 }],
      missedList: [{ date: "2026-11-03", station: "prep", title: "A", category: "opening" }, { date: "2026-11-02", station: "prep", title: "B", category: "opening" }] };
    r.attendance = { ...r.attendance, known: true, shiftsWorked: 18, sickDays: 2, sickInstances: 1, absentDays: 2, attendancePct: 90, lates: 2,
      lateDates: ["2026-11-04", "2026-11-05"], sickSpells: [{ start: "2026-11-10", end: "2026-11-11", days: 2 }] };
    r.lean = { weeksAssigned: 4, weeksCompleted: 2, completed: [], missed: [{ weekStart: "2026-11-02", title: null }, { weekStart: "2026-11-09", title: null }], selfPaced: 0 };
    r.training.stations = [{ station: "prep", worksThere: true, sopCount: 3, trained: 1, refresher: 1, untrained: 1, missing: [{ sopId: 7, title: "X", status: "untrained" }, { sopId: 8, title: "Y", status: "refresher" }] }];
    r.records.praise = [{ entryId: 5, date: "2026-11-01", title: "Thanks", detail: null }];
    const out = applyExclusions(r, { sections: ["contributions"], items: [
      itemKey.checklist(r.checklists.missedList[0]!), itemKey.late("2026-11-04"), itemKey.sick("2026-11-10"),
      itemKey.leanWeek("2026-11-02"), itemKey.sop("prep", 7), itemKey.record(5),
    ] });
    expect([out.checklists!.missed, out.checklists!.byStation[0]!.missed]).toEqual([1, 1]);
    expect([out.attendance.lates, out.attendance.sickInstances, out.attendance.sickDays, out.attendance.attendancePct]).toEqual([1, 0, 0, 100]);
    expect([out.lean.weeksAssigned, out.lean.missed.length]).toEqual([3, 1]);
    expect([out.training.stations[0]!.trained, out.training.stations[0]!.untrained, out.training.stations[0]!.missing.length]).toEqual([2, 0, 1]);
    expect(out.records.praise).toEqual([]);
    expect(out.hiddenSections).toEqual(["contributions"]);
    expect(r.attendance.lates).toBe(2); // the original is untouched
  });
  it("is the same report when nothing is unticked", () => {
    const r = base();
    expect(applyExclusions(r, { sections: [], items: [] })).toBe(r);
  });
});

describe("notes on the record", () => {
  const note = (id: number, o: Partial<ReportNote> = {}): ReportNote => ({
    id, entryId: 10, entryTitle: "1:1", entryDate: "2026-11-01", kind: "note", title: null, body: `note ${id}`,
    date: "2026-11-01", shared: true, sharedWithHr: false, author: "Graeme", dueDate: null, done: false, ...o,
  });
  const withNotes = (): PerformanceReport => ({
    ...base(),
    notes: {
      lastReview: { entryId: 5, date: "2026-10-29", title: "Appraisal" },
      fromLastReview: [note(1, { entryId: 5, kind: "objective" }), note(2, { entryId: 5, kind: "agreement", shared: false })],
      list: [note(3), note(4, { shared: false, sharedWithHr: true }), note(5, { entryId: 99 })],
    },
  });

  it("a saved copy never holds a private note, even one shared with HR", () => {
    const saved = forSavedCopy(withNotes(), null);
    expect(saved.notes!.fromLastReview.map(n => n.id)).toEqual([1]);
    expect(saved.notes!.list.map(n => n.id)).toEqual([3, 5]);
    expect(saved.notes!.list.every(n => n.shared && !n.sharedWithHr)).toBe(true);
  });

  it("a saved copy leaves out the attached meeting's notes (shown live instead)", () => {
    expect(forSavedCopy(withNotes(), 99).notes!.list.map(n => n.id)).toEqual([3]);
  });

  it("an older report without notes is unchanged", () => {
    const r = base();
    expect(forSavedCopy(r, null)).toBe(r);
  });

  it("unticked notes come out", () => {
    const out = applyExclusions(withNotes(), { sections: [], items: [itemKey.note(1), itemKey.note(3)] });
    expect(out.notes!.fromLastReview.map(n => n.id)).toEqual([2]);
    expect(out.notes!.list.map(n => n.id)).toEqual([4, 5]);
  });

  it("the whole notes card can be left out", () => {
    expect(applyExclusions(withNotes(), { sections: ["notes"], items: [] }).hiddenSections).toEqual(["notes"]);
  });

  it("a title that only repeats the kind isn't shown twice", () => {
    expect(noteAsText(note(8, { kind: "agreement", title: "What was agreed", body: "• Pay up" }))).toBe("What was agreed (1 Nov 2026 — 1:1)\n• Pay up");
  });

  it("reads as plain text for prep notes", () => {
    expect(noteAsText(note(7, { kind: "objective", title: "Faster wrapping", body: "Reach 120/hr " }))).toBe("Objective (1 Nov 2026 — 1:1): Faster wrapping\nReach 120/hr");
  });
});

describe("lateness against the rostered start", () => {
  // Planday's real wording (shifts checked on live, 24 Nov 2026).
  it("finds the rostered start that approval overwrote", () => {
    const h = [
      { modifiedAt: "2026-11-12T07:08:48Z", changes: ["Shift was approved.", "Start time changed from 07:00 to 07:05.", "End time changed from 15:00 to 15:05."] },
      { modifiedAt: "2026-09-24T14:54:13Z", changes: ["Created."] },
    ];
    expect(rosteredStartFromHistory(h, "2026-11-11T07:05", "07:05")).toBe("07:00");
    expect(minutesLateAgainst("07:05", "07:00")).toBe(5);
  });

  it("a start moved that morning BEFORE they clocked in is what they were due (19 Nov: 07:00 → 08:00 → 09:00, in at 08:49)", () => {
    const h = [
      { modifiedAt: "2026-11-23T08:26:00Z", changes: ["Shift was approved.", "End time changed from 16:00 to 16:17."] },
      { modifiedAt: "2026-11-19T07:29:16Z", changes: ["Start time changed from 08:00 to 09:00."] },
      { modifiedAt: "2026-11-19T06:30:51Z", changes: ["Start time changed from 07:00 to 08:00."] },
    ];
    const rostered = rosteredStartFromHistory(h, "2026-11-19T08:49", "09:00");
    expect(rostered).toBe("09:00");
    expect(minutesLateAgainst("08:49", rostered)).toBe(0);
  });

  it("takes the first change after punch-in when there are several", () => {
    const h = [
      { modifiedAt: "2026-11-11T16:00:00Z", changes: ["Start time changed from 07:10 to 07:20."] },
      { modifiedAt: "2026-11-11T08:00:00Z", changes: ["Start time changed from 07:00 to 07:10."] },
    ];
    expect(rosteredStartFromHistory(h, "2026-11-11T07:20", "07:20")).toBe("07:00");
  });

  it("works in summer time (punch-in is London time, history is UTC)", () => {
    // 07:05 BST = 06:05 UTC; approved at 06:30 UTC the same morning.
    const h = [{ modifiedAt: "2026-07-01T06:30:00Z", changes: ["Start time changed from 07:00 to 07:05."] }];
    expect(rosteredStartFromHistory(h, "2026-07-01T07:05", "07:05")).toBe("07:00");
    // A change at 05:50 UTC (06:50 BST) was before they clocked in — rota, not approval.
    const before = [{ modifiedAt: "2026-07-01T05:50:00Z", changes: ["Start time changed from 06:00 to 07:00."] }];
    expect(rosteredStartFromHistory(before, "2026-07-01T07:05", "07:00")).toBe("07:00");
  });

  it("no start change → the current start stands; early is never late", () => {
    expect(rosteredStartFromHistory([], "2026-11-11T07:00", "07:00")).toBe("07:00");
    expect(minutesLateAgainst("06:55", "07:00")).toBe(0);
    expect(minutesLateAgainst(null, "07:00")).toBeNull();
  });

  it("pads a one-digit hour", () => {
    expect(rosteredStartFromHistory([{ modifiedAt: "2026-11-11T09:00:00Z", changes: ["Start time changed from 7:00 to 7:12."] }], "2026-11-11T07:12", "07:12")).toBe("07:00");
  });
});

describe("packing & wrapping room score on their room days", () => {
  it("averages the days' room scores — 110% and 90% make 100%", () => {
    const s = roomSummary([{ date: "2026-11-02", scorePct: 110, estimate: false }, { date: "2026-11-03", scorePct: 90, estimate: false }]);
    expect(s).toMatchObject({ days: 2, averagePct: 100, estimates: 0, unscored: 0 });
  });
  it("leaves out days with no score, and counts estimates", () => {
    const s = roomSummary([{ date: "2026-11-04", scorePct: 95, estimate: true }, { date: "2026-11-05", scorePct: null, estimate: false }]);
    expect(s).toMatchObject({ days: 1, averagePct: 95, estimates: 1, unscored: 1 });
  });
  it("a day unticked comes off the average", () => {
    const r: PerformanceReport = { ...base(), room: roomSummary([{ date: "2026-11-02", scorePct: 110, estimate: false }, { date: "2026-11-03", scorePct: 70, estimate: false }]) };
    expect(applyExclusions(r, { sections: [], items: [itemKey.roomDay("2026-11-03")] }).room!.averagePct).toBe(110);
  });
});

import { parseSkipStations, workedStation } from "./index";
describe("stations worked (26 Nov 2026)", () => {
  it("shows a station's card only when they worked it; older copies always", () => {
    expect(workedStation({ stationsWorked: ["building_1", "ovens"] }, "wrapping")).toBe(false);
    expect(workedStation({ stationsWorked: ["wrapping"] }, "wrapping")).toBe(true);
    expect(workedStation({}, "wrapping")).toBe(true);
  });
  it("reads the skipped checklist stations", () => {
    expect([...parseSkipStations(" fried_chicken, ,ovens ")]).toEqual(["fried_chicken", "ovens"]);
    expect(parseSkipStations(null).size).toBe(0);
  });
});
