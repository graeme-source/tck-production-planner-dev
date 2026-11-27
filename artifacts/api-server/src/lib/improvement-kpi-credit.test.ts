import { describe, it, expect } from "vitest";
import {
  improvementCreditByDay, teamForShifts, parseImprovementMinutes, runRateCreditMinutes,
  roomCreditEarnedHours, roomCreditMinutesApplied, roomDayWithCredit, sumTeamCredit,
  DEFAULT_IMPROVEMENT_KPI_MINUTES, type CreditInputs, type CreditShift, type CreditedImprovement,
} from "./improvement-kpi-credit";
import { computeBatchesPerHour, aggregateBph, type StandardBreakConfig } from "./run-rate";
import { earnedHours, roomRatio, roomScore, calibrateStandardRatio, type RoomDay } from "./room-kpi";

const ROOM = ["Packer", "Wrapper"];
const PROD = 7; // Planday "Production" section id

// November is GMT: London = UTC.
const at = (hhmm: string, day = "2026-11-26") => new Date(`${day}T${hhmm}:00Z`);

const shift = (employeeId: number, positionName: string, date = "2026-11-26", extra: Partial<CreditShift> = {}): CreditShift => ({
  employeeId, date, positionName, positionSectionId: PROD, shiftTypeName: null, ...extra,
});
const done = (improvementId: number, userId: number, when = at("10:00"), extra: Partial<CreditedImprovement> = {}): CreditedImprovement => ({
  improvementId, userId, name: `User ${userId}`, progressStatus: "complete", doneAt: when, ...extra,
});

function inputs(over: Partial<CreditInputs>): CreditInputs {
  return {
    rows: [],
    plandayIdByUser: new Map([[1, 101], [2, 102], [3, 103], [4, null]]),
    shifts: [shift(101, "Packer"), shift(102, "Builder 1"), shift(103, "Office", "2026-11-26", { positionSectionId: 9 })],
    roomPositions: ROOM,
    productionSectionId: PROD,
    minutesPerImprovement: 10,
    shiftsKnown: true,
    from: "2026-11-26",
    to: "2026-11-26",
    ...over,
  };
}

describe("improvement credit — the minutes setting", () => {
  it("defaults to 10 and rejects nonsense", () => {
    expect(parseImprovementMinutes(null)).toBe(DEFAULT_IMPROVEMENT_KPI_MINUTES);
    expect(parseImprovementMinutes("")).toBe(10);
    expect(parseImprovementMinutes("15")).toBe(15);
    expect(parseImprovementMinutes("0")).toBe(0);
    expect(parseImprovementMinutes("-5")).toBe(10);
    expect(parseImprovementMinutes("abc")).toBe(10);
    expect(parseImprovementMinutes("500")).toBe(10);
  });
});

describe("improvement credit — which team, from the shift", () => {
  it("a Packer or Wrapper shift is the room (case-insensitive)", () => {
    expect(teamForShifts([shift(1, "packer")], ROOM, PROD)).toBe("room");
    expect(teamForShifts([shift(1, "Wrapper ")], ROOM, PROD)).toBe("room");
  });
  it("any other Production-section shift is the run rate", () => {
    expect(teamForShifts([shift(1, "Builder 1")], ROOM, PROD)).toBe("runRate");
  });
  it("room wins over another production shift the same day", () => {
    expect(teamForShifts([shift(1, "Builder 1"), shift(1, "Packer")], ROOM, PROD)).toBe("room");
  });
  it("outside Production, training/meeting/leave shifts, or no shift: nothing", () => {
    expect(teamForShifts([shift(1, "Office", "2026-11-26", { positionSectionId: 9 })], ROOM, PROD)).toBeNull();
    expect(teamForShifts([shift(1, "Packer", "2026-11-26", { shiftTypeName: "Training" })], ROOM, PROD)).toBeNull();
    expect(teamForShifts([shift(1, "Builder 1", "2026-11-26", { shiftTypeName: "Holiday" })], ROOM, PROD)).toBeNull();
    expect(teamForShifts([], ROOM, PROD)).toBeNull();
  });
  it("no production section known: only the room can be credited", () => {
    expect(teamForShifts([shift(1, "Builder 1")], ROOM, null)).toBeNull();
    expect(teamForShifts([shift(1, "Packer")], ROOM, null)).toBe("room");
  });
});

