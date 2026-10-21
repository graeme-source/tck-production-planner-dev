/**
 * "Your improvement has been rated higher than normal" (Graeme, 2026-10-21;
 * Objectives E and H).
 *
 * When the founder marks an improvement ×2 ("Great one") or ×3
 * ("Substantial"), or raises it from ×2 to ×3, everyone credited on it gets
 * a bell notification (and a phone push where they've opted in). Lowering or
 * removing the rating sends nothing. Nobody hears about the same rating
 * twice: someone already told about ×3 isn't told about ×2 (or ×3) again
 * after a change of mind. The founder isn't told about his own rating.
 *
 * Pure: the route reads who's credited and who's already been told, and
 * writes what this returns.
 */
import { normaliseCreditWeight, type CreditWeight } from "./improvement-score";

/** One bell-notification type per rating, so "already told" is a plain
 *  lookup on the notifications table — no extra column needed. */
export const RATING_NOTIFICATION_TYPE: Record<2 | 3, string> = {
  2: "improvement_great",
  3: "improvement_substantial",
};

/** The rating a notification type stands for; null for any other type. */
export function ratingOfNotificationType(type: string): 2 | 3 | null {
  if (type === RATING_NOTIFICATION_TYPE[2]) return 2;
  if (type === RATING_NOTIFICATION_TYPE[3]) return 3;
  return null;
}

/** The words on the bell and the push. */
export function ratingMessage(weight: 2 | 3, title: string): { message: string; pushTitle: string; pushBody: string } {
  const t = title.trim() || "your improvement";
  if (weight === 3) {
    return {
      message: `🏆 Your improvement “${t}” was rated Substantial — ×3 credits`,
      pushTitle: "🏆 Rated Substantial — ×3",
      pushBody: `Your improvement “${t}” has been rated higher than normal: ×3 credits.`,
    };
  }
  return {
    message: `⭐ Your improvement “${t}” was rated a Great one — ×2 credits`,
    pushTitle: "⭐ Rated a Great one — ×2",
    pushBody: `Your improvement “${t}” has been rated higher than normal: ×2 credits.`,
  };
}

/**
 * Who to tell, and at which rating.
 *
 *  - Only a rise to ×2 or ×3 sends anything (old → new must go UP).
 *  - Each credited person is told unless they've already been told about
 *    this rating or a higher one (`alreadyTold`: their highest so far).
 *  - The person who set the rating (the founder) is never told.
 */
export function ratingRecipients(input: {
  oldWeight: unknown;
  newWeight: unknown;
  creditedUserIds: ReadonlyArray<number>;
  setByUserId: number | null;
  alreadyTold: ReadonlyMap<number, number>;
}): { weight: 2 | 3; userIds: number[] } | null {
  const before: CreditWeight = normaliseCreditWeight(input.oldWeight);
  const after: CreditWeight = normaliseCreditWeight(input.newWeight);
  if (after === 1 || after <= before) return null;
  const userIds = [...new Set(input.creditedUserIds)]
    .filter(id => Number.isInteger(id) && id > 0)
    .filter(id => id !== input.setByUserId)
    .filter(id => (input.alreadyTold.get(id) ?? 1) < after);
  if (userIds.length === 0) return null;
  return { weight: after, userIds };
}
