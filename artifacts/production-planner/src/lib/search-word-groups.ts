/**
 * Group a supplier card's order lines by the word you'd type into the
 * SUPPLIER'S website search (Objective C — never run out).
 *
 * Graeme, 2026-10-01: on AB Fruits we type "onions" into their search bar,
 * but "Diced white onions" sat near the top of our list and "Red Onions"
 * near the bottom, so one got missed or needed a second search. Items that
 * share a significant word now sit next to each other (no heading — Graeme,
 * 2026-10-10: just the grouping, no search).
 *
 * No ingredient names are hard-coded: the grouping comes purely from the
 * words in the names on the one card. Weak words (colours, prep styles,
 * sizes, units, filler like "fresh"/"british"/"loose") never form a group.
 */

/** Words that never make a group on their own. */
const WEAK_WORDS = new Set([
  // filler / provenance
  "fresh", "british", "uk", "english", "loose", "organic", "premium", "quality", "standard",
  "the", "and", "of", "with", "in", "for", "a", "an", "or", "per", "each",
  // sizes and pack words
  "large", "small", "medium", "mini", "baby", "jumbo", "whole", "half", "bulk",
  "pack", "packs", "case", "cases", "box", "boxes", "bag", "bags", "tray", "tub", "tin", "tins",
  "jar", "bottle", "punnet", "bunch", "sack", "net", "kg", "g", "gm", "gram", "grams", "kilo",
  "ml", "l", "ltr", "litre", "litres", "liter", "oz", "lb", "lbs", "pc", "pcs", "piece", "pieces",
  "x", "mix", "mixed", "assorted", "selection",
  // colours
  "red", "white", "green", "yellow", "orange", "black", "brown", "golden", "pink", "purple", "blue",
  // preparation / state
  "diced", "sliced", "chopped", "grated", "peeled", "prepared", "prepped", "trimmed", "shredded",
  "minced", "crushed", "drained", "weight", "frozen", "chilled", "dried", "roasted", "chargrilled",
  "smoked", "cooked", "raw", "washed", "halved", "quartered", "cut", "pre",
]);

/** Simple English plural → singular: onions→onion, tomatoes→tomato, berries→berry. */
export function singularise(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (/(ches|shes|xes|sses|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

/**
 * The significant search words in a name, singular and lower-case, in the
 * order they appear. Bracketed notes ("(Diced)", "(case)", "(Drained
 * weight)") are dropped, as are numbers, sizes like "5kg" / "x10" and weak
 * words.
 */
export function searchWords(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/'s\b/g, "")
    .replace(/[-']/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    if (/\d/.test(raw)) continue; // 5kg, x10, 2.5, 400g
    if (raw.length < 3) continue;
    if (WEAK_WORDS.has(raw)) continue;
    const w = singularise(raw);
    if (WEAK_WORDS.has(w) || w.length < 3) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

export type SearchGroup<T> = {
  /** The one word to type on the supplier's site; null for a lone item. */
  searchWord: string | null;
  items: T[];
};

/**
 * Order one card's items so those found by the same search sit together.
 *
 * Each item joins the word it shares with the most other items on the card
 * (ties: its last significant word — usually the noun, e.g. "onion" in
 * "Diced white onions" — then alphabetical). Groups and lone items are then
 * ordered alphabetically together: a group by its search word, a lone item
 * by its name. Items inside a group are alphabetical.
 */
export function groupBySearchWord<T>(items: readonly T[], nameOf: (item: T) => string): SearchGroup<T>[] {
  const words = items.map(it => searchWords(nameOf(it)));
  const counts = new Map<string, number>();
  for (const ws of words) for (const w of ws) counts.set(w, (counts.get(w) ?? 0) + 1);

  const assigned = words.map(ws => {
    let best: string | null = null;
    let bestCount = 0;
    let bestLast = 0;
    ws.forEach((w, i) => {
      const c = counts.get(w) ?? 0;
      if (c < 2) return;
      const last = i === ws.length - 1 ? 1 : 0;
      if (
        best == null ||
        c > bestCount ||
        (c === bestCount && last > bestLast) ||
        (c === bestCount && last === bestLast && w < best)
      ) {
        best = w;
        bestCount = c;
        bestLast = last;
      }
    });
    return best;
  });

  const byWord = new Map<string, T[]>();
  assigned.forEach((w, i) => {
    if (w == null) return;
    const arr = byWord.get(w) ?? [];
    arr.push(items[i]);
    byWord.set(w, arr);
  });

  const cmpName = (a: T, b: T) => nameOf(a).localeCompare(nameOf(b), "en-GB", { sensitivity: "base" });
  const units: Array<{ key: string; group: SearchGroup<T> }> = [];
  for (const [word, members] of byWord) {
    if (members.length >= 2) {
      units.push({ key: word, group: { searchWord: word, items: [...members].sort(cmpName) } });
    }
  }
  items.forEach((it, i) => {
    const w = assigned[i];
    if (w != null && (byWord.get(w)?.length ?? 0) >= 2) return;
    units.push({ key: nameOf(it).toLowerCase(), group: { searchWord: null, items: [it] } });
  });

  return units
    .sort((a, b) => a.key.localeCompare(b.key, "en-GB", { sensitivity: "base" }))
    .map(u => u.group);
}

/**
 * The card's rows in display order. Items for which `keepInPlace` is true
 * (on the Orders page: pulled kanbans, manual and misc adds, which
 * deliberately stay at the bottom in the order they were added so nothing
 * jumps mid-list — Graeme, 2026-09-10) follow the grouped items unchanged.
 * `searchWord` is set on the FIRST row of each group of 2+ only, so the page
 * can put the "Search: onion" label above it.
 */
export function orderForSupplierSearch<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  keepInPlace: (item: T) => boolean = () => false,
): Array<{ item: T; searchWord: string | null }> {
  const grouped = groupBySearchWord(items.filter(i => !keepInPlace(i)), nameOf)
    .flatMap(g => g.items.map((item, i) => ({ item, searchWord: i === 0 ? g.searchWord : null })));
  const kept = items.filter(keepInPlace).map(item => ({ item, searchWord: null }));
  return [...grouped, ...kept];
}
