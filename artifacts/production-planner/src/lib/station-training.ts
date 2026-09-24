/**
 * Station SOP training — client-side rules (Graeme, 2026-09-24).
 *
 * The station gate only fires when someone opens a station on its LIVE
 * plan, i.e. they're plausibly working it. Looking up yesterday's prep
 * numbers, or peeking at tomorrow's building plan, is reading history — it
 * must never demand a stack of SOP reviews first.
 */
import { planTargetForStation } from "./station-plan-target";

/** Prep sub-stations work ahead exactly like prep. */
const PREP_SUB = new Set(["main_prep", "prep_bases", "prep_meat"]);

/** Does opening `stationKey` on a plan dated `planDate` mean working it
 *  today? Production-day stations: only today's plan. Stations that work
 *  ahead (dough, prep): today's or a later plan — later because that's
 *  their normal job, today's because dough is sometimes made same-day. */
export function isLiveStationPlan(stationKey: string, planDate: string | null | undefined, todayLondon: string): boolean {
  if (!planDate) return false;
  const day = planDate.slice(0, 10);
  const looksAhead = planTargetForStation(stationKey) !== "today" || PREP_SUB.has(stationKey);
  return looksAhead ? day >= todayLondon : day === todayLondon;
}

export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
}

/** "14h", "45 min" — how long is left before a review is required. */
export function timeLeft(deadlineIso: string | null | undefined, now: Date = new Date()): string | null {
  if (!deadlineIso) return null;
  const ms = new Date(deadlineIso).getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h`;
}

export type ReviewStatus = "trained" | "refresher" | "untrained";

export interface GateSop {
  sopId: number;
  title: string;
  stepCount: number;
  currentVersion: number;
  changedAt: string;
  status: ReviewStatus;
  reviewedAt: string | null;
  deadline: string | null;
  required: boolean;
}

export interface GateState {
  station: string;
  enforce: boolean;
  rostered: boolean;
  pass: { kind: "skipped" | "just_looking"; validUntil: string } | null;
  sops: GateSop[];
  decision: {
    show: boolean;
    canSkip: boolean;
    skipUntil: string | null;
    canJustLook: boolean;
    outstanding: number;
  };
}

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  trained: "Trained",
  refresher: "Needs refresher",
  untrained: "Not trained",
};
