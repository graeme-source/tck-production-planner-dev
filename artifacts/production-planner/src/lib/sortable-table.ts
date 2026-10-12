/**
 * Sortable list tables — the pure half of the pattern the Recipes table
 * (/recipes) uses: tap a column header to sort by it, tap again to flip the
 * direction. The header cell itself is components/sortable-th.tsx.
 *
 * Shared by Product Labels (/labels) and People (/people) so each list
 * doesn't grow its own copy of the compare rules (Objective F).
 */

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> { key: K; dir: SortDir }

/** A cell's sort value. null/undefined/"" = no value: always sorts last. */
export type SortValue = string | number | null | undefined;

const isBlank = (v: SortValue): v is null | undefined | "" => v == null || v === "";

/**
 * Compare two cell values in the given direction. Strings compare naturally
 * and case-insensitively ("Item 2" before "Item 10"); numbers numerically.
 * Blanks go to the bottom whichever way you sort, so an empty column never
 * buries the rows that have something to show.
 */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  const cmp = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), "en-GB", { sensitivity: "base", numeric: true });
  return dir === "asc" ? cmp : -cmp;
}

/**
 * A sorted copy of `rows`. `tiebreak` (usually the name, A→Z) settles rows
 * that are equal on the chosen column, whatever its direction.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  valueOf: (row: T, key: K) => SortValue,
  tiebreak?: (row: T) => SortValue,
): T[] {
  return [...rows].sort((a, b) => {
    const c = compareValues(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir);
    if (c !== 0 || !tiebreak) return c;
    return compareValues(tiebreak(a), tiebreak(b), "asc");
  });
}

/**
 * The sort after tapping `key`'s header: the same column flips direction;
 * a new column starts in its natural direction (`firstDir`, default A→Z).
 */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir = "asc"): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: firstDir };
}
