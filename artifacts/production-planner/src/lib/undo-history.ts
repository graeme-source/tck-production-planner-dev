/**
 * Undo / redo history for an editor form (Objective G — the survey builder).
 *
 * Graeme, 2026-10-20: "the ability to undo a change and go back through if
 * I've accidentally deleted something." Every change becomes a step, except
 * that a run of quick edits (typing a word) joins the step before it, so
 * Undo takes back a whole burst of typing rather than one letter.
 */

export type History<T> = { past: T[]; present: T; future: T[]; lastAt: number };

export const HISTORY_LIMIT = 100;
/** Edits closer together than this join one step (unless forced apart). */
export const COALESCE_MS = 1000;

export function startHistory<T>(present: T, now = 0): History<T> {
  return { past: [], present, future: [], lastAt: now };
}

/** Record a new state. `separate` forces its own step (delete, duplicate,
 *  move, add), so those can always be undone on their own. */
export function record<T>(h: History<T>, next: T, now: number, separate = false): History<T> {
  const coalesce = !separate && h.past.length > 0 && now - h.lastAt < COALESCE_MS;
  if (coalesce) return { ...h, present: next, future: [], lastAt: now };
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  // lastAt reset so the next edit after an undo starts a fresh step.
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastAt: 0 };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;

/** Move one item in a list (drag and drop). Out-of-range indexes leave it alone. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
