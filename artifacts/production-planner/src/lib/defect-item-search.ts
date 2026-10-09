/**
 * "What was it?" search for Report defect / waste (Graeme, 2026-10-09:
 * "just start typing it… string search to filter the results"). Pure;
 * tested in defect-item-search.test.ts.
 *
 * Every word typed must appear somewhere in the name ("nacho chee" finds
 * "Nacho Cheese Block v4"). Best matches first:
 *   0  the name starts with what was typed
 *   1  a word in the name starts with each word typed
 *   2  the words are in there somewhere
 * then products before sub-recipes before ingredients (what's usually
 * wasted on the floor), then shorter names, then A–Z.
 */

export type WasteItemKind = "ingredient" | "sub_recipe" | "product";

export interface SearchableItem {
  kind: WasteItemKind;
  name: string;
}

export const KIND_LABEL: Record<WasteItemKind, string> = {
  product: "Product",
  sub_recipe: "Sub-recipe",
  ingredient: "Ingredient",
};

const KIND_ORDER: Record<WasteItemKind, number> = { product: 0, sub_recipe: 1, ingredient: 2 };

/** Lower case, accents off, anything that isn't a letter or digit a space. */
export function normaliseForSearch(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function score(name: string, query: string, words: string[]): number | null {
  const n = normaliseForSearch(name);
  if (!words.every(w => n.includes(w))) return null;
  if (n.startsWith(query)) return 0;
  const nameWords = n.split(" ");
  if (words.every(w => nameWords.some(nw => nw.startsWith(w)))) return 1;
  return 2;
}

export function searchItems<T extends SearchableItem>(items: readonly T[], raw: string, limit = 30): T[] {
  const query = normaliseForSearch(raw);
  if (!query) return [];
  const words = query.split(" ");
  const hits: Array<{ item: T; s: number }> = [];
  for (const item of items) {
    const s = score(item.name, query, words);
    if (s !== null) hits.push({ item, s });
  }
  hits.sort((a, b) =>
    a.s - b.s
    || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind]
    || a.item.name.length - b.item.name.length
    || a.item.name.localeCompare(b.item.name));
  return hits.slice(0, limit).map(h => h.item);
}
