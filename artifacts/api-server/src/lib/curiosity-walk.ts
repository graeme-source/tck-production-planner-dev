/**
 * Curiosity Time pure logic — the walk is a pass through the Lean Made
 * Simple eight wastes (lean-corpus.ts, the terminology law), one answer per
 * waste. Kept free of DB/HTTP so it can be unit-tested.
 */
import { LMS_EIGHT_WASTES } from "./lean-corpus";

/** Canonical waste names, in the book's order. */
export const CANONICAL_WASTE_NAMES: string[] = LMS_EIGHT_WASTES.map(w => w.name);

const CANONICAL_SET = new Set(CANONICAL_WASTE_NAMES);

/** Whether a stored/submitted waste name is one of the canonical eight. */
export function isCanonicalWaste(name: string): boolean {
  return CANONICAL_SET.has(name);
}

export interface WalkObservationLike {
  wasteName: string;
  spotted: boolean;
}

export interface WalkProgress {
  /** Distinct canonical wastes answered (spotted or not). */
  answered: number;
  /** Of those, how many were spotted. */
  spotted: number;
  total: number;
  /** All eight answered. */
  complete: boolean;
}

/** Progress through a walk. Duplicate rows for a waste (shouldn't happen —
 *  the table has a unique constraint — but defensive) count once, with the
 *  spotted flag from the first row seen; non-canonical names are ignored. */
export function walkProgress(observations: WalkObservationLike[]): WalkProgress {
  const seen = new Map<string, boolean>();
  for (const obs of observations) {
    if (!isCanonicalWaste(obs.wasteName)) continue;
    if (!seen.has(obs.wasteName)) seen.set(obs.wasteName, obs.spotted);
  }
  const answered = seen.size;
  let spotted = 0;
  for (const wasSpotted of seen.values()) if (wasSpotted) spotted++;
  return {
    answered,
    spotted,
    total: CANONICAL_WASTE_NAMES.length,
    complete: answered === CANONICAL_WASTE_NAMES.length,
  };
}
