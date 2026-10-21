/**
 * The daily improvement check-in — what the card says, and when it's on
 * screen (Graeme, 2026-10-21; Objectives E and H):
 *
 *   "When any person logs in for the first time each day, give them a
 *    review of their improvement score and encourage them to find just one
 *    small improvement today ... a bit like the messaging the leaderboard
 *    does."
 *
 * Whether it's DUE is the server's call (GET /api/daily-checkin — one
 * acknowledgement per person per London day, any device). This file only
 * decides the words, the bar, and whether it may be on screen right now.
 * The words reuse the Leaner-board's own steps (leanerStep in
 * lib/improvement-score.ts), so the card and the board sound the same.
 * Always positive: no red, no "low".
 */
import { leanerStep, type LeanerStep } from "./improvement-score";
import { promptHiddenOnPath } from "./emergency-contacts";

export interface CheckinPrompt { waste: string; definition: string; example: string }

export interface CheckinCard {
  firstName: string;
  window: { from: string; to: string };
  scorePct: number | null;
  shifts30: number | null;
  credits30: number;
  improvements30: number;
  great30: number;
  substantial30: number;
  countAll: number;
  board: { place: number; of: number } | null;
  prompts: CheckinPrompt[];
  nudge: { term: string; nutshell: string } | null;
}

export interface CheckinStatus { day: string; due: boolean; card: CheckinCard | null }

/** One improvement a shift. */
export const SCORE_GOAL_PCT = 100;

/** The score with one more credit on today's shift count; null when there's
 *  no score to project (no shifts / not linked to Planday). */
export function projectedPct(card: Pick<CheckinCard, "credits30" | "shifts30">): number | null {
  const shifts = card.shifts30;
  if (shifts == null || !(shifts > 0)) return null;
  return Math.round(((card.credits30 + 1) / shifts) * 100);
}

/** How full the big bar is: the score towards 100% (one a shift). */
export function goalBarFill(pct: number | null | undefined): number {
  if (pct == null || !(pct > 0)) return 0;
  return Math.min(100, Math.round((pct / SCORE_GOAL_PCT) * 100));
}

export type CheckinTone = "first" | "climbing" | "celebrate" | "no-score";

export interface CheckinMessage {
  tone: CheckinTone;
  /** "Morning, Sam!" */
  greeting: string;
  /** The tailored line under the score. */
  line: string;
  /** The Leaner-board's own step message, when they have a score. */
  step: LeanerStep | null;
}

/** "Morning" / "Afternoon" / "Evening" by the London clock. */
export function partOfDay(londonHour: number): "Morning" | "Afternoon" | "Evening" {
  if (londonHour < 12) return "Morning";
  if (londonHour < 17) return "Afternoon";
  return "Evening";
}

const ord = (n: number): string => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "You're 3rd of 9 on the Leaner-board this month" — or null. */
export function boardLine(board: CheckinCard["board"]): string | null {
  if (!board) return null;
  if (board.place === 1) return "You're top of the Leaner-board this month!";
  return `You're ${ord(board.place)} of ${board.of} on the Leaner-board this month`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The tailored words (Graeme's brief):
 *   - none yet this month → "your first one could be today";
 *   - below 100% → "one small improvement today gets you to X%";
 *   - at or above 100% → celebrate and keep going;
 *   - no score (not linked to Planday / no shifts) → credits and count only.
 */
export function checkinMessage(card: CheckinCard, londonHour: number): CheckinMessage {
  const name = card.firstName.trim();
  const greeting = name ? `${partOfDay(londonHour)}, ${name}!` : `${partOfDay(londonHour)}!`;
  const step = leanerStep({ scorePct: card.scorePct, improvements30: card.improvements30, count: card.countAll });

  if (card.improvements30 <= 0) {
    const line = card.countAll > 0
      ? "Nothing yet this month — your first one this month could be today."
      : "Your first improvement could be today — and every one counts.";
    return { tone: "first", greeting, line, step: null };
  }

  if (card.scorePct == null) {
    return {
      tone: "no-score",
      greeting,
      line: `${plural(card.improvements30, "improvement")} in the last 30 days — brilliant. One more today keeps it rolling.`,
      step: null,
    };
  }

  if (card.scorePct >= SCORE_GOAL_PCT) {
    return {
      tone: "celebrate",
      greeting,
      line: `${card.scorePct}% — that's more than one improvement a shift. Amazing work — keep it going!`,
      step,
    };
  }

  const next = projectedPct(card);
  return {
    tone: "climbing",
    greeting,
    line: next != null && next > card.scorePct
      ? `One small improvement today gets you to ${next}%.`
      : "One small improvement today moves you up.",
    step,
  };
}

/** "8 credits · 6 improvements" with the ×2 / ×3 named when there are any. */
export function creditsSummary(card: Pick<CheckinCard, "credits30" | "improvements30">): string {
  return `${plural(card.credits30, "credit")} · ${plural(card.improvements30, "improvement")}`;
}

/** "Score = 8 credits ÷ 10 shifts" — so anyone can check the sum. */
export function scoreSum(card: Pick<CheckinCard, "credits30" | "shifts30">): string | null {
  if (card.shifts30 == null || !(card.shifts30 > 0)) return null;
  return `${plural(card.credits30, "credit")} ÷ ${plural(card.shifts30, "shift")} worked`;
}

// ── When it may be on screen ───────────────────────────────────────────────

export interface CheckinShowFacts {
  /** A real person signed in. */
  signedIn: boolean;
  pinLocked: boolean;
  /** People PIN / set-your-PIN prompts — must-answer, they go first. */
  otherMustAnswerPrompt: boolean;
  path: string;
  /** From the server; undefined while loading or when the call failed. */
  status: CheckinStatus | undefined;
  /** They pressed a button in this sign-in (the server may lag behind). */
  acknowledgedLocally: boolean;
}

/**
 * On screen only when: someone is signed in and unlocked, the PIN prompts
 * are out of the way, it isn't a kiosk / meeting / print page, the server
 * said it's due — and they haven't just answered it. A failed or missing
 * status never shows it (and never blocks anyone): it's asked again at the
 * next sign-in or page load.
 */
export function shouldShowCheckin(f: CheckinShowFacts): boolean {
  if (!f.signedIn || f.pinLocked || f.otherMustAnswerPrompt) return false;
  if (promptHiddenOnPath(f.path)) return false;
  if (f.acknowledgedLocally) return false;
  return !!f.status?.due && !!f.status.card;
}

/**
 * Should the OTHER first-of-day pop-ups (emergency contact, new to-do,
 * fixed-issue notices, celebrations, the walkthrough) hold back? While the
 * check-in is on screen — and while its status is still loading, so they
 * don't flash up and get covered a second later.
 */
export function checkinHoldsOthers(f: CheckinShowFacts & { loading: boolean }): boolean {
  if (shouldShowCheckin(f)) return true;
  if (!f.signedIn || f.pinLocked || f.otherMustAnswerPrompt || promptHiddenOnPath(f.path)) return false;
  return f.loading && !f.acknowledgedLocally;
}
