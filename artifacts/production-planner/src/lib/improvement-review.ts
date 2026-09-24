/**
 * Which improvements need reviewing (Graeme, 2026-09-24).
 *
 * An idea is work not yet done (stage 'todo'); everything past that is an
 * improvement. Ideas go straight into the feed and never need reviewing —
 * only finished improvements someone else logged, that I haven't seen since
 * they were finished (the server bakes "since finished" into seenByMe and
 * applies the same rule to the nav count).
 */
export interface ReviewableImprovement {
  stage: string;
  seenByMe?: boolean;
  isMine: boolean;
}

export function isIdea(item: Pick<ReviewableImprovement, "stage">): boolean {
  return item.stage === "todo";
}

export function needsReview(item: ReviewableImprovement): boolean {
  return !isIdea(item) && !item.seenByMe && !item.isMine;
}
