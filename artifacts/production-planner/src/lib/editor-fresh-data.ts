/**
 * When an edit form may be drawn from a detail query (Graeme, 19 Nov 2026:
 * changed Garlic Cloves to Garlic Confit in a sub-recipe opened from its
 * recipe, saved, reopened it from the recipe and still saw the old line).
 *
 * The form copies its starting values once, when it is first drawn. Drawn
 * from the copy already in memory, it keeps the old lines even after the
 * fresh copy arrives a moment later. So the form waits until the copy has
 * been fetched since the editor opened (pair with refetchOnMount: "always").
 * Later refetches (window focus) don't hide it again, so typing is never
 * thrown away.
 */
export function editFormReady(q: { hasData: boolean; fetchedSinceOpen: boolean }): boolean {
  return q.hasData && q.fetchedSinceOpen;
}
