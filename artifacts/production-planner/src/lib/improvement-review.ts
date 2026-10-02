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

/** Improvements shown at a time in the feed, and added each time the reader
 *  reaches the bottom — like scrolling back in WhatsApp (Graeme, 2026-10-02:
 *  the full feed was getting long and slow). */
export const FEED_PAGE_SIZE = 10;

/** How many feed items to render: what the reader has scrolled to, but never
 *  fewer than reach the oldest unseen one (it must be reachable to be seen). */
export function feedShownCount(total: number, requested: number, lastUnseenIndex: number): number {
  return Math.min(total, Math.max(requested, lastUnseenIndex + 1));
}
