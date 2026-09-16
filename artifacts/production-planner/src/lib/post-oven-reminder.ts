/**
 * When the wrapping station's post-oven reminder (the blocking "don't
 * forget the garlic butter" modal) must appear.
 *
 * Regression (reported 2026-09-17, missing two days running): the reminder
 * fired only from a manual tap on the recipe card, but the station
 * AUTO-expands the current wrapping item — so whenever the garlic-butter
 * recipe led the queue, the modal never showed. The rule is now about the
 * STATE — a recipe with post-oven items became the open one and hasn't
 * been confirmed this session — not about how it got opened.
 */
export function shouldShowPostOvenReminder(input: {
  /** The recipe item now open in the queue, or null. */
  expandedItemId: number | null;
  /** How many post-oven items (garlic butter, icing…) that recipe carries. */
  postOvenCount: number;
  /** Items whose reminder was already confirmed this session. */
  dismissedItemIds: ReadonlySet<number>;
}): boolean {
  if (input.expandedItemId == null) return false;
  if (input.postOvenCount <= 0) return false;
  return !input.dismissedItemIds.has(input.expandedItemId);
}
