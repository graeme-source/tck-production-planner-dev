import { describe, it, expect } from "vitest";
import { earnedHours, roomRatio, roomScore, calibrateStandardRatio, roomBand, roomHoursByDay, punchedTimes, type RoomDay } from "./room-kpi";
import { elapsedPaidHours } from "./team-efficiency-today";

const W = { packingPerHour: 55, wrappingPerHour: 115, deliveryMinutes: 10, lineMinutes: 2 };
const typical: RoomDay = { date: "2026-11-12", boxes: 98, packs: 495, deliveries: 5, deliveryLines: 19, paidHours: 16.4, people: 2 };

describe("room run rate", () => {
  it("credits boxes, packs and deliveries in hours (the proposal's typical day)", () => {
    const e = earnedHours(typical, W);
    expect(e.packingHours).toBeCloseTo(98 / 55, 5);
    expect(e.wrappingHours).toBeCloseTo(495 / 115, 5);
    expect(e.deliveryHours).toBeCloseTo((50 + 38) / 60, 5);
    expect(e.earnedHours).toBeCloseTo(7.57, 1);
  });
  it("a bigger delivery earns more than a small one", () => {
    const small = earnedHours({ boxes: 0, packs: 0, deliveries: 1, deliveryLines: 2 }, W).deliveryHours;
    const big = earnedHours({ boxes: 0, packs: 0, deliveries: 1, deliveryLines: 20 }, W).deliveryHours;
    expect(big).toBeGreaterThan(small);
  });
  it("a typical day scores 100% against its own calibration; more work in the same hours scores higher", () => {
    const standard = roomRatio(typical, W)!;
    expect(roomScore(standard, standard)).toBe(100);
    const busier = { ...typical, boxes: 140 };
    expect(roomScore(roomRatio(busier, W), standard)).toBeGreaterThan(100);
    const slowSetUp = { ...typical, paidHours: 17.4 };
    expect(roomScore(roomRatio(slowSetUp, W), standard)).toBeLessThan(100);
  });
  it("no paid hours → no score", () => {
    expect(roomRatio({ ...typical, paidHours: 0 }, W)).toBeNull();
    expect(roomScore(null, 0.5)).toBeNull();
  });
  it("calibrates to the median day, needing at least five", () => {
    const days = [10, 11, 12, 13, 14].map(h => ({ ...typical, paidHours: h }));
    expect(calibrateStandardRatio(days, W)).toBeCloseTo(roomRatio({ ...typical, paidHours: 12 }, W)!, 3);
    expect(calibrateStandardRatio(days.slice(0, 4), W)).toBeNull();
  });
  it("bands at 110 / 100 / 90", () => {
    expect([roomBand(112), roomBand(100), roomBand(95), roomBand(80), roomBand(null)]).toEqual(["platinum", "green", "amber", "red", "neutral"]);
  });
});

