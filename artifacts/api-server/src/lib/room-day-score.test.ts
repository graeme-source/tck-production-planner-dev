import { describe, it, expect } from "vitest";
import { scoreRoomDay } from "./room-day-score";
import { earnedHours, roomRatio, roomScore } from "./room-kpi";

const weights = { packingPerHour: 30, wrappingPerHour: 180, deliveryMinutes: 10, lineMinutes: 2 };
const config = { weights, standardRatio: 0.6 };
const raw = { date: "2026-11-25", boxes: 120, packs: 900, deliveries: 2, deliveryLines: 10, paidHours: 20, people: 4 };
const credit = { improvements: 2, minutes: 30, people: [], events: [] };

describe("the room score for a day", () => {
  it("without credit is the plain room score", () => {
    const s = scoreRoomDay(raw, undefined, config);
    expect(s.score).toBe(roomScore(roomRatio(raw, weights), 0.6));
    expect(s.scoreBeforeCredit).toBe(s.score);
    expect(s.earned.earnedHours).toBeCloseTo(earnedHours(raw, weights).earnedHours);
  });

  it("adds improvement time at the 100% line and keeps the score without it", () => {
    const s = scoreRoomDay(raw, credit, config);
    // 30 minutes at the 0.6 line = 0.3 earned hours.
    expect(s.day.improvementHours).toBeCloseTo(0.3);
    expect(s.score).toBe(roomScore(roomRatio({ ...raw, improvementHours: 0.3 }, weights), 0.6));
    expect(s.scoreBeforeCredit).toBe(roomScore(roomRatio(raw, weights), 0.6));
    expect(s.score!).toBeGreaterThan(s.scoreBeforeCredit!);
  });

  it("has no score without a 100% line or paid hours", () => {
    expect(scoreRoomDay(raw, credit, { weights, standardRatio: null }).score).toBeNull();
    expect(scoreRoomDay({ ...raw, paidHours: 0 }, credit, config).band).toBe("neutral");
  });
});
