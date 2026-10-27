/**
 * Walkthrough data: the steps attached to a change entry. One validator,
 * used by the API (before saving) and the station screen (before running),
 * so a bad tutorial is refused at the door and can never break a station.
 */
import type { Tutorial, TutorialStep } from "./types";

export const TUTORIAL_LIMITS = {
  maxSteps: 12,
  titleMax: 80,
  bodyMax: 600,
  noteMax: 200,
} as const;

/** data-tour values: lower-case words joined by hyphens, e.g.
 *  "wrapping-print-back-labels". */
export const TOUR_TARGET_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TARGET_MAX = 60;

export type TutorialParse =
  | { ok: true; tutorial: Tutorial | null }
  | { ok: false; errors: string[] };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Checks and normalises a tutorial. null/undefined (or no steps) = no
 *  tutorial, which is fine. Errors name the step (1-based) in plain words. */
export function parseTutorial(raw: unknown): TutorialParse {
  if (raw == null) return { ok: true, tutorial: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["The walkthrough must be an object with a list of steps."] };
  const stepsRaw = (raw as { steps?: unknown }).steps;
  if (stepsRaw == null) return { ok: true, tutorial: null };
  if (!Array.isArray(stepsRaw)) return { ok: false, errors: ["steps must be a list."] };
  if (stepsRaw.length === 0) return { ok: true, tutorial: null };
  const errors: string[] = [];
  if (stepsRaw.length > TUTORIAL_LIMITS.maxSteps) errors.push(`At most ${TUTORIAL_LIMITS.maxSteps} steps (this has ${stepsRaw.length}).`);
  const steps: TutorialStep[] = [];
  stepsRaw.forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== "object") { errors.push(`Step ${n} is empty.`); return; }
    const o = s as Record<string, unknown>;
    const title = str(o.title);
    const body = str(o.body);
    const targetRaw = o.target == null ? "" : str(o.target);
    const note = str(o.hiddenNote);
    if (!title) errors.push(`Step ${n} needs a title.`);
    else if (title.length > TUTORIAL_LIMITS.titleMax) errors.push(`Step ${n}'s title is over ${TUTORIAL_LIMITS.titleMax} characters.`);
    if (!body) errors.push(`Step ${n} needs some text.`);
    else if (body.length > TUTORIAL_LIMITS.bodyMax) errors.push(`Step ${n}'s text is over ${TUTORIAL_LIMITS.bodyMax} characters.`);
    if (targetRaw && (targetRaw.length > TARGET_MAX || !TOUR_TARGET_PATTERN.test(targetRaw))) {
      errors.push(`Step ${n}'s target "${targetRaw}" isn't a data-tour name (lower-case words joined by hyphens).`);
    }
    if (note.length > TUTORIAL_LIMITS.noteMax) errors.push(`Step ${n}'s hidden note is over ${TUTORIAL_LIMITS.noteMax} characters.`);
    steps.push({ target: targetRaw || null, title, body, hiddenNote: note || null });
  });
  return errors.length ? { ok: false, errors } : { ok: true, tutorial: { steps } };
}

/** CSS selector for a step's target, or null for a centred step. The
 *  pattern above already rules out quotes, so this can't be injected. */
export function tourSelector(step: TutorialStep): string | null {
  if (!step.target || !TOUR_TARGET_PATTERN.test(step.target)) return null;
  return `[data-tour="${step.target}"]`;
}

/** Next/Back with the ends clamped; Next past the last step = finished. */
export function stepAfter(index: number, count: number, dir: "next" | "back"): { index: number; finished: boolean } {
  if (count <= 0) return { index: 0, finished: true };
  if (dir === "back") return { index: Math.max(0, index - 1), finished: false };
  if (index + 1 >= count) return { index: count - 1, finished: true };
  return { index: index + 1, finished: false };
}
