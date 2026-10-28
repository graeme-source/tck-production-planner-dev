/**
 * Fill a test box from a recipe tag (Graeme, 28 Oct 2026: "choose these
 * products — maybe by tag, maybe just by selecting them"). Tag the trial
 * recipes on the recipe page (e.g. "Winter Warmers Test Box"), then one tap
 * on the box adds them all. Pure — unit-tested.
 */

export interface TaggedRecipe { id: number; name: string; tags?: string[] | null }

const norm = (t: string) => t.trim().toLowerCase();

/** Every tag on the recipes, with how many carry it — busiest first, then A–Z. */
export function recipeTagCounts(recipes: TaggedRecipe[]): Array<{ tag: string; count: number }> {
  const byKey = new Map<string, { tag: string; count: number }>();
  for (const r of recipes) {
    for (const t of new Set((r.tags ?? []).map(x => x.trim()).filter(Boolean))) {
      const e = byKey.get(norm(t));
      if (e) e.count++; else byKey.set(norm(t), { tag: t, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The box's recipe ids with every recipe carrying `tag` added (in name
 *  order), up to `max`. `left` names the ones that didn't fit. */
export function addRecipesByTag(ids: number[], recipes: TaggedRecipe[], tag: string, max: number): { ids: number[]; added: string[]; left: string[] } {
  const tagged = recipes
    .filter(r => (r.tags ?? []).some(t => norm(t) === norm(tag)) && !ids.includes(r.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const room = Math.max(0, max - ids.length);
  const fit = tagged.slice(0, room);
  return { ids: [...ids, ...fit.map(r => r.id)], added: fit.map(r => r.name), left: tagged.slice(room).map(r => r.name) };
}
