/**
 * Type-to-filter for the Orders page "Add item to <supplier>" dialog
 * (fix-queue #377 / #342). Big suppliers carry 100+ ingredients, so the
 * team needs to narrow the list instead of scrolling (Graeme, 2026-11-02:
 * "Yes you can add a search bar in this modal").
 *
 * Rules: case-insensitive; extra / leading / trailing spaces ignored;
 * every typed word must appear somewhere in the name, in any order
 * ("onion red" finds "Red Onions"); an empty query returns the full list
 * in its original order.
 *
 * Pure (no React, no fetch) so it's unit-tested. Objective F.
 */
export function filterAddItemIngredients<T extends { name: string | null | undefined }>(
  items: readonly T[],
  query: string | null | undefined,
): T[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter(item => {
    const name = (item.name ?? "").toLowerCase().replace(/\s+/g, " ");
    return words.every(w => name.includes(w));
  });
}
