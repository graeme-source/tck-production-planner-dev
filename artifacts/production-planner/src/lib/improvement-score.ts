/**
 * How the Leaner-board reads on screen (Objectives E and H). The maths lives
 * on the server (api-server lib/improvement-score.ts); this is only the
 * wording, the encouraging steps, the bar and the ×2/×3 badge.
 */

/** The lines under the Leaner-board heading. */
export const SCORE_EXPLAINER = "Last 30 days · most improvements at the top";
export const SCORE_SMALL_PRINT =
  "Score = improvements ÷ shifts worked (1 a shift = 100%). A ×2 or ×3 improvement counts double or triple in the score, not in the count.";

export function scoreText(pct: number | null | undefined): string {
  return pct == null ? "—" : `${pct}%`;
}

/**
 * The encouraging steps (Graeme, 2026-10-12: "8% is not a bad number in
 * comparison to 0 ... 'Great, you've made a start. Now let's get to 20'").
 * The targets live here as data — change a number and the messages, the
 * "next stop" and the bar all follow. Always positive: no red, no "low".
 */
export const LEANER_TARGETS = [20, 50] as const;

export type LeanerStepKey = "waiting" | "started" | "rolling" | "legend";

export interface LeanerStep {
  key: LeanerStepKey;
  /** The message on the card. */
  message: string;
  /** The next target %, or null once past the last one. */
  nextPct: number | null;
}

/**
 * Which step someone's on. No improvements this month = "waiting" (their
 * first ever, or their next if they've done one before); otherwise the
 * score against LEANER_TARGETS. Null when there's no score to step on (no
 * shifts in the window, or not linked to Planday).
 */
export function leanerStep(row: { scorePct: number | null; improvements30: number; count?: number }): LeanerStep | null {
  const [first, second] = LEANER_TARGETS;
  const pct = row.scorePct;
  if (pct == null) return null;
  if (row.improvements30 <= 0) {
    const which = (row.count ?? 0) > 0 ? "next" : "first";
    return { key: "waiting", nextPct: first, message: `Your ${which} improvement is waiting — what's one thing that annoyed you this week?` };
  }
  if (pct < first) return { key: "started", nextPct: first, message: `Great — you've made a start. Next stop: ${first}%` };
  if (pct < second) return { key: "rolling", nextPct: second, message: `Brilliant — on to ${second}%` };
  return { key: "legend", nextPct: null, message: "Leaner legend" };
}

/** How full the bar is (0–100): progress towards the next stop; full for a legend. */
export function stepBarFill(pct: number | null | undefined, nextPct: number | null): number {
  if (pct == null || !(pct > 0)) return 0;
  if (nextPct == null) return 100;
  return Math.min(100, Math.round((pct / nextPct) * 100));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "4 improvements · 10 shifts" — the maths under the score, so anyone can
 * check it. A ×2/×3 bonus is named when it changes the sum.
 */
export function scoreDetail(row: { improvements30: number; credits30: number; shifts30: number | null }): string {
  const shifts = row.shifts30 == null
    ? "shifts not linked to Planday"
    : row.shifts30 === 0 ? "no shifts in the last 30 days" : plural(row.shifts30, "shift");
  const bonus = row.credits30 > row.improvements30 && row.shifts30
    ? ` · counts as ${row.credits30} with ×2/×3`
    : "";
  return `${plural(row.improvements30, "improvement")} · ${shifts}${bonus}`;
}

export type CreditWeight = 1 | 2 | 3;

export const CREDIT_OPTIONS: ReadonlyArray<{ weight: CreditWeight; label: string; hint: string }> = [
  { weight: 1, label: "×1", hint: "Standard" },
  { weight: 2, label: "×2", hint: "Great one" },
  { weight: 3, label: "×3", hint: "Substantial" },
];

export function normaliseCreditWeight(n: unknown): CreditWeight {
  const v = Number(n);
  return v === 2 || v === 3 ? v : 1;
}

/** The badge on a ×2 / ×3 improvement; null for a standard one. */
export function creditBadge(weight: unknown): string | null {
  const w = normaliseCreditWeight(weight);
  if (w === 2) return "×2 — great one";
  if (w === 3) return "×3 — substantial";
  return null;
}
