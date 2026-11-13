import { describe, it, expect } from "vitest";
import { earnedHours, roomRatio, roomScore, calibrateStandardRatio, roomBand, roomHoursByDay, type RoomDay } from "./room-kpi";

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
    expect(m.get("2026-11-12")).toEqual({ paidHours: 16.5, people: 2, pending: false });
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
    expect(m.get("2026-11-12")).toEqual({ paidHours: 8.25, people: 1, pending: true });
  });
});
