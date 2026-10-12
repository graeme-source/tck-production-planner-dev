import { describe, expect, it } from "vitest";
import {
  buildScores, creditsByUser, improvementScorePct, normaliseCreditWeight, rankByScore,
  scoreWindow, shiftsWorkedByEmployee, type CreditPair, type RotaShift,
} from "./improvement-score";

const W = scoreWindow("2026-10-12");

/** n worked shifts for an employee on consecutive days ending on `last`. */
function worked(employeeId: number, n: number, last = "2026-10-12"): RotaShift[] {
  const out: RotaShift[] = [];
  const d = new Date(`${last}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push({ employeeId, date: d.toISOString().slice(0, 10), status: "PunchclockFinished", shiftTypeName: "Normal" });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

function credits(userId: number, n: number, weight = 1, doneDate = "2026-10-10", startId = userId * 1000): CreditPair[] {
  return Array.from({ length: n }, (_, i) => ({ improvementId: startId + i, userId, weight, doneDate }));
}

describe("score window", () => {
  it("is the last 30 London days, today included", () => {
    expect(W).toEqual({ from: "2026-09-13", to: "2026-10-12" });
  });
});

describe("improvement score maths", () => {
  it("one improvement per shift is 100%", () => {
    expect(improvementScorePct(10, 10)).toBe(100);
  });

  it("Graeme's examples: 2 shifts a week doing 4 beats 5 shifts a week doing 8", () => {
    // Over four weeks: 8 shifts / 16 improvements vs 20 shifts / 32.
    expect(improvementScorePct(16, 8)).toBe(200);
    expect(improvementScorePct(32, 20)).toBe(160);
  });

  it("rounds to a whole percent and isn't capped", () => {
    expect(improvementScorePct(1, 3)).toBe(33);
    expect(improvementScorePct(2, 3)).toBe(67);
    expect(improvementScorePct(9, 2)).toBe(450);
  });

  it("no shifts means no score, not zero or infinity", () => {
    expect(improvementScorePct(3, 0)).toBeNull();
    expect(improvementScorePct(0, 0)).toBeNull();
  });

  it("shifts but no improvements is 0%", () => {
    expect(improvementScorePct(0, 5)).toBe(0);
  });
});

describe("credits", () => {
  it("×2 and ×3 improvements count double and triple", () => {
    const pairs = [...credits(1, 1, 1), ...credits(1, 1, 2, "2026-10-10", 50), ...credits(1, 1, 3, "2026-10-10", 60)];
    expect(creditsByUser(pairs, W).get(1)).toEqual({ credits: 6, improvements: 3 });
  });

  it("anything that isn't 2 or 3 is worth 1", () => {
    expect(normaliseCreditWeight(null)).toBe(1);
    expect(normaliseCreditWeight(0)).toBe(1);
    expect(normaliseCreditWeight(7)).toBe(1);
    expect(normaliseCreditWeight("2")).toBe(2);
  });

  it("a shared improvement gives every credited person its full credits", () => {
    const pairs: CreditPair[] = [
      { improvementId: 9, userId: 1, weight: 2, doneDate: "2026-10-01" },
      { improvementId: 9, userId: 2, weight: 2, doneDate: "2026-10-01" },
    ];
    const by = creditsByUser(pairs, W);
    expect(by.get(1)?.credits).toBe(2);
    expect(by.get(2)?.credits).toBe(2);
  });

  it("the same person listed twice on one improvement is credited once", () => {
    const pairs: CreditPair[] = [
      { improvementId: 9, userId: 1, weight: 1, doneDate: "2026-10-01" },
      { improvementId: 9, userId: 1, weight: 1, doneDate: "2026-10-01" },
    ];
    expect(creditsByUser(pairs, W).get(1)?.credits).toBe(1);
  });

  it("only improvements done inside the rolling window count", () => {
    const pairs: CreditPair[] = [
      { improvementId: 1, userId: 1, weight: 3, doneDate: "2026-09-12" }, // a day too old
      { improvementId: 2, userId: 1, weight: 1, doneDate: "2026-09-13" }, // first day in
      { improvementId: 3, userId: 1, weight: 1, doneDate: "2026-10-12" }, // today
    ];
    expect(creditsByUser(pairs, W).get(1)?.credits).toBe(2);
  });
});

describe("shifts worked", () => {
  it("counts only shifts someone actually clocked in to (or that were approved)", () => {
    const shifts: RotaShift[] = [
      { employeeId: 7, date: "2026-10-01", status: "PunchclockFinished", shiftTypeName: null },
      { employeeId: 7, date: "2026-10-02", status: "Approved", shiftTypeName: null },
      { employeeId: 7, date: "2026-10-03", status: "PunchclockStarted", shiftTypeName: null },
      { employeeId: 7, date: "2026-10-04", status: "Assigned", shiftTypeName: null }, // didn't come in
      { employeeId: 7, date: "2026-10-05", status: null, shiftTypeName: null },
    ];
    expect(shiftsWorkedByEmployee(shifts, W).get(7)).toBe(3);
  });

  it("leaves out holiday and sickness shifts even when approved", () => {
    const shifts: RotaShift[] = [
      { employeeId: 7, date: "2026-10-01", status: "Approved", shiftTypeName: "Holiday" },
      { employeeId: 7, date: "2026-10-02", status: "Approved", shiftTypeName: "Sick" },
      { employeeId: 7, date: "2026-10-03", status: "Approved", shiftTypeName: "Normal" },
    ];
    expect(shiftsWorkedByEmployee(shifts, W).get(7)).toBe(1);
  });

  it("two shifts on one day count as one", () => {
    const shifts: RotaShift[] = [
      { employeeId: 7, date: "2026-10-01", status: "Approved", shiftTypeName: null },
      { employeeId: 7, date: "2026-10-01T00:00:00", status: "Approved", shiftTypeName: null },
    ];
    expect(shiftsWorkedByEmployee(shifts, W).get(7)).toBe(1);
  });

  it("only shifts inside the window count", () => {
    expect(shiftsWorkedByEmployee(worked(7, 40), W).get(7)).toBe(30);
  });
});

describe("buildScores", () => {
  const users = [
    { userId: 1, plandayEmployeeId: 101 }, // part-timer
    { userId: 2, plandayEmployeeId: 102 }, // full-timer
    { userId: 3, plandayEmployeeId: null }, // not linked to Planday
    { userId: 4, plandayEmployeeId: 104 }, // linked, no shifts this month
  ];
  const shifts = [...worked(101, 8), ...worked(102, 20)];
  const pairs = [...credits(1, 16), ...credits(2, 32), ...credits(3, 5), ...credits(4, 2)];

  it("scores each person and says '—' when shifts are unknown or zero", () => {
    const out = buildScores({ users, pairs, shifts, window: W });
    expect(out).toEqual([
      { userId: 1, credits: 16, improvements: 16, shifts: 8, scorePct: 200 },
      { userId: 2, credits: 32, improvements: 32, shifts: 20, scorePct: 160 },
      { userId: 3, credits: 5, improvements: 5, shifts: null, scorePct: null },
      { userId: 4, credits: 2, improvements: 2, shifts: 0, scorePct: null },
    ]);
  });

  it("every score is '—' when Planday couldn't be read at all", () => {
    const out = buildScores({ users, pairs, shifts: [], window: W, shiftsKnown: false });
    expect(out.every(r => r.scorePct == null && r.shifts == null)).toBe(true);
  });
});

describe("Leaner-board order", () => {
  it("ranks by score, puts '—' last, then breaks ties on count and name", () => {
    const rows = [
      { name: "Busy", count: 40, scorePct: 160 },
      { name: "None", count: 99, scorePct: null },
      { name: "Part-timer", count: 12, scorePct: 200 },
      { name: "Bea", count: 5, scorePct: 100 },
      { name: "Al", count: 5, scorePct: 100 },
      { name: "Zed", count: 7, scorePct: 100 },
    ];
    expect(rankByScore(rows).map(r => r.name)).toEqual(["Part-timer", "Busy", "Zed", "Al", "Bea", "None"]);
  });
});
