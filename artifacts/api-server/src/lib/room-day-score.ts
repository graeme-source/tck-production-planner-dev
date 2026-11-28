/**
 * The packing & wrapping room's score for one day, improvement credit
 * included — ONE function for every screen that shows it (the room tiles
 * and packing screens via services/room-live.ts, Analytics → KPIs, the
 * morning meeting and its trend, the end-of-day meeting). Until 28 Nov 2026
 * each of those wired lib/room-kpi.ts and the credit together itself.
 * Pure. Objective G.
 */
import { earnedHours, roomBand, roomRatio, roomScore, type EarnedBreakdown, type RoomDay, type RoomWeights } from "./room-kpi";
import { roomDayWithCredit, type CreditSummary, type TeamCredit } from "./improvement-kpi-credit";

export interface ScoredRoomDay<T extends RoomDay> {
  /** The day with the improvement credit attached (earned hours at 100%). */
  day: T & { improvementHours: number; improvementCredit: CreditSummary };
  earned: EarnedBreakdown;
  score: number | null;
  band: ReturnType<typeof roomBand>;
  /** The score without the improvement credit. */
  scoreBeforeCredit: number | null;
}

export function scoreRoomDay<T extends RoomDay>(
  raw: T,
  credit: TeamCredit | undefined,
  config: { weights: RoomWeights; standardRatio: number | null },
): ScoredRoomDay<T> {
  const day = roomDayWithCredit(raw, credit, config.standardRatio);
  const score = roomScore(roomRatio(day, config.weights), config.standardRatio);
  return {
    day,
    earned: earnedHours(day, config.weights),
    score,
    band: roomBand(score),
    scoreBeforeCredit: roomScore(roomRatio({ ...raw, improvementHours: 0 }, config.weights), config.standardRatio),
  };
}
