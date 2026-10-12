/**
 * How the improvement score reads on screen (Objective E). The maths lives
 * on the server (api-server lib/improvement-score.ts); this is only the
 * wording, the bar and the ×2/×3 badge.
 */

/** The line under the Leaner-board heading. */
export const SCORE_EXPLAINER = "1 improvement per shift = 100% · last 30 days";

/** Bars fill at 200% — anything above still shows its real number. */
export const SCORE_BAR_CAP = 200;

export function scoreText(pct: number | null | undefined): string {
  return pct == null ? "—" : `${pct}%`;
}

/** How full the bar is, 0–100 (of the bar), capped at SCORE_BAR_CAP. */
export function scoreBarFill(pct: number | null | undefined): number {
  if (pct == null || !(pct > 0)) return 0;
  return Math.min(100, (pct / SCORE_BAR_CAP) * 100);
}

/** The bar's colour band: under one a shift, on target, or well above. */
export function scoreBand(pct: number | null | undefined): "none" | "under" | "on" | "above" {
  if (pct == null) return "none";
  if (pct < 100) return "under";
  if (pct < 150) return "on";
  return "above";
}

/** "6 credits · 3 shifts · 14 all-time" — the small print under a name. */
export function scoreDetail(row: { credits30: number; shifts30: number | null; count: number }): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const shifts = row.shifts30 == null ? "shifts not linked" : plural(row.shifts30, "shift");
  return `${plural(row.credits30, "credit")} · ${shifts} · ${row.count} all-time`;
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
