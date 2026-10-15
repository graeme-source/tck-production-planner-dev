/**
 * Dismissing a suggested build/cook time on the Timing data card (Graeme,
 * 2026-10-15). A dismissal says "I've seen this and the set value stands".
 * It holds while nothing has changed; it lapses — the card comes back — when
 * someone changes the set value, or when the floor's suggestion has moved
 * well away from what was dismissed (new evidence deserves a fresh look).
 */

export type TimingKind = "build" | "cook";

export interface DismissalLike {
  setValue: number | null;
  suggestedValue: number | null;
}

/** How far the suggestion may drift before a dismissal lapses: 10% of what
 *  was dismissed, at least 30 s for a build time / 2 min for a cook time. */
export function driftAllowance(kind: TimingKind, dismissedSuggestion: number): number {
  const floor = kind === "build" ? 30 : 2;
  return Math.max(floor, Math.abs(dismissedSuggestion) * 0.1);
}

export function dismissalStillHolds(
  kind: TimingKind,
  d: DismissalLike,
  current: { setValue: number | null; suggestedValue: number | null },
): boolean {
  if ((d.setValue ?? null) !== (current.setValue ?? null)) return false;
  if (d.suggestedValue == null || current.suggestedValue == null) return d.suggestedValue == current.suggestedValue;
  return Math.abs(current.suggestedValue - d.suggestedValue) <= driftAllowance(kind, d.suggestedValue);
}

/** The to-do title when a suggestion is sent to someone to review. */
export function reviewTodoTitle(kind: TimingKind, name: string, setValue: number | null, suggested: number | null): string {
  const fmt = (v: number) => (kind === "build" ? formatSeconds(v) : `${v} min`);
  const what = kind === "build" ? "build time" : "cook time";
  const says = kind === "build" ? "the floor says" : "the ovens say";
  const parts = [`Review ${what}: ${name}`];
  if (setValue != null && suggested != null) parts.push(`set ${fmt(setValue)}, ${says} ${fmt(suggested)}`);
  else if (suggested != null) parts.push(`none set, ${says} ${fmt(suggested)}`);
  else parts.push(setValue != null ? `set ${fmt(setValue)}` : "none set");
  return parts.join(" — ").slice(0, 500);
}

function formatSeconds(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r === 0 ? `${m} min` : `${m} min ${r} s`;
}
