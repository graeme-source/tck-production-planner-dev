/**
 * Which improvement events put something in someone's notification centre
 * (the bell, and the phone push that goes with it). Objective E.
 *
 * Graeme, 27 Oct 2026: "can you stop giving anyone notifications in the
 * notification centre if someone made an improvement? We've already got the
 * improvement notification blue tick on the left-hand side, and people are
 * actively doing that."
 *
 *  - "made" — an improvement logged, finished, submitted, approved,
 *    auto-completed by its after-photo, or changed from an idea into an
 *    improvement. This used to be the "Great news — X made an improvement"
 *    celebration sent to the WHOLE team. Now it tells nobody: the unseen
 *    count on the Improvements nav item is the signal, and the feed, the
 *    Leaner-board and the meeting slides still celebrate it.
 *  - "comment" — a reply on the Comments & photos timeline goes to the
 *    people the improvement belongs to (commentRecipients decides who).
 *  - "rating" — a ×2 / ×3 rating goes to the people credited
 *    (ratingRecipients decides who).
 *
 * The founder's review task (approval step on) is a to-do, not a
 * notification-centre row, so it isn't decided here.
 *
 * Pure: callers work out the candidate people; this says who of them the
 * notification centre reaches.
 */
export type ImprovementNotifyEvent =
  | { kind: "made" }
  | { kind: "comment"; recipientIds: ReadonlyArray<number> }
  | { kind: "rating"; recipientIds: ReadonlyArray<number> };

export function notificationCentreRecipients(event: ImprovementNotifyEvent): number[] {
  switch (event.kind) {
    case "made":
      // Nobody — the nav badge does this job (27 Oct 2026).
      return [];
    case "comment":
    case "rating":
      return [...new Set(event.recipientIds.filter(id => Number.isInteger(id) && id > 0))];
  }
}
