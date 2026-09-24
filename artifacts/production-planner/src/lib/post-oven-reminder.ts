/**
 * When the wrapping station's post-oven reminder (the "don't forget the
 * garlic butter" modal) must appear.
 *
 * Which recipes need it is data-driven: a recipe carries post-oven items
 * (garlic butter, cream cheese icing…) from the assembly-items endpoint.
 * Nothing here knows a recipe by name.
 *
 * Regressions this rule guards:
 * - 2026-09-17 (missing two days running): the reminder fired only from a
 *   manual tap, but the station AUTO-selects the current wrapping item, so
 *   whenever the garlic-butter recipe led the queue the modal never showed.
 *   The rule is about the STATE (a post-oven recipe is on show), not how it
 *   got there.
 * - 2026-09-17 (Jane Miles): once confirmed, the reminder never came back
 *   for the rest of the session — skip past the garlic recipe, press Prev
 *   to return, and no reminder. It was remembered per item per session.
 *   Now it is remembered per LANDING: it shows once each time the wrapper
 *   lands on the recipe (Next, Prev, tapping it, returning to the station)
 *   and stays quiet only while they remain on it.
 */
export function decidePostOvenReminder(input: {
  /** The recipe item on show now, or null. */
  selectedItemId: number | null;
  /** How many post-oven items that recipe carries (0 while still loading). */
  postOvenCount: number;
  /** The item the reminder already showed for during the stay that was in
   *  progress at the previous check, or null. */
  remindedForId: number | null;
}): { show: boolean; remindedForId: number | null } {
  const { selectedItemId, postOvenCount } = input;
  // Moving to a different item ends the stay on the reminded one, so
  // landing back on it later counts as a fresh arrival.
  const stillOnReminded = input.remindedForId != null && input.remindedForId === selectedItemId;
  if (stillOnReminded) return { show: false, remindedForId: input.remindedForId };
  // Not yet known to need it (or post-oven data still loading): don't use up
  // the landing, so the reminder still fires once the data arrives.
  if (selectedItemId == null || postOvenCount <= 0) return { show: false, remindedForId: null };
  return { show: true, remindedForId: selectedItemId };
}
