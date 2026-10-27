/**
 * "Have you made an improvement today?" — the optional last item on every
 * closing checklist (Graeme, 27 Oct 2026; Objectives E and H). Pure rules:
 * what a valid answer is, and the manager's uptake summary.
 */

export const PROMPT_ANSWERS = ["yes", "no"] as const;
export type PromptAnswer = typeof PROMPT_ANSWERS[number];

/** A "yes" points at the improvement it's about; a "no" never does. */
export function answerProblem(a: { answer: PromptAnswer; improvementId?: number | null }): string | null {
  if (a.answer === "yes" && a.improvementId == null) return "Log the improvement first, then it counts as a yes";
  if (a.answer === "no" && a.improvementId != null) return "A 'no' can't have an improvement attached";
  return null;
}

/** The row to store for an answer — "no" always clears any improvement. */
export function answerRow(a: { answer: PromptAnswer; improvementId?: number | null }): { answer: PromptAnswer; improvementId: number | null } {
  return { answer: a.answer, improvementId: a.answer === "yes" ? a.improvementId ?? null : null };
}

export interface UptakeRow {
  day: string;
  userId: number;
  name: string;
  answer: PromptAnswer;
  improvementId: number | null;
  improvementTitle: string | null;
  stationType: string | null;
}

export interface UptakeDay { day: string; yes: number; no: number }

/** Per-day yes/no counts (newest first) plus totals across the window. */
export function summariseUptake(rows: readonly UptakeRow[]): {
  days: UptakeDay[];
  totals: { yes: number; no: number; answered: number; people: number };
} {
  const byDay = new Map<string, UptakeDay>();
  const people = new Set<number>();
  let yes = 0, no = 0;
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { day: r.day, yes: 0, no: 0 };
    d[r.answer] += 1;
    byDay.set(r.day, d);
    people.add(r.userId);
    if (r.answer === "yes") yes += 1; else no += 1;
  }
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return { days, totals: { yes, no, answered: yes + no, people: people.size } };
}