describe("room hours from Planday", () => {
  const shift = (id: number, employeeId: number, positionId: number, start: string, end: string) => ({
    id, employeeId, date: "2026-11-12", positionId, salary: 0, start, end,
    breaks: [{ duration: 0.75, amount: -9, isPaid: false }],
  });
  it("counts only Packer and Wrapper shifts, whole shift less unpaid breaks", () => {
    const m = roomHoursByDay({
      payroll: [
        shift(1, 10, 1, "2026-11-12T07:00:00", "2026-11-12T16:00:00"),
        shift(2, 11, 2, "2026-11-12T07:00:00", "2026-11-12T16:00:00"),
        shift(3, 12, 3, "2026-11-12T07:00:00", "2026-11-12T16:00:00"), // Builder — not the room
      ],
      rota: [1, 2, 3].map(id => ({ id, date: "2026-11-12", status: "Approved", shiftTypeId: null, positionId: id })),
      positions: [{ id: 1, name: "Packer" }, { id: 2, name: "Wrapper" }, { id: 3, name: "Builder 1" }],
      shiftTypes: [],
      positionNames: ["Packer", "Wrapper"],
    });
    expect(m.get("2026-11-12")).toEqual({ paidHours: 16.5, people: 2, pending: false, punched: 0 });
  });
  it("leaves out training and flags a room shift still waiting for approval", () => {
    const m = roomHoursByDay({
      payroll: [shift(1, 10, 1, "2026-11-12T07:00:00", "2026-11-12T16:00:00"), shift(2, 11, 1, "2026-11-12T07:00:00", "2026-11-12T16:00:00")],
      rota: [
        { id: 1, date: "2026-11-12", status: "Approved", shiftTypeId: null, positionId: 1 },
        { id: 2, date: "2026-11-12", status: "Approved", shiftTypeId: 9, positionId: 1 },
        { id: 4, date: "2026-11-12", status: "Created", shiftTypeId: null, positionId: 1 }, // not approved, not in payroll yet
      ],
      positions: [{ id: 1, name: "packer" }],
      shiftTypes: [{ id: 9, name: "Training" }],
      positionNames: ["Packer"],
    });
    expect(m.get("2026-11-12")).toEqual({ paidHours: 8.25, people: 1, pending: true, punched: 0 });
  });
  it("today's live figure counts each scheduled shift only up to now (Graeme, 20 Nov 2026)", () => {
    const inputs = {
      payroll: [shift(1, 10, 1, "2026-11-12T07:00:00", "2026-11-12T16:00:00"), shift(2, 11, 2, "2026-11-12T07:00:00", "2026-11-12T16:00:00")],
      rota: [1, 2].map(id => ({ id, date: "2026-11-12", status: "PunchclockStarted", shiftTypeId: null, positionId: id })),
      positions: [{ id: 1, name: "Packer" }, { id: 2, name: "Wrapper" }],
      shiftTypes: [],
      positionNames: ["Packer", "Wrapper"],
    };
    const whole = roomHoursByDay(inputs).get("2026-11-12")!.paidHours;
    const at11 = roomHoursByDay({ ...inputs, now: "2026-11-12T11:00:00" }).get("2026-11-12")!.paidHours;
    expect(whole).toBe(16.5);
    // Four hours in for two people, less the share of breaks already due.
    expect(at11).toBeCloseTo(2 * elapsedPaidHours(inputs.payroll[0], "2026-11-12T11:00:00"), 2);
    expect(at11).toBeGreaterThan(7);
    expect(at11).toBeLessThanOrEqual(8);
    // Before anyone's started, nothing is charged; after the shifts end, all of it.
    expect(roomHoursByDay({ ...inputs, now: "2026-11-12T06:00:00" }).get("2026-11-12")!.paidHours).toBe(0);
    expect(roomHoursByDay({ ...inputs, now: "2026-11-12T18:00:00" }).get("2026-11-12")!.paidHours).toBe(16.5);
  });
  it("an unapproved shift counts its punch clock times; an approved one keeps Planday's (Graeme, 20 Nov 2026)", () => {
    const inputs = {
      // Thursday 19 Nov: Packer scheduled 06:00–17:00, clocked out 16:47, not approved yet.
      payroll: [shift(1, 10, 1, "2026-11-12T06:00", "2026-11-12T17:00"), shift(2, 11, 2, "2026-11-12T08:00", "2026-11-12T17:00")],
      rota: [
        { id: 1, date: "2026-11-12", status: "PunchclockFinished", shiftTypeId: null, positionId: 1 },
        { id: 2, date: "2026-11-12", status: "Approved", shiftTypeId: null, positionId: 2 },
      ],
      positions: [{ id: 1, name: "Packer" }, { id: 2, name: "Wrapper" }],
      shiftTypes: [],
      positionNames: ["Packer", "Wrapper"],
      punches: [
        { shiftId: 1, startDateTime: "2026-11-12T05:26", endDateTime: "2026-11-12T16:47" },
        { shiftId: 2, startDateTime: "2026-11-12T07:50", endDateTime: "2026-11-12T15:00" }, // approved: ignored
      ],
    };
    const day = roomHoursByDay(inputs).get("2026-11-12")!;
    // Packer 06:00 (not the early 05:26) → 16:47 = 10.78 h less 0.75 break; Wrapper 9 h less 0.75.
    expect(day.paidHours).toBeCloseTo(10.03 + 8.25, 1);
    expect(day.punched).toBe(1);
    expect(day.pending).toBe(true);
  });
});

describe("punchedTimes", () => {
  const s = { start: "2026-11-19T06:00", end: "2026-11-19T17:00" };
  it("starts at the later of clock-in and the scheduled start, ends at clock-out", () => {
    expect(punchedTimes(s, { startDateTime: "2026-11-19T05:26", endDateTime: "2026-11-19T16:47" })).toEqual({ start: "2026-11-19T06:00", end: "2026-11-19T16:47", punched: true });
    expect(punchedTimes(s, { startDateTime: "2026-11-19T06:30", endDateTime: "2026-11-19T17:30" })).toEqual({ start: "2026-11-19T06:30", end: "2026-11-19T17:30", punched: true });
  });
  it("keeps the scheduled end while still clocked in, and the schedule with no punch", () => {
    expect(punchedTimes(s, { startDateTime: "2026-11-19T06:00", endDateTime: null })).toEqual({ start: "2026-11-19T06:00", end: "2026-11-19T17:00", punched: true });
    expect(punchedTimes(s, undefined)).toEqual({ ...s, punched: false });
  });
});
