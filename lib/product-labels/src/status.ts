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

/** Can this label be published right now? Both checks — the automatic fit
 *  check and no content blockers — must pass; then a person confirms. */
export function publishBlockers(input: { archived: boolean; fits: boolean; fitProblems: string[]; contentProblems: string[]; deckBlockers: string[] }): string[] {
  const out: string[] = [];
  if (input.archived) out.push("This recipe is archived.");
  if (!input.fits) out.push(...(input.fitProblems.length ? input.fitProblems : ["The label doesn't fit."]));
  out.push(...input.contentProblems, ...input.deckBlockers);
  return out;
}
