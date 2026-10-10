/**
 * A recipe's label status, as the Labels list shows it (pure, tested).
 */

export type LabelStatus = "live" | "update-needed" | "doesnt-fit" | "never-published" | "draft-recipe" | "archived";

export const STATUS_LABEL: Record<LabelStatus, string> = {
  live: "Live & up to date",
  "update-needed": "Update needed",
  "doesnt-fit": "Doesn't fit",
  "never-published": "Never published",
  "draft-recipe": "Draft recipe",
  archived: "Archived recipe",
};

export function decideStatus(input: {
  isDraft: boolean;
  archived: boolean;
  hasLive: boolean;
  /** Current snapshot equals the published one. */
  matchesLive: boolean;
  /** The label as it would be now fits its template. */
  currentFits: boolean;
}): LabelStatus {
  if (input.archived) return "archived";
  if (input.isDraft) return "draft-recipe";
  if (input.hasLive && input.matchesLive) return "live";
  if (!input.currentFits) return "doesnt-fit";
  return input.hasLive ? "update-needed" : "never-published";
}

export type PrintRefusal = "no-live" | "update-needed" | "doesnt-fit";

export const PRINT_REFUSAL_TEXT: Record<PrintRefusal, string> = {
  "no-live": "This recipe has no live label yet — check it and press “Update live version” first.",
  "update-needed": "The recipe has changed since its live label was checked (“Label update needed”) — check the new version and update it before printing.",
  "doesnt-fit": "The live label doesn't fit with today's dates.",
};

/** Printing uses the LIVE label only — and only while it still matches the
 *  recipe. Null = OK to print. */
export function printRefusal(input: { hasLive: boolean; matchesLive: boolean; fits: boolean }): PrintRefusal | null {
  if (!input.hasLive) return "no-live";
  if (!input.matchesLive) return "update-needed";
  if (!input.fits) return "doesnt-fit";
  return null;
}

/** Back-label count to start from: the item's net 2-packs, as a whole
 *  number, never negative; capped at MAX_PRINT_COUNT. */
export const MAX_PRINT_COUNT = 500;
export function initialPrintCount(netTwoPacks: number | null | undefined): number {
  const n = Math.floor(Number(netTwoPacks) || 0);
  return Math.min(MAX_PRINT_COUNT, Math.max(0, n));
}

/** Can this label be published right now? Both checks — the automatic fit
 *  check and no content blockers — must pass; then a person confirms. */
export function publishBlockers(input: { archived: boolean; fits: boolean; fitProblems: string[]; contentProblems: string[]; deckBlockers: string[] }): string[] {
  const out: string[] = [];
  if (input.archived) out.push("This recipe is archived.");
  if (!input.fits) out.push(...(input.fitProblems.length ? input.fitProblems : ["The label doesn't fit."]));
  out.push(...input.contentProblems, ...input.deckBlockers);
  return out;
}
