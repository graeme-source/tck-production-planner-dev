/**
 * Which improvements need reviewing (Graeme, 2026-09-24).
 *
 * An idea is work not yet done (stage 'todo'); everything past that is an
 * improvement. Ideas go straight into the feed and never need reviewing —
 * only finished improvements someone else logged, that I haven't seen since
 * they were finished (the server bakes "since finished" into seenByMe).
 *
 * This is the nav badge's rule exactly — countsAsUnseen() in @workspace/db,
 * which GET /improvements/unseen-count applies in SQL; a parity test holds
 * the two together. "Someone else" means who LOGGED it (submittedByMe), not
 * isMine (credit/assignment): keying on isMine left improvements logged by
 * someone else but credited to me on the badge with no NEW marker, no
 * "I've seen this" and no scroll tracking (Graeme, 24 Oct).
 */
export interface ReviewableImprovement {
  stage: string;
  seenByMe?: boolean;
  /** Did this viewer log it? Sent by the server since 24 Oct. */
  submittedByMe?: boolean;
  isMine: boolean;
}

export function isIdea(item: Pick<ReviewableImprovement, "stage">): boolean {
  return item.stage === "todo";
}

export function needsReview(item: ReviewableImprovement): boolean {
  // isMine only as a fallback for a list fetched from an older server.
  const loggedByMe = item.submittedByMe ?? item.isMine;
  return !isIdea(item) && !item.seenByMe && !loggedByMe;
}

/**
 * The "Not seen yet" filter's list (back by request, 27 Oct 2026 — it was
 * the "To review" tab until 2 Oct).
 *
 * Everything needsReview() counts — the nav badge's own rule, so the
 * filter and the blue badge always agree — PLUS anything that was on the
 * list while the filter has been on (`kept`). Scrolling past a card marks
 * it seen; without `kept` it would vanish from under the reader the moment
 * it counted (the same jump fixed in the main feed on 24 Oct).
 *
 * Returns `kept` itself when nothing new joined, so a state setter can
 * skip a re-render.
 */
export function unseenFilterIds<T extends ReviewableImprovement & { id: number }>(
  kept: ReadonlySet<number>,
  items: ReadonlyArray<T>,
): ReadonlySet<number> {
  const fresh = items.filter(i => needsReview(i) && !kept.has(i.id));
  if (fresh.length === 0) return kept;
  return new Set([...kept, ...fresh.map(i => i.id)]);
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
