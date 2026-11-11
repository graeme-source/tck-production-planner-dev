/**
 * Find a kanban by typing instead of scanning (Graeme, 11 Nov 2026: "a search
 * bar that I can actually just manually search a kanban rather than scanning
 * it"). Every word typed must appear in the item's name or its supplier, in
 * any order, ignoring case. Names that start with what's typed come first.
 * Objective C.
 */
export type KanbanSearchItem = { ingredientId: number; ingredientName: string | null; supplierName: string | null };

export function searchKanbans<T extends KanbanSearchItem>(items: readonly T[], query: string, limit = 40): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (k: T) => `${k.ingredientName ?? ""} ${k.supplierName ?? ""}`.toLowerCase();
  const name = (k: T) => (k.ingredientName ?? "").toLowerCase();
  const found = words.length === 0 ? [...items] : items.filter(k => words.every(w => hay(k).includes(w)));
  const first = words[0] ?? "";
  return found
    .sort((a, b) => {
      const sa = first && name(a).startsWith(first) ? 0 : 1;
      const sb = first && name(b).startsWith(first) ? 0 : 1;
      return sa - sb || name(a).localeCompare(name(b));
    })
    .slice(0, limit);
}
