/**
 * Which doughs go into the main (calzone) mixes — Graeme, 19 Oct 2026:
 * opening tomorrow's plan straight from the calendar's dough card put the
 * Bun Dough and the Calzone Dough into ONE ingredient list and one set of
 * mixes, so the team couldn't make the dough. Every dough is its own product
 * with its own mixes: a dough made on the production day (bun dough) never
 * joins the main mix; it is shown as its own group (sameDayDough) instead.
 */
export function mainMixDoughIds(
  doughSubRecipeIds: number[],
  links: Array<{ subRecipeId: number; madeOnProductionDay: boolean | null }>,
): number[] {
  const sameDay = new Set(links.filter(l => l.madeOnProductionDay).map(l => l.subRecipeId));
  return doughSubRecipeIds.filter(id => !sameDay.has(id));
}