describe("improvement credit — counting", () => {
  it("counts done improvements (awaiting approval or complete) by the London day they were done", () => {
    const m = improvementCreditByDay(inputs({
      rows: [
        done(1, 1),
        done(2, 1, at("11:00"), { progressStatus: "awaiting_approval" }),
        done(3, 1, at("11:00"), { progressStatus: "submitted_for_review" }), // an idea
        done(4, 1, at("11:00"), { progressStatus: "rejected" }),             // sent back
        done(5, 1, at("11:00"), { doneAt: null }),                           // legacy, no day
        done(6, 1, at("10:00", "2026-11-25")),                               // another day
      ],
    }));
    const d = m.get("2026-11-26")!;
    expect(d.room.improvements).toBe(2);
    expect(d.room.minutes).toBe(20);
    expect(d.room.people).toEqual([{ userId: 1, name: "User 1", improvements: 2, minutes: 20 }]);
    expect(m.has("2026-11-25")).toBe(false); // outside the range asked for
  });
  it("buckets by the London day, not UTC (BST late evening)", () => {
    const m = improvementCreditByDay(inputs({
      rows: [done(1, 1, new Date("2026-07-14T23:30:00Z"))], // 00:30 on 15 Jul in London
      shifts: [shift(101, "Packer", "2026-07-15")],
      from: "2026-07-14", to: "2026-07-15",
    }));
    expect([...m.keys()]).toEqual(["2026-07-15"]);
  });
  it("credits each person: two people on one improvement = 20 minutes, one improvement", () => {
    const m = improvementCreditByDay(inputs({
      rows: [done(1, 1), done(1, 1), done(9, 1), { ...done(9, 2), name: "Bodan" }],
      shifts: [shift(101, "Packer"), shift(102, "Wrapper")],
    }));
    const d = m.get("2026-11-26")!;
    expect(d.room.improvements).toBe(2);
    expect(d.room.minutes).toBe(30); // pair (1,1) counted once
    expect(d.room.people.map(p => [p.name, p.improvements, p.minutes])).toEqual([["User 1", 2, 20], ["Bodan", 1, 10]]);
  });
  it("splits the team by each person's shift; everyone else is listed as not counted, with why", () => {
    const m = improvementCreditByDay(inputs({
      rows: [done(1, 1), done(2, 2), done(3, 3), done(4, 4), done(5, 5)],
      plandayIdByUser: new Map([[1, 101], [2, 102], [3, 103], [4, null], [5, 105]]),
    }));
    const d = m.get("2026-11-26")!;
    expect(d.room.people.map(p => p.userId)).toEqual([1]);
    expect(d.runRate.people.map(p => p.userId)).toEqual([2]);
    expect(d.runRate.minutes).toBe(10);
    expect(d.notCounted.map(p => [p.userId, p.reason])).toEqual([[3, "other-shift"], [4, "not-linked"], [5, "no-shift"]]);
  });
  it("when Planday can't be read, nothing is credited", () => {
    const m = improvementCreditByDay(inputs({ rows: [done(1, 1)], shiftsKnown: false }));
    const d = m.get("2026-11-26")!;
    expect(d.room.minutes + d.runRate.minutes).toBe(0);
    expect(d.notCounted[0]!.reason).toBe("planday-unavailable");
  });
  it("uses the minutes setting", () => {
    const m = improvementCreditByDay(inputs({ rows: [done(1, 2), done(2, 2)], minutesPerImprovement: 15 }));
    expect(m.get("2026-11-26")!.runRate.minutes).toBe(30);
  });
  it("adds a period up per person", () => {
    const a = improvementCreditByDay(inputs({ rows: [done(1, 1), done(2, 2)], shifts: [shift(101, "Packer"), shift(102, "Packer")] })).get("2026-11-26")!.room;
    const b = improvementCreditByDay(inputs({ rows: [done(3, 1, at("10:00", "2026-11-27"))], shifts: [shift(101, "Packer", "2026-11-27")], from: "2026-11-27", to: "2026-11-27" })).get("2026-11-27")!.room;
    const sum = sumTeamCredit([a, b]);
    expect(sum.improvements).toBe(3);
    expect(sum.minutes).toBe(30);
    expect(sum.people.map(p => [p.userId, p.improvements])).toEqual([[1, 2], [2, 1]]);
  });
});

const CONFIG: StandardBreakConfig = {
  morning: { anchorMinutes: 9 * 60 + 15, minutes: 15 },
  lunch: { anchorMinutes: 12 * 60 + 15, minutes: 35 },
  allowanceMinutes: 7,
  lunchGapMinutes: 40,
};
/** A batch every 6 minutes 10:00 → 12:00 (no breaks in the window). */
const twoHours = () => Array.from({ length: 21 }, (_, i) => new Date(at("10:00").getTime() + i * 6 * 60_000));

