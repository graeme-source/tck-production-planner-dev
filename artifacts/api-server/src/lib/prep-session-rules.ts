/**
 * Prep sessions — the decisions behind the invisible capture (Graeme,
 * 27 Oct 2026: "from when someone opens a prep item to when they complete
 * it"; Objectives C and I). Pure, so it is tested; the database half is
 * routes/prep-sessions.ts and the cleaning of durations for the report is
 * lib/prep-timing.ts.
 *
 * A session is one person working one prep item on one plan. The prep
 * screens report three things in the background — opened, completed (a
 * tick, or a finished sub-recipe make flow), closed (moved off it) — and
 * these rules turn them into sessions:
 *
 *   Opening   carries on the person's latest session on the item when it is
 *             still open (a reload, a second iPad, the screen re-showing it)
 *             or was closed less than CONTINUE_WINDOW_MS ago (they glanced at
 *             another item and came back). The closed gap is kept as a pause
 *             and is not counted as prep. Otherwise a new session starts.
 *             Nothing continues past MAX_SESSION_MS from its first opening.
 *   Ticking   belongs to the person's latest session on the item that was
 *             opened before the tick and no more than MAX_SESSION_MS before
 *             it — unless that session was closed more than
 *             CONTINUE_WINDOW_MS before the tick (a tick from somewhere else
 *             long after they moved on is not part of that session).
 */

/** A session longer than this was left open, not worked (the report ignores
 *  them too — lib/prep-timing.ts). */
export const MAX_SESSION_MS = 2 * 60 * 60_000;

/** Coming back to an item within this long of moving off it is the same job. */
export const CONTINUE_WINDOW_MS = 15 * 60_000;

/** The screens that capture sessions (context on the row; zod-checked) —
 *  the station keys the app already uses; "prep" is the Prepping For hub,
 *  whose Replenish flow makes sub-recipes. */
export const PREP_SESSION_STATIONS = ["main_prep", "prep_bases", "prep_meat", "prep"] as const;
export type PrepSessionStation = (typeof PREP_SESSION_STATIONS)[number];

/** What the rules need to know about a session — epoch milliseconds. */
export interface SessionHead {
  id: number;
  openedAt: number;
  /** null while the item is still open on someone's screen. */
  closedAt: number | null;
}

export interface SessionPause { from: number; to: number }

export type OpenDecision =
  | { kind: "new" }
  | { kind: "continue"; sessionId: number; pause: SessionPause | null };

/** Opening an item: carry on the person's latest session on it, or start a
 *  new one. `latest` is their most recently opened session on this item (and
 *  recipe scope) on this plan, if any. */
export function decideOpen(latest: SessionHead | null, now: number): OpenDecision {
  if (!latest) return { kind: "new" };
  if (now - latest.openedAt > MAX_SESSION_MS) return { kind: "new" };
  if (latest.closedAt == null) return { kind: "continue", sessionId: latest.id, pause: null };
  if (now - latest.closedAt > CONTINUE_WINDOW_MS) return { kind: "new" };
  return {
    kind: "continue",
    sessionId: latest.id,
    pause: now > latest.closedAt ? { from: latest.closedAt, to: now } : null,
  };
}

/** The session a completion at `at` belongs to, from the person's sessions on
 *  the item — or null when none fits (then it simply isn't timed). */
export function sessionForCompletion(candidates: readonly SessionHead[], at: number): number | null {
  let best: SessionHead | null = null;
  for (const s of candidates) {
    if (s.openedAt > at) continue;
    if (at - s.openedAt > MAX_SESSION_MS) continue;
    if (!best || s.openedAt > best.openedAt) best = s;
  }
  if (!best) return null;
  if (best.closedAt != null && at - best.closedAt > CONTINUE_WINDOW_MS) return null;
  return best.id;
}

/** What happens to the timing of a completion (Graeme, 27 Oct 2026: "no
 *  completing prep without opening the item"). The prep screens only offer
 *  the tick inside an opened item, and the server checks too: a completion
 *  with a session open on the item is linked to it; one with nothing open
 *  (an old screen still cached on an iPad, an open that never arrived) is
 *  FLAGGED — recorded as completed without opening, counted, never timed.
 *  Flag, not refuse: the tick itself always stands, so prep is never blocked
 *  by a network blip. */
export type CompletionTiming = { kind: "link"; sessionId: number } | { kind: "flag" };

/** prep_sessions.flag on the zero-length row that records a flagged
 *  completion (the migration's CHECK allows only this value). */
export const COMPLETED_WITHOUT_OPEN = "completed_without_open";

export function completionTiming(candidates: readonly SessionHead[], at: number): CompletionTiming {
  const sessionId = sessionForCompletion(candidates, at);
  return sessionId != null ? { kind: "link", sessionId } : { kind: "flag" };
}

/** Tin 0 is the mixing station's add-at-cooking confirmation (the stock
 *  poured into the trays on production day), stored as a prep_completions
 *  row — not prep, so never timed or flagged. Real prep tins are 1…n. */
export function isPrepTin(tinNumber: number): boolean {
  return Number.isInteger(tinNumber) && tinNumber >= 1;
}

/** "Exactly one prep item" — an ingredient or a sub-recipe, never both. */
export function prepItemOf(body: { ingredientId?: number | null; subRecipeId?: number | null }):
  { ingredientId: number; subRecipeId: null } | { ingredientId: null; subRecipeId: number } | null {
  const ing = body.ingredientId ?? null;
  const sub = body.subRecipeId ?? null;
  if (ing != null && sub == null) return { ingredientId: ing, subRecipeId: null };
  if (sub != null && ing == null) return { ingredientId: null, subRecipeId: sub };
  return null;
}
