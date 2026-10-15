/**
 * Double-submit guard for creating a production plan (Graeme, 15 Oct 2026).
 * Two identical active plans for Fri 16 Oct were created 0.7 s apart — a
 * double tap on Create Plan — and every prep and ordering figure for that day
 * doubled (basil showed 629 g still to prep instead of 315 g).
 *
 * A create that matches a plan made for the same date in the last couple of
 * minutes with exactly the same recipes and batches is the same request
 * arriving twice: the server returns the first plan instead of making a
 * second. A deliberate second plan (different items, or later) still works.
 */

export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface PlanItemKey { recipeId: number; batchesTarget: number }

function signature(items: readonly PlanItemKey[]): string {
  return items
    .map(i => `${Number(i.recipeId)}:${Number(i.batchesTarget) || 0}`)
    .sort()
    .join(",");
}

/** Is `incoming` the same create as `existing` (same items, made moments ago)? */
export function isDuplicateCreate(
  existing: { createdAt: Date; items: readonly PlanItemKey[] },
  incoming: readonly PlanItemKey[],
  now: Date = new Date(),
): boolean {
  if (now.getTime() - existing.createdAt.getTime() > DUPLICATE_WINDOW_MS) return false;
  return signature(existing.items) === signature(incoming);
}