describe("improvement credit — TCK run rate", () => {
  it("never removes more than half the production time", () => {
    expect(runRateCreditMinutes(30, 300)).toBe(30);
    expect(runRateCreditMinutes(200, 300)).toBe(150);
    expect(runRateCreditMinutes(0, 300)).toBe(0);
    expect(runRateCreditMinutes(30, 0)).toBe(0);
  });
  it("takes the minutes off production time; batches unchanged", () => {
    const before = computeBatchesPerHour(twoHours(), CONFIG);
    const after = computeBatchesPerHour(twoHours(), CONFIG, { improvementMinutes: 20 });
    expect(before.batchesPerHour).toBe(10.5); // 21 in 120 min
    expect(after.batches).toBe(21);
    expect(after.activeMinutes).toBe(100);
    expect(after.improvementMinutesCredited).toBe(20);
    expect(after.batchesPerHour).toBe(12.6); // 21 in 100 min
    expect(after.batchesPerHourBeforeCredit).toBe(10.5);
    expect(after.activeMinutesBeforeCredit).toBe(120);
  });
  it("no credit passed = exactly the old number (the live station)", () => {
    const r = computeBatchesPerHour(twoHours(), CONFIG);
    expect(r.improvementMinutesCredited).toBe(0);
    expect(r.batchesPerHour).toBe(r.batchesPerHourBeforeCredit);
  });
  it("caps at half: a burst of improvements can at most double the rate", () => {
    const r = computeBatchesPerHour(twoHours(), CONFIG, { improvementMinutes: 600 });
    expect(r.improvementMinutesCredited).toBe(60);
    expect(r.batchesPerHour).toBe(21);
  });
  it("a period adds up with and without the credit", () => {
    const a = computeBatchesPerHour(twoHours(), CONFIG, { improvementMinutes: 20 });
    const b = computeBatchesPerHour(twoHours(), CONFIG);
    const agg = aggregateBph([a, b]);
    expect(agg.totalBatches).toBe(42);
    expect(agg.totalActiveMinutes).toBe(220);
    expect(agg.totalImprovementMinutesCredited).toBe(20);
    expect(agg.batchesPerHourBeforeCredit).toBe(10.5);
    expect(agg.batchesPerHour).toBeCloseTo(42 / (220 / 60), 1);
  });
});

const W = { packingPerHour: 55, wrappingPerHour: 115, deliveryMinutes: 10, lineMinutes: 2 };
const typical: RoomDay = { date: "2026-11-12", boxes: 98, packs: 495, deliveries: 5, deliveryLines: 19, paidHours: 16.4, people: 2 };

describe("improvement credit — packing & wrapping room", () => {
  const standard = roomRatio(typical, W)!; // ~0.46: the measured jobs are part of the day

  it("is worth the minutes at the 100% line, capped at half the paid hours", () => {
    expect(roomCreditEarnedHours(60, 16, 0.5)).toBeCloseTo(0.5, 5);
    expect(roomCreditEarnedHours(60 * 20, 16, 0.5)).toBeCloseTo(8 * 0.5, 5);
    expect(roomCreditMinutesApplied(60 * 20, 16)).toBe(480);
    expect(roomCreditEarnedHours(60, 16, null)).toBe(0); // no 100% line yet
    expect(roomCreditEarnedHours(60, 0, 0.5)).toBe(0);
  });
  it("adds an improvements line to the earned hours", () => {
    const e = earnedHours({ ...typical, improvementHours: 0.25 }, W);
    expect(e.improvementHours).toBe(0.25);
    expect(e.earnedHours).toBeCloseTo(earnedHours(typical, W).earnedHours + 0.25, 5);
    expect(earnedHours(typical, W).improvementHours).toBe(0);
  });
  it("improvement time scores exactly 100%: a day at standard that gave an hour to improvements still scores 100", () => {
    // The same day, but one paid hour went on improvements instead of work.
    const workHours = typical.paidHours - 1;
    const atStandard = { ...typical, boxes: 0, packs: 0, deliveries: 0, deliveryLines: 0 };
    // Earned from work = the standard ratio × the hours actually worked.
    const workEarned = standard * workHours;
    const dayNoCredit = { ...atStandard, packs: workEarned * W.wrappingPerHour };
    expect(roomScore(roomRatio(dayNoCredit, W), standard)).toBeLessThan(100);
    const credit = { improvements: 6, minutes: 60, people: [], events: [] };
    const withCredit = roomDayWithCredit(dayNoCredit, credit, standard);
    expect(roomScore(roomRatio(withCredit, W), standard)).toBe(100);
    expect(withCredit.improvementCredit).toEqual({ improvements: 6, minutes: 60, minutesApplied: 60, people: [] });
  });
  it("the 100% line ignores improvement credit, so it can't drift", () => {
    const days = [10, 11, 12, 13, 14].map(h => ({ ...typical, paidHours: h }));
    const credited = days.map(d => ({ ...d, improvementHours: 2 }));
    expect(calibrateStandardRatio(credited, W)).toBe(calibrateStandardRatio(days, W));
  });
});
