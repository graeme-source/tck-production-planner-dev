/**
 * Automatic QUID — what to write, given what the matcher says and what is
 * stored now. Pure logic (Graeme, 2026-10-10). Objectives A and D.
 *
 * Each QUID-able thing (a recipe line, or a component inside a sub-recipe
 * line) carries `quid` and where that came from:
 *   - "manual"  a person ticked or unticked it — ALWAYS wins, never changed
 *               here, whatever the name says.
 *   - "auto"    ticked because the recipe's name names it.
 *   - null      nobody has decided.
 *
 * The rule, run every time a recipe is created, renamed or its lines change:
 *   - the matcher says auto, and nobody decided by hand → ticked (auto);
 *   - it was ticked automatically and the matcher no longer says so (the
 *     name changed, the line went) → unticked, back to undecided;
 *   - everything else stays exactly as it is.
 * "Suggested" lines (BBQ, Honey…) are never ticked here — they are offered
 * as a question until someone answers, and the answer is a manual decision.
 */
import type { QuidDecision } from "./quid-matcher";

export type QuidSource = "auto" | "manual" | null;
export interface QuidState { quid: boolean; source: QuidSource }

export interface QuidChange { key: string; from: QuidState; to: QuidState; decision: QuidDecision | null }

export interface QuidPlan {
  /** The state every key should be in afterwards (unchanged keys included). */
  next: Map<string, QuidState>;
  /** Only the keys whose state changes. */
  changes: QuidChange[];
  /** Questions still waiting for an answer. */
  suggestions: QuidDecision[];
}

const NONE: QuidState = { quid: false, source: null };

export function planQuid(current: Map<string, QuidState>, decisions: QuidDecision[]): QuidPlan {
  const byKey = new Map(decisions.map(d => [d.key, d]));
  const keys = new Set([...current.keys(), ...byKey.keys()]);
  const next = new Map<string, QuidState>();
  const changes: QuidChange[] = [];
  const suggestions: QuidDecision[] = [];

  for (const key of keys) {
    const cur = current.get(key) ?? NONE;
    const d = byKey.get(key) ?? null;
    let to: QuidState = cur;
    if (cur.source !== "manual") {
      if (d?.level === "auto") to = { quid: true, source: "auto" };
      else if (cur.source === "auto") to = NONE;
    }
    next.set(key, to);
    if (to.quid !== cur.quid || to.source !== cur.source) changes.push({ key, from: cur, to, decision: d });
    if (d?.level === "suggest" && to.source !== "manual" && !to.quid) suggestions.push(d);
  }
  return { next, changes, suggestions };
}

/** How a line's stored state should be carried through a recipe save,
 *  which deletes and re-inserts every line.
 *    - the client didn't send `quid` (the recipe editor no longer does —
 *      QUID has its own panel): keep what was stored;
 *    - it sent the same value as stored: keep the stored source;
 *    - it sent a different value, or ticked a brand-new line: that is a
 *      person's decision → manual. */
/** The `quid` a client sent on one line of a recipe body, if it sent one
 *  (read from the RAW body — validation may default or strip it). */
export function sentQuid(line: unknown): boolean | undefined {
  if (!line || typeof line !== "object") return undefined;
  const q = (line as { quid?: unknown }).quid;
  return typeof q === "boolean" ? q : undefined;
}

export function carryQuid(sent: boolean | undefined, previous: QuidState | undefined): QuidState {
  if (sent === undefined) return previous ?? NONE;
  if (previous && previous.quid === sent) return previous;
  if (!previous && sent === false) return NONE;
  return { quid: sent, source: "manual" };
}
